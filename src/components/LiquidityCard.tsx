import { Droplets } from 'lucide-react';
import type { LiquidityRegime, ProviderHealthInfo } from '../api';
import { t, type Lang } from '../i18n';

const VERDICT_STYLE: Record<string, { key: 'riskOn' | 'neutral' | 'riskOff'; cls: string }> = {
  RISK_ON: { key: 'riskOn', cls: 'text-emerald-300' },
  NEUTRAL: { key: 'neutral', cls: 'text-zinc-300' },
  RISK_OFF: { key: 'riskOff', cls: 'text-rose-300' },
};

export function LiquidityCard({ regime, lang }: { regime: LiquidityRegime | null; lang: Lang }) {
  if (!regime) return null;
  const v = VERDICT_STYLE[regime.verdict] ?? VERDICT_STYLE.NEUTRAL;
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
          <Droplets size={15} className="text-sky-400" />
          {t(lang, 'liquidityTitle')}
          <span className="text-[9px] text-zinc-500">({t(lang, 'defillama')})</span>
        </div>
        <span className={`text-[10px] font-bold ${v.cls}`}>{t(lang, v.key)}</span>
      </div>
      <div className="space-y-1.5">
        {regime.components.map((c) => (
          <div key={c.nameAr} className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">{lang === 'en' && c.nameEn ? c.nameEn : c.nameAr}</span>
            <span className="flex items-center gap-1.5" dir="ltr">
              <span className={c.change7dPercent === null ? 'text-zinc-600' : c.change7dPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {c.change7dPercent === null ? t(lang, 'unavailable') : `${c.change7dPercent > 0 ? '+' : ''}${c.change7dPercent}%`}
              </span>
              {c.adjustment !== 0 && (
                <span className={`rounded px-1 font-mono text-[9px] ${c.adjustment > 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
                  {c.adjustment > 0 ? '+' : ''}
                  {c.adjustment}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-zinc-800 pt-2 text-[9px] text-zinc-600">
        {t(lang, 'liquidityFooter')}: {regime.totalAdjustment > 0 ? '+' : ''}{regime.totalAdjustment} (±8) — {t(lang, 'sourcesOf')} {regime.sourcesOk}/{regime.sourcesTotal}
      </div>
    </div>
  );
}

export function ProviderDots({ providers, lang }: { providers: ProviderHealthInfo[]; lang: Lang }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2 text-[9px] text-zinc-500">
      <span>{t(lang, 'providerSources')}</span>
      {providers.length === 0 ? (
        <span className="text-zinc-600">{t(lang, 'collecting')}</span>
      ) : (
        providers.map((p) => {
          const healthy = p.lastOkAt && (!p.lastFailAt || p.lastOkAt >= p.lastFailAt);
          return (
            <span
              key={p.provider}
              title={p.lastError ? `${t(lang, 'lastError')} ${p.lastError}` : t(lang, 'works')}
              className="flex items-center gap-1"
              dir="ltr"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              {p.provider}
            </span>
          );
        })
      )}
    </div>
  );
}
