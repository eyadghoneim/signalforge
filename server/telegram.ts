// إشعارات تليجرام: إرسال HTML آمن + بناء رسالة الإشارة بالعربية
import type { Signal } from '../shared/types';

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
  deduplicated?: boolean;
}

const TELEGRAM_ALERT_TTL_MS = 24 * 60 * 60_000;
const sentAlertKeys = new Map<string, number>();

function pruneAlertKeys(nowMs: number): void {
  for (const [key, expiresAt] of sentAlertKeys) {
    if (expiresAt <= nowMs) sentAlertKeys.delete(key);
  }
}

/** Reserve an alert key before sending so overlapping/timeout retries stay at-most-once. */
export function claimTelegramAlertKey(key: string, chatId: string, nowMs = Date.now()): boolean {
  const scopedKey = `${chatId.replace(/\s+/g, '')}:${key}`;
  pruneAlertKeys(nowMs);
  if (sentAlertKeys.has(scopedKey)) return false;
  sentAlertKeys.set(scopedKey, nowMs + TELEGRAM_ALERT_TTL_MS);
  return true;
}

export function releaseTelegramAlertKey(key: string, chatId: string): void {
  sentAlertKeys.delete(`${chatId.replace(/\s+/g, '')}:${key}`);
}

/** Paper-event wrapper: one stable event key cannot produce duplicate Telegram alerts. */
export async function sendTelegramDedupedMessage(
  token: string,
  chatId: string,
  html: string,
  eventKey: string,
  timeoutMs = 6000,
): Promise<TelegramSendResult> {
  if (!claimTelegramAlertKey(eventKey, chatId)) return { ok: true, deduplicated: true };
  const result = await sendTelegramMessage(token, chatId, html, timeoutMs);
  // A clear API rejection can be retried; an ambiguous timeout stays claimed to
  // avoid sending a second copy after Telegram may already have accepted it.
  if (!result.ok && !/abort|timeout/i.test(result.error ?? '')) releaseTelegramAlertKey(eventKey, chatId);
  return result;
}

export interface TelegramPollingConfig {
  enabled: boolean;
  token: string;
  chatId: string;
}

export interface TelegramCommandHandlers {
  status: () => string | Promise<string>;
  balance: () => string | Promise<string>;
  pause: () => string | Promise<string>;
  resume: () => string | Promise<string>;
  panic: () => string | Promise<string>;
}

type TelegramUpdate = {
  update_id: number;
  message?: { chat?: { id?: number | string }; text?: string };
};

let pollingActive = false;
let pollingTimer: NodeJS.Timeout | null = null;
let pollingOffset = 0;
let pollingInitialized = false;

/** Parse only slash commands; bot usernames and arguments are ignored. */
export function parseTelegramCommand(text: string | undefined): string | null {
  const first = String(text || '').trim().split(/\s+/, 1)[0];
  if (!first.startsWith('/')) return null;
  return first.slice(1).split('@', 1)[0].toLowerCase() || null;
}

