import { Droplets } from 'lucide-react';
import type { LiquidityRegime, ProviderHealthInfo } from '../api';

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  RISK_ON: { label: 'خطر صعودي — سيولة ممتدة', cls: 'text-emerald-300' },
  NEUTRAL: { label: 'محايد', cls: 'text-zinc-300' },
  RISK_OFF: { label: 'انحسار سيولة — احتراس', cls: 'text-rose-300' },
};

export function LiquidityCard({ regime }: { regime: LiquidityRegime | null }) {
  if (!regime) return null;
  const v = VERDICT_STYLE[regime.verdict] ?? VERDICT_STYLE.NEUTRAL;
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
          <Droplets size={15} className="text-sky-400" />
          سيولة السوق العالمية
          <span className="text-[9px] text-zinc-500">(DefiLlama)</span>
        </div>
        <span className={`text-[10px] font-bold ${v.cls}`}>{v.label}</span>
      </div>
      <div className="space-y-1.5">
        {regime.components.map((c) => (
          <div key={c.nameAr} className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">{c.nameAr}</span>
            <span className="flex items-center gap-1.5" dir="ltr">
              <span className={c.change7dPercent === null ? 'text-zinc-600' : c.change7dPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {c.change7dPercent === null ? 'غير متاح' : `${c.change7dPercent > 0 ? '+' : ''}${c.change7dPercent}%`}
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
        تعديل الدرجة الكلي: {regime.totalAdjustment > 0 ? '+' : ''}{regime.totalAdjustment} (حد أقصى ±8) — مصادر متاحة: {regime.sourcesOk}/{regime.sourcesTotal}
      </div>
    </div>
  );
}

export function ProviderDots({ providers }: { providers: ProviderHealthInfo[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2 text-[9px] text-zinc-500">
      <span>مصادر البيانات:</span>
      {providers.length === 0 ? (
        <span className="text-zinc-600">لسه بتتجمع</span>
      ) : (
        providers.map((p) => {
          const healthy = p.lastOkAt && (!p.lastFailAt || p.lastOkAt >= p.lastFailAt);
          return (
            <span
              key={p.provider}
              title={p.lastError ? `آخر خطأ: ${p.lastError}` : 'يعمل'}
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
