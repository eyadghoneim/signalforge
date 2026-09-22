import { useEffect, useState } from 'react';
import { Layers, ShieldCheck, AlertTriangle, RefreshCw, TrendingUp, TrendingDown, Anchor, Zap } from 'lucide-react';
import { api, type OrderBookDepth, type SupportedAsset } from '../api';
import type { Lang } from '../i18n';

interface Props {
  asset: SupportedAsset;
  lang: Lang;
}

export default function WhaleDepthPanel({ asset, lang }: Props) {
  const [data, setData] = useState<OrderBookDepth | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.depth(asset);
      if (res.ok && res.depth) {
        setData(res.depth);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const interval = setInterval(loadData, 15_000);
    return () => clearInterval(interval);
  }, [asset]);

  if (loading && !data) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/40 text-xs text-zinc-400">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin text-amber-400" />
        {lang === 'ar' ? 'جارٍ فحص دفتر الأوامر وجدران الحيتان...' : 'Fetching L2 Order Book & Whale Walls...'}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-800/40 bg-rose-950/20 p-4 text-xs text-rose-300">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle className="h-4 w-4 text-rose-400" />
          {lang === 'ar' ? 'تعذر جلب دفتر الأوامر' : 'Failed to fetch order book depth'}
        </div>
        <div className="mt-1 text-zinc-400">{error || 'No data'}</div>
        <button
          onClick={loadData}
          className="mt-3 rounded-lg border border-rose-700/50 bg-rose-900/30 px-3 py-1 text-xs text-rose-200 hover:bg-rose-900/50"
        >
          {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
        </button>
      </div>
    );
  }

  const bids = data.bids.slice(0, 8);
  const asks = data.asks.slice(0, 8);
  const maxBidVol = Math.max(...bids.map((b) => b.amount), 1);
  const maxAskVol = Math.max(...asks.map((a) => a.amount), 1);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
      {/* الترويسة العلوية */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 p-2 text-sky-400">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100">
                {lang === 'ar'
                  ? `دفتر الأوامر والسيولة وجدران الحيتان (${asset}/USDT)`
                  : `Order Book Depth & Whale Walls (${asset})`}
              </h3>
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                  data.isSimulated
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {data.source}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {lang === 'ar'
                ? 'رصد فوري لكتل الطلب والعرض المؤسسية وجدران الحيتان ومعدل اختلال السيولة'
                : 'Real-time institutional bid/ask volume clusters, whale walls, and order book imbalance'}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-white transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-amber-400' : 'text-zinc-400'}`} />
          <span>{lang === 'ar' ? 'تحديث السيولة' : 'Refresh Depth'}</span>
        </button>
      </div>

      {/* إفصاح صدق: البيانات المُحاكاة ليست دفتر أوامر حقيقياً */}
      {data.isSimulated && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-200/90">
          {lang === 'ar'
            ? '⚠️ تنبيه أمانة: تعذر الوصول لدفتر الأوامر الحي — المعروض الآن نموذج محاكاة حتمي مبني على آخر سعر معروف (الجدران والأحجام ليست أوامر حقيقية). لا تتخذ قرارات بناءً عليها.'
            : '⚠️ Honest notice: live order book is unreachable — what you see is a deterministic simulation built from the last known price (the walls/volumes are NOT real orders). Do not act on them.'}
        </div>
      )}

      {/* شريط توازن المشتري مقابل البائع */}
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="flex items-center gap-1 font-bold text-emerald-400">
            <TrendingUp className="h-4 w-4" />
            {lang === 'ar' ? 'ضغط الشراء (Bids): ' : 'Buyer Flow: '}
            {data.buyerPercentage}%
          </span>
          <span className="text-zinc-400">
            {lang === 'ar' ? 'نسبة عدم التوازن: ' : 'Imbalance: '}
            <strong className={data.imbalancePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {data.imbalancePercent > 0 ? `+${data.imbalancePercent}%` : `${data.imbalancePercent}%`}
            </strong>
          </span>
          <span className="flex items-center gap-1 font-bold text-rose-400">
            {data.sellerPercentage}%
            {lang === 'ar' ? ' :ضغط البيع (Asks)' : ' :Seller Flow'}
            <TrendingDown className="h-4 w-4" />
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800 flex">
          <div
            className="h-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${data.buyerPercentage}%` }}
          />
          <div
            className="h-full bg-rose-500 transition-all duration-500"
            style={{ width: `${data.sellerPercentage}%` }}
          />
        </div>
      </div>

      {/* بطاقات جدران الحيتان (Bid Wall & Ask Wall) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* جدار الشراء */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3">
          <div className="text-[11px] text-zinc-400 flex items-center justify-between">
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <Anchor className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'جدار الشراء (Whale Bid Wall)' : 'Whale Bid Wall'}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              -{data.bidWall?.distancePercent.toFixed(2)}%
            </span>
          </div>
          <div className="mt-1 text-base font-bold font-mono text-emerald-300">
            ${data.bidWall?.price.toLocaleString('en-US')}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            {lang === 'ar' ? 'حجم الطلب المتجمع: ' : 'Clustered Volume: '}
            <strong className="text-zinc-300 font-mono">{data.bidWall?.amount.toLocaleString('en-US')}</strong>
          </div>
        </div>

        {/* السعر الوسيط والانتشار */}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 text-center">
          <div className="text-[11px] text-zinc-500">{lang === 'ar' ? 'السعر الوسيط والفارق' : 'Mid Price & Spread'}</div>
          <div className="mt-1 text-base font-bold font-mono text-zinc-100">
            ${data.midPrice.toLocaleString('en-US')}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-400 font-mono flex items-center justify-center gap-1.5">
            <span>Spread: ${data.spread} ({data.spreadPercent}%)</span>
            {data.rule3Passed ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            )}
          </div>
        </div>

        {/* جدار البيع */}
        <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-3">
          <div className="text-[11px] text-zinc-400 flex items-center justify-between">
            <span className="flex items-center gap-1 text-rose-400 font-bold">
              <Zap className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'جدار البيع (Whale Ask Wall)' : 'Whale Ask Wall'}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              +{data.askWall?.distancePercent.toFixed(2)}%
            </span>
          </div>
          <div className="mt-1 text-base font-bold font-mono text-rose-300">
            ${data.askWall?.price.toLocaleString('en-US')}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            {lang === 'ar' ? 'حجم العرض المتجمع: ' : 'Clustered Volume: '}
            <strong className="text-zinc-300 font-mono">{data.askWall?.amount.toLocaleString('en-US')}</strong>
          </div>
        </div>
      </div>

      {/* جداول الطلبات والعروض المتعمقة جنبًا إلى جنب */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 font-mono text-xs" dir="ltr">
        {/* Bids (Green) */}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3 space-y-2">
          <div className="flex items-center justify-between text-zinc-400 border-b border-zinc-800 pb-1.5 font-sans font-bold">
            <span className="text-emerald-400">Bids (Buying Support)</span>
            <span>Volume (Cumulative)</span>
          </div>
          <div className="space-y-1">
            {bids.map((b, i) => {
              const widthPct = Math.min(100, Math.round((b.amount / maxBidVol) * 100));
              return (
                <div key={i} className="relative flex items-center justify-between px-2 py-1 overflow-hidden rounded">
                  <div
                    className="absolute inset-0 bg-emerald-500/10 pointer-events-none transition-all duration-300"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="relative font-bold text-emerald-400">${b.price.toLocaleString('en-US')}</span>
                  <span className="relative text-zinc-400">{b.amount} ({b.total})</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Asks (Red) */}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3 space-y-2">
          <div className="flex items-center justify-between text-zinc-400 border-b border-zinc-800 pb-1.5 font-sans font-bold">
            <span className="text-rose-400">Asks (Selling Resistance)</span>
            <span>Volume (Cumulative)</span>
          </div>
          <div className="space-y-1">
            {asks.map((a, i) => {
              const widthPct = Math.min(100, Math.round((a.amount / maxAskVol) * 100));
              return (
                <div key={i} className="relative flex items-center justify-between px-2 py-1 overflow-hidden rounded">
                  <div
                    className="absolute inset-0 bg-rose-500/10 pointer-events-none transition-all duration-300"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="relative font-bold text-rose-400">${a.price.toLocaleString('en-US')}</span>
                  <span className="relative text-zinc-400">{a.amount} ({a.total})</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
