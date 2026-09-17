import { BarChart3, FlaskConical } from 'lucide-react';
import type { AttributionSummary } from '../api';
import { t, type Lang, type TKey } from '../i18n';

const TAG_KEY: Record<string, TKey> = {
  TREND: 'tagTrend',
  MACD: 'tagMacd',
  RSI: 'tagRsi',
  ADX: 'tagAdx',
  RVOL: 'tagRvol',
  MOMENTUM: 'tagMomentum',
  FUNDING: 'tagFunding',
  BOLLINGER: 'tagBollinger',
  HTF: 'tagHtf',
  SMC: 'tagSmc',
  LIQUIDITY: 'tagLiquidity',
  WHALE: 'tagWhale',
  FNG: 'tagFng',
  OI: 'tagOi',
};

export default function AttributionPanel({ summary, lang }: { summary: AttributionSummary; lang: Lang }) {
  const maxRate = 100;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold text-zinc-300">
        <BarChart3 size={16} className="text-amber-400" />
        {t(lang, 'attrTitle')}
      </div>
      <p className="mb-3 text-[10px] leading-4 text-zinc-500">{summary.noteAr}</p>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-zinc-800/60 p-2">
          <div className="text-[9px] text-zinc-500">{t(lang, 'attrResolved')}</div>
          <div className="text-sm font-extrabold tabular-nums text-zinc-200" dir="ltr">{summary.resolved}</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <div className="text-[9px] text-emerald-400/70">{t(lang, 'attrTp1')}</div>
          <div className="text-sm font-extrabold tabular-nums text-emerald-300" dir="ltr">{summary.tp1First}</div>
        </div>
        <div className="rounded-lg bg-rose-500/10 p-2">
          <div className="text-[9px] text-rose-400/70">{t(lang, 'attrSl')}</div>
          <div className="text-sm font-extrabold tabular-nums text-rose-300" dir="ltr">{summary.slFirst}</div>
        </div>
      </div>

      {summary.winRatePercent !== null && (
        <div className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2 text-center">
          <span className="text-[10px] text-sky-300/80">{t(lang, 'attrWinRate')}</span>
          <span className="text-sm font-extrabold tabular-nums text-sky-200" dir="ltr">{summary.winRatePercent}%</span>
        </div>
      )}

      {summary.perTag.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 p-3 text-[10px] text-zinc-500">
          <FlaskConical size={13} />
          {t(lang, 'attrCollecting')}
        </div>
      ) : (
        <div className="space-y-2">
          {summary.perTag.slice(0, 6).map((t2) => (
            <div key={t2.tag}>
              <div className="mb-0.5 flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">{t(lang, TAG_KEY[t2.tag] ?? 'tagLiquidity')}</span>
                <span className="tabular-nums text-zinc-500" dir="ltr">
                  {t2.winRatePercent !== null ? `${t2.winRatePercent}%` : '—'} ({t2.total})
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800" dir="ltr">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${((t2.winRatePercent ?? 0) / maxRate) * 100}%`,
                    background: (t2.winRatePercent ?? 0) >= 55 ? '#10b981' : (t2.winRatePercent ?? 0) >= 45 ? '#f59e0b' : '#f43f5e',
                  }}
                />
              </div>
            </div>
          ))}
          <p className="pt-1 text-[9px] leading-4 text-zinc-600">
            {t(lang, 'attrLegend')}
          </p>
        </div>
      )}
    </div>
  );
}
