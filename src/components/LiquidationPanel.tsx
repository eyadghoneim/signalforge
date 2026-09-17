import { useState, useEffect } from 'react';
import { Flame, Zap } from 'lucide-react';
import { api, type SupportedAsset, type LiquidationRadar } from '../api';
import { t, type Lang } from '../i18n';

// معلش — النسخة دي بتعتمد على i18n للجزء الثابت بس، والجزء المتحرك عربي/إنجليزي معاً
const TXT = {
  ar: {
    title: 'رادار التصفية',
    subtitle: 'بيانات حقيقية من OKX (آخر عمليات التصفية المعلنة — ليست إجمالي السوق)',
    long: 'تصفية شراء',
    short: 'تصفية بيع',
    load: 'جاري جلب الرادار…',
    noData: 'لا توجد تصفيات حديثة أو الأصل بلا عقود دائمة (مثل PAXG)',
    note: 'قراءة: كتلة تصفية مراكز الشراء (longs) = ضغط بيعي مضاعف محتمل، والعكس.',
  },
  en: {
    title: 'Liquidation radar',
    subtitle: 'Real data from OKX (latest public liquidations — not market total)',
    long: 'Long liqs',
    short: 'Short liqs',
    load: 'Loading radar…',
    noData: 'No recent liquidations or asset has no perpetuals (e.g. PAXG)',
    note: 'Read: a cluster of long liquidations = possible cascading sell pressure, and vice versa.',
  },
};

export default function LiquidationPanel({ asset, lang }: { asset: SupportedAsset; lang: Lang }) {
  const [radar, setRadar] = useState<LiquidationRadar | null>(null);
  const [loading, setLoading] = useState(true);
  const x = TXT[lang];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const load_ = async () => {
      const r = await api.liquidations(asset);
      if (alive) {
        setRadar(r.radar);
        setLoading(false);
      }
    };
    void load_();
    const t = setInterval(() => void load_(), 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [asset]);

  if (loading) return <div className="text-xs text-zinc-500">{x.load}</div>;

  if (!radar || radar.events.length === 0) {
    return (
      <div className="text-xs text-zinc-500">
        <Flame size={13} className="inline text-zinc-600" /> {x.noData}
      </div>
    );
  }

  const longPct = radar.longSizeUsd + radar.shortSizeUsd > 0 ? Math.round((radar.longSizeUsd / (radar.longSizeUsd + radar.shortSizeUsd)) * 100) : 50;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
          <Zap size={16} className="text-amber-400" />
          {x.title}
          <span className="text-[9px] font-normal text-zinc-500" dir="ltr">{asset}</span>
        </div>
      </div>
      <p className="mb-3 text-[10px] leading-4 text-zinc-500">{x.subtitle}</p>

      {/* شريط التوازن */}
      <div className="mb-2 flex h-3 overflow-hidden rounded-full bg-zinc-800" dir="ltr">
        <div className="flex h-full items-center justify-center bg-rose-500/70 text-[8px] font-bold text-white" style={{ width: `${100 - longPct}%` }}>
          {100 - longPct > 15 ? x.short : ''}
        </div>
        <div className="flex h-full items-center justify-center bg-emerald-500/70 text-[8px] font-bold text-white" style={{ width: `${longPct}%` }}>
          {longPct > 15 ? x.long : ''}
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-rose-500/10 p-2">
          <div className="text-[9px] text-rose-300/80">{x.short} ({radar.shortCount})</div>
          <div className="text-sm font-extrabold tabular-nums text-rose-300" dir="ltr">${radar.shortSizeUsd.toLocaleString('en-US')}</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <div className="text-[9px] text-emerald-300/80">{x.long} ({radar.longCount})</div>
          <div className="text-sm font-extrabold tabular-nums text-emerald-300" dir="ltr">${radar.longSizeUsd.toLocaleString('en-US')}</div>
        </div>
      </div>

      {/* آخر أحداث التصفية */}
      <div className="space-y-1">
        {radar.events.slice(0, 6).map((e, i) => (
          <div key={i} className="flex items-center justify-between text-[10px]">
            <span className={`font-bold ${e.posSide === 'long' ? 'text-emerald-300' : 'text-rose-300'}`}>
              {e.posSide === 'long' ? 'LONG' : 'SHORT'}
            </span>
            <span className="text-zinc-400" dir="ltr">${e.price.toLocaleString('en-US')}</span>
            <span className="text-zinc-500" dir="ltr">${e.sizeUsd.toLocaleString('en-US')}</span>
            <span className="text-zinc-600" dir="ltr">{new Date(e.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
      </div>

      <p className="mt-2 border-t border-zinc-800 pt-2 text-[9px] leading-4 text-zinc-600">{x.note}</p>
    </div>
  );
}
