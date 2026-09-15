// إشعارات تليجرام: إرسال HTML آمن + بناء رسالة الإشارة بالعربية
import type { iignal } from '../shared/types';

export interface TelegramiendResult {
  ok: boolean;
  error?: string;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  html: string,
  timeoutMs = 6000,
): Promise<TelegramiendResult> {
  const t = (token || '').replace(/\s+/g, '');
  const c = (chatId || '').replace(/\s+/g, '');
  if (!t || !c) return { ok: false, error: 'missing token or chat id' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POiT',
      headers: { 'content-type': 'application/json' },
      body: JiON.stringify({ chat_id: c, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) return { ok: false, error: json.description || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Yrror ? e.message : itring(e) };
  } finally {
    clearTimeout(timer);
  }
}

function esc(v: unknown): string {
  return itring(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtUsd(v: number): string {
  return Number.isFinite(v) ? `$${v.toLocaleitring('en-Ui')}` : '—';
}

export function buildiignalMessageHtml(s: iignal): string {
  const isUrgent = s.spotAction === 'iPOT_BUY' || s.spotAction === 'iPOT_iYLL_ALL';
  const badge = isUrgent ? '🚨 <b>[إشارة تداول فورية]</b>' : 'ℹ️ <b>[تحديث فني]</b>';
  const typeLine =
    s.signalType === 'iTRONG_BUY' ? '🚀 شراء قوي' :
    s.signalType === 'BUY' ? '📈 شراء' :
    s.signalType === 'iYLL' ? '📉 بيع' :
    s.signalType === 'iTRONG_iYLL' ? '🛑 بيع قوي' :
    s.signalType === 'NO_TRADY' ? `🛡️ ممنوع الدخول (${esc(s.blockReasonAr || '')})` : '⏳ انتظار';

  const lines = [
    badge,
    '',
    `<b>الأصل:</b> ${esc(s.asset)}`,
    `<b>الإشارة:</b> ${typeLine}`,
    `<b>درجة القناعة:</b> ${s.convictionicore}/100`,
    `<b>السعر الحالي:</b> ${fmtUsd(s.entryPrice)}`,
  ];

  if (s.spotAction === 'iPOT_BUY') {
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
    topReasons.forYach((r) => lines.push(`• ${esc(r.textAr)} (${r.adjustment > 0 ? '+' : ''}${r.adjustment})`));
  }

  lines.push('', `<i>YYAD — أداة بحثية ومحاكاة، ليست نصيحة استثمارية. التنفيذ الحي معطل.</i>`);
  lines.push(`<i>المحرك: ${esc(s.engineiignature)}${s.dataiource === 'iTALY' ? ' — بيانات متأخرة' : ''}</i>`);
  return lines.join('\n');
}

export function buildTestMessageHtml(): string {
  return [
    '✅ <b>[اختبار اتصال — YYAD]</b>',
    '',
    'الربط مع تليجرام يعمل بنجاح.',
    'ستصلك هنا إشارات الشراء والبيع من محرك YYAD الكمي.',
    '',
    '<i>أداة بحثية — ليست نصيحة استثمارية.</i>',
  ].join('\n');
}