async function pollTelegramUpdates(
  configProvider: () => TelegramPollingConfig,
  handlers: TelegramCommandHandlers,
): Promise<void> {
  if (!pollingActive) return;
  const config = configProvider();
  if (!config.enabled || !config.token || !config.chatId) {
    pollingTimer = setTimeout(() => void pollTelegramUpdates(configProvider, handlers), 10_000);
    return;
  }

  try {
    const query = new URLSearchParams({ timeout: '20', offset: String(pollingOffset) });
    const res = await fetch(`https://api.telegram.org/bot${config.token}/getUpdates?${query.toString()}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    });
    const json = (await res.json()) as { ok?: boolean; result?: TelegramUpdate[] };
    if (!res.ok || !json.ok || !Array.isArray(json.result)) throw new Error(`getUpdates HTTP ${res.status}`);
    const updates = json.result;

    // Do not execute stale commands that were sent before this process started.
    if (!pollingInitialized) {
      if (updates.length) pollingOffset = Math.max(...updates.map((u) => u.update_id)) + 1;
      pollingInitialized = true;
    } else {
      if (updates.length) pollingOffset = Math.max(...updates.map((u) => u.update_id)) + 1;
      for (const update of updates) {
        const messageChat = String(update.message?.chat?.id ?? '');
        if (!messageChat || messageChat !== String(config.chatId).replace(/\s+/g, '')) continue;
        const command = parseTelegramCommand(update.message?.text);
        if (!command) continue;
        const handler = handlers[command as keyof TelegramCommandHandlers];
        if (typeof handler !== 'function') continue;
        const response = await handler();
        if (response) await sendTelegramMessage(config.token, config.chatId, response);
      }
    }
  } catch {
    // Polling is best-effort; the next cycle retries without affecting scanning.
  }

  if (pollingActive) pollingTimer = setTimeout(() => void pollTelegramUpdates(configProvider, handlers), 1000);
}

export function startTelegramPolling(
  configProvider: () => TelegramPollingConfig,
  handlers: TelegramCommandHandlers,
): void {
  if (pollingActive) return;
  pollingActive = true;
  pollingOffset = 0;
  pollingInitialized = false;
  void pollTelegramUpdates(configProvider, handlers);
}

export function stopTelegramPolling(): void {
  pollingActive = false;
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  html: string,
  timeoutMs = 6000,
): Promise<TelegramSendResult> {
  const t = (token || '').replace(/\s+/g, '');
  const c = (chatId || '').replace(/\s+/g, '');
  if (!t || !c) return { ok: false, error: 'missing token or chat id' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: c, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) return { ok: false, error: json.description || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    // Never return the request URL: it contains the bot token and could be
    // persisted by callers in logs. Preserve timeout semantics for dedupe.
    const timedOut = controller.signal.aborted || (e instanceof Error && e.name === 'AbortError');
    return { ok: false, error: timedOut ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

function esc(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtUsd(v: number): string {
  return Number.isFinite(v) ? `$${v.toLocaleString('en-US')}` : '—';
}

// فئة التوصية الواحدة — تُستخدم في "تغيّرت التوصية" وفي التقرير اليومي.
export type VerdictClass = 'BUY' | 'SELL' | 'GATED' | 'HOLD';

export function verdictOf(s: { regimeGateStatus: string; spotAction: string }): VerdictClass {
  if (s.regimeGateStatus !== 'CLEAR') return 'GATED';
  if (s.spotAction === 'SPOT_BUY') return 'BUY';
  if (s.spotAction === 'SPOT_SELL_ALL') return 'SELL';
  return 'HOLD';
}

export function verdictLabel(v: VerdictClass): string {
  return v === 'BUY' ? '🟢 شراء' : v === 'SELL' ? '🔴 بيع' : v === 'GATED' ? '🟠 ممنوع الدخول' : '⚪ انتظار';
}

export function buildSignalMessageHtml(s: Signal, changedFrom?: VerdictClass | null): string {
  const isUrgent = s.spotAction === 'SPOT_BUY' || s.spotAction === 'SPOT_SELL_ALL';
  const badge = isUrgent ? '🚨 <b>[إشارة تداول فورية]</b>' : 'ℹ️ <b>[تحديث فني]</b>';
  const typeLine =
    s.signalType === 'STRONG_BUY' ? '🚀 شراء قوي' :
    s.signalType === 'BUY' ? '📈 شراء' :
    s.signalType === 'SELL' ? '📉 بيع' :
    s.signalType === 'STRONG_SELL' ? '🛑 بيع قوي' :
    s.signalType === 'NO_TRADE' ? `🛡️ ممنوع الدخول (${esc(s.blockReasonAr || '')})` : '⏳ انتظار';

  // التوصية الصريحة: سطر واحد يخلي أي حد يعرف يتصرف فورًا.
  const verdictLine =
    s.regimeGateStatus !== 'CLEAR' ? '🟠 <b>التوصية: ممنوع الدخول (بوابة حماية)</b>' :
    s.spotAction === 'SPOT_BUY' ? '🟢 <b>التوصية: ادخل — شراء</b>' :
    s.spotAction === 'SPOT_SELL_ALL' ? '🔴 <b>التوصية: اخرج — بيع / تخفيف</b>' : '⚪ <b>التوصية: انتظار</b>';

  const lines = [
    badge,
    '',
    verdictLine,
    '',
    `<b>الأصل:</b> ${esc(s.asset)}`,
    `<b>الإشارة:</b> ${typeLine}`,
    `<b>درجة القناعة:</b> ${s.convictionScore}/100`,
    `<b>السعر الحالي:</b> ${fmtUsd(s.entryPrice)}`,
  ];

  // لو التوصية اتغيّرت فعلًا، نوضّح الانتقال بشفافية.
  if (changedFrom && changedFrom !== verdictOf(s)) {
    lines.splice(2, 0, `🔁 <b>التوصية اتغيّرت:</b> ${verdictLabel(changedFrom)} ← ${verdictLabel(verdictOf(s))}`);
  }

  if (s.spotAction === 'SPOT_BUY') {
    lines.push(
      '',
      `🛑 <b>وقف الخسارة:</b> ${fmtUsd(s.stopLoss)}`,
      `🎯 <b>الأهداف:</b> TP1 ${fmtUsd(s.target1)} | TP2 ${fmtUsd(s.target2)} | TP3 ${fmtUsd(s.target3)}`,
      `⚖️ <b>المخاطرة/العائد:</b> ${s.riskRewardRatio}`,
    );
  }

  const topReasons = s.reasons.filter((r) => r.adjustment !== 0).slice(0, 4);
  if (topReasons.length) {
    lines.push('', '<b>أبرز الأسباب:</b>');
    topReasons.forEach((r) => lines.push(`• ${esc(r.textAr)} (${r.adjustment > 0 ? '+' : ''}${r.adjustment})`));
  }

  lines.push('', `<i>SignalForge — أداة بحثية ومحاكاة، ليست نصيحة استثمارية. التنفيذ الحي معطل.</i>`);
  lines.push(`<i>المحرك: ${esc(s.engineSignature)}${s.dataSource === 'STALE' ? ' — بيانات متأخرة' : ''}</i>`);
  return lines.join('\n');
}

export function buildTestMessageHtml(): string {
  return [
    '✅ <b>[اختبار اتصال — SignalForge]</b>',
    '',
    'الربط مع تليجرام يعمل بنجاح.',
    'ستصلك هنا إشارات الشراء والبيع من محرك SignalForge الكمي.',
    '',
    '<i>أداة بحثية — ليست نصيحة استثمارية.</i>',
  ].join('\n');
}

// ─── إشعارات أحداث المحفظة الورقية (عربي / إنجليزي) ───
export type PaperEventKind = 'OPENED' | 'TP1' | 'TP2' | 'CLOSED';
export type TelegramLang = 'ar' | 'en';

interface PaperEventShape {
  kind: PaperEventKind;
  asset: string;
  qty?: number;
  entry?: number;
  exitAvg?: number;
  pnlUsd?: number;
  feesUsd?: number;
  reason?: string;
}

const PCT: Record<PaperEventKind, { ar: string; en: string; emoji: string }> = {
  OPENED: { ar: 'فتح صفقة جديدة', en: 'Position opened', emoji: '🔵' },
  TP1: { ar: 'جني الهدف الأول (TP1) — 50%', en: 'TP1 taken — 50% scaled out', emoji: '✅' },
  TP2: { ar: 'جني الهدف الثاني (TP2) — 30%', en: 'TP2 taken — 30% scaled out', emoji: '✅' },
  CLOSED: { ar: 'قفل الصفقة', en: 'Position closed', emoji: '🔻' },
};

export function buildPaperEventHtml(ev: PaperEventShape, lang: TelegramLang): string {
  const L = PCT[ev.kind];
  const ar = lang === 'ar';
  const lines: string[] = [];
  lines.push(ar ? `🧾 <b>[المحفظة الورقية]</b> ${L.emoji} ${L.ar}` : `🧾 <b>[Paper wallet]</b> ${L.emoji} ${L.en}`);
  lines.push('');
  lines.push(ar ? `<b>الأصل:</b> ${esc(ev.asset)}` : `<b>Asset:</b> ${esc(ev.asset)}`);

  if (ev.kind === 'OPENED') {
    if (ev.qty !== undefined) lines.push(ar ? `<b>الكمية:</b> ${roundQty(ev.qty)}` : `<b>Qty:</b> ${roundQty(ev.qty)}`);
    if (ev.entry !== undefined) lines.push(ar ? `<b>الدخول:</b> ${fmtUsd(ev.entry)}` : `<b>Entry:</b> ${fmtUsd(ev.entry)}`);
    if (ev.feesUsd !== undefined) lines.push(ar ? `<b>الرسوم:</b> ${fmtUsd(ev.feesUsd)}` : `<b>Fees:</b> ${fmtUsd(ev.feesUsd)}`);
  }

  if (ev.kind === 'TP1' || ev.kind === 'TP2') {
    if (ev.entry !== undefined) lines.push(ar ? `<b>الدخول:</b> ${fmtUsd(ev.entry)}` : `<b>Entry:</b> ${fmtUsd(ev.entry)}`);
    if (ev.pnlUsd !== undefined) {
      const sign = ev.pnlUsd >= 0 ? '+' : '';
      lines.push(ar ? `<b>المحصَّل حتى الآن:</b> 🟢 ${sign}${ev.pnlUsd.toFixed(2)}` : `<b>Realized so far:</b> 🟢 ${sign}${ev.pnlUsd.toFixed(2)}`);
    }
    if (ev.feesUsd !== undefined) lines.push(ar ? `<b>الرسوم التراكمية:</b> ${fmtUsd(ev.feesUsd)}` : `<b>Accumulated fees:</b> ${fmtUsd(ev.feesUsd)}`);
  }

  if (ev.kind === 'CLOSED') {
    if (ev.exitAvg !== undefined) lines.push(ar ? `<b>متوسط الخروج:</b> ${fmtUsd(ev.exitAvg)}` : `<b>Avg exit:</b> ${fmtUsd(ev.exitAvg)}`);
    if (ev.reason) {
      const reasonAr = ev.reason === 'TP3' ? 'الهدف الثالث' : ev.reason === 'SL' ? 'وقف الخسارة' : ev.reason === 'TIME' ? 'حد مدة الصفقة' : 'إشارة بيع';
      lines.push(ar ? `<b>السبب:</b> ${reasonAr}` : `<b>Reason:</b> ${esc(ev.reason)}`);
    }
    if (ev.pnlUsd !== undefined) {
      const sign = ev.pnlUsd >= 0 ? '+' : '';
      const cls = ev.pnlUsd >= 0 ? '🟢' : '🔴';
      lines.push(ar ? `<b>الربح/الخسارة:</b> ${cls} ${sign}${ev.pnlUsd.toFixed(2)}` : `<b>P&L:</b> ${cls} ${sign}${ev.pnlUsd.toFixed(2)}`);
    }
    if (ev.feesUsd !== undefined) lines.push(ar ? `<b>إجمالي الرسوم:</b> ${fmtUsd(ev.feesUsd)}` : `<b>Total fees:</b> ${fmtUsd(ev.feesUsd)}`);
  }

  lines.push('');
  lines.push(`<i>${ar ? 'SignalForge — محاكاة بحثية، ليست نصيحة استثمارية.' : 'SignalForge — research simulation, not investment advice.'}</i>`);
  return lines.join('\n');
}

function roundQty(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v >= 1 ? v.toFixed(2) : v.toFixed(6);
}

// ─── تنبيهات صفقات الحيتان الضخمة (Dune DEX Mega Whales) ───
export interface WhaleAlertShape {
  blockchain?: string;
  project: string;
  boughtSymbol: string;
  soldSymbol: string;
  amountUsd: number;
  blockTime?: string;
}

export function buildWhaleAlertHtml(alert: WhaleAlertShape, lang: TelegramLang = 'ar'): string {
  const ar = lang === 'ar';
  const lines: string[] = [];
  lines.push(ar ? `🐋 <b>[رادار الحيتان اللامركزي] صفقـة ضخمـة</b> 🚨` : `🐋 <b>[DEX Whale Radar] Mega Swap Alert</b> 🚨`);
  lines.push('');
  lines.push(ar ? `<b>المنصة:</b> ${esc((alert.project || 'DEX').toUpperCase())}` : `<b>DEX:</b> ${esc((alert.project || 'DEX').toUpperCase())}`);
  lines.push(ar ? `<b>حجم الصفقة:</b> 💰 $${alert.amountUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD` : `<b>Amount:</b> 💰 $${alert.amountUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD`);
  lines.push(ar ? `<b>شراء:</b> 🟢 <b>${esc(alert.boughtSymbol)}</b>` : `<b>Bought:</b> 🟢 <b>${esc(alert.boughtSymbol)}</b>`);
  lines.push(ar ? `<b>بيع:</b> 🔴 <b>${esc(alert.soldSymbol)}</b>` : `<b>Sold:</b> 🔴 <b>${esc(alert.soldSymbol)}</b>`);
  if (alert.blockTime) {
    lines.push(ar ? `<b>التوقيت:</b> ⏱️ ${esc(alert.blockTime)}` : `<b>Time:</b> ⏱️ ${esc(alert.blockTime)}`);
  }
  lines.push('');
  lines.push(`<i>${ar ? 'SignalForge On-Chain Radar — رصد فوري للسيولة المؤسسية عبر Dune' : 'SignalForge On-Chain Radar — Real-time institutional liquidity tracked via Dune'}</i>`);
  return lines.join('\n');
}
