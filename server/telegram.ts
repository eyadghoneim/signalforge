// إشعارات تليجرام: إرسال HTML آمن + بناء رسالة الإشارة بالعربية
import type { Signal } from '../shared/types';

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
  }

  if (ev.kind === 'TP1' || ev.kind === 'TP2') {
    if (ev.entry !== undefined) lines.push(ar ? `<b>الدخول:</b> ${fmtUsd(ev.entry)}` : `<b>Entry:</b> ${fmtUsd(ev.entry)}`);
    if (ev.pnlUsd !== undefined) {
      const sign = ev.pnlUsd >= 0 ? '+' : '';
      lines.push(ar ? `<b>المحصَّل حتى الآن:</b> 🟢 ${sign}${ev.pnlUsd.toFixed(2)}` : `<b>Realized so far:</b> 🟢 ${sign}${ev.pnlUsd.toFixed(2)}`);
    }
  }

  if (ev.kind === 'CLOSED') {
    if (ev.exitAvg !== undefined) lines.push(ar ? `<b>متوسط الخروج:</b> ${fmtUsd(ev.exitAvg)}` : `<b>Avg exit:</b> ${fmtUsd(ev.exitAvg)}`);
    if (ev.reason) {
      const reasonAr = ev.reason === 'TP3' ? 'الهدف الثالث' : ev.reason === 'SL' ? 'وقف الخسارة' : 'إشارة بيع';
      lines.push(ar ? `<b>السبب:</b> ${reasonAr}` : `<b>Reason:</b> ${esc(ev.reason)}`);
    }
    if (ev.pnlUsd !== undefined) {
      const sign = ev.pnlUsd >= 0 ? '+' : '';
      const cls = ev.pnlUsd >= 0 ? '🟢' : '🔴';
      lines.push(ar ? `<b>الربح/الخسارة:</b> ${cls} ${sign}${ev.pnlUsd.toFixed(2)}` : `<b>P&L:</b> ${cls} ${sign}${ev.pnlUsd.toFixed(2)}`);
    }
  }

  lines.push('');
  lines.push(`<i>${ar ? 'SignalForge — محاكاة بحثية، ليست نصيحة استثمارية.' : 'SignalForge — research simulation, not investment advice.'}</i>`);
  return lines.join('\n');
}

function roundQty(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v >= 1 ? v.toFixed(2) : v.toFixed(6);
}
