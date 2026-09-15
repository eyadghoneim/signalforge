import { BarChart3, FlaskConical } from 'lucide-react';
import type { AttributionSummary } from '../api';

const TAG_LABELS: Record<string, string> = {
  TREND: 'الترند (EMA)',
  MACD: 'زخم MACD',
  RSI: 'تشبع RSI',
  ADX: 'قوة الاتجاه',
  RVOL: 'الفوليوم النسبي',
  MOMENTUM: 'زخم 24 ساعة',
  FUNDING: 'تمويل العقود',
  BOLLINGER: 'بولنجر',
  HTF: 'فريم 4 ساعات/يومي',
  SMC: 'بنية السوق (SMC)',
  LIQUIDITY: 'السيولة العالمية',
};

export default function AttributionPanel({ summary }: { summary: AttributionSummary }) {
  const maxRate = 100;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold text-zinc-300">
        <BarChart3 size={16} className="text-amber-400" />
        من مؤشراتك بيكسب فعلاً؟
      </div>
      <p className="mb-3 text-[10px] leading-4 text-zinc-500">{summary.noteAr}</p>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-zinc-800/60 p-2">
          <div className="text-[9px] text-zinc-500">محسومة</div>
          <div className="text-sm font-extrabold tabular-nums text-zinc-200" dir="ltr">{summary.resolved}</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <div className="text-[9px] text-emerald-400/70">TP1 قبل الوقف</div>
          <div className="text-sm font-extrabold tabular-nums text-emerald-300" dir="ltr">{summary.tp1First}</div>
        </div>
        <div className="rounded-lg bg-rose-500/10 p-2">
          <div className="text-[9px] text-rose-400/70">الوقف أولاً</div>
          <div className="text-sm font-extrabold tabular-nums text-rose-300" dir="ltr">{summary.slFirst}</div>
        </div>
      </div>

      {summary.winRatePercent !== null && (
        <div className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2 text-center">
          <span className="text-[10px] text-sky-300/80">نسبة نجاح الإشارات المحسومة: </span>
          <span className="text-sm font-extrabold tabular-nums text-sky-200" dir="ltr">{summary.winRatePercent}%</span>
        </div>
      )}

      {summary.perTag.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 p-3 text-[10px] text-zinc-500">
          <FlaskConical size={13} />
          بتتجمع البيانات — أول ما تتحسم إشارات هيظهر تقييم كل عامل هنا
        </div>
      ) : (
        <div className="space-y-2">
          {summary.perTag.slice(0, 6).map((t) => (
            <div key={t.tag}>
              <div className="mb-0.5 flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">{TAG_LABELS[t.tag] ?? t.tag}</span>
                <span className="tabular-nums text-zinc-500" dir="ltr">
                  {t.winRatePercent !== null ? `${t.winRatePercent}%` : '—'} ({t.total})
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800" dir="ltr">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${((t.winRatePercent ?? 0) / maxRate) * 100}%`,
                    background: (t.winRatePercent ?? 0) >= 55 ? '#10b981' : (t.winRatePercent ?? 0) >= 45 ? '#f59e0b' : '#f43f5e',
                  }}
                />
              </div>
            </div>
          ))}
          <p className="pt-1 text-[9px] leading-4 text-zinc-600">
            الأخضر = العامل حاضر غالباً في الإشارات الرابحة، الأحمر = حاضر في الخاسرة. بعد 20+ إشارة محسومة تبقى الدلالة إحصائية حقيقية.
          </p>
        </div>
      )}
    </div>
  );
}
