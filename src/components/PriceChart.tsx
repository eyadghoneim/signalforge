import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { ema } from '../../shared/indicators';
import { api, type SupportedAsset, type Candle } from '../api';
import { t, type Lang, type TKey } from '../i18n';

interface Props {
  asset: SupportedAsset;
  lang: Lang;
}

const ASSET_TITLE_KEY: Record<SupportedAsset, TKey> = {
  BTC: 'assetBTC',
  ETH: 'assetETH',
  SOL: 'assetSOL',
  PAXG: 'assetPAXG',
};

export default function PriceChart({ asset, lang }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema21Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const lastAssetRef = useRef<string>('');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);

  // إنشاء الرسم مرة واحدة
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0c0c0f' },
        textColor: '#a1a1aa',
        fontFamily: 'Cairo, sans-serif',
        attributionLogo: false,
      },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      timeScale: { timeVisible: true, borderColor: '#27272a', secondsVisible: false },
      rightPriceScale: { borderColor: '#27272a' },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      borderVisible: false,
    });
    ema21Ref.current = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'EMA21',
    });
    ema50Ref.current = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'EMA50',
    });
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ema21Ref.current = null;
      ema50Ref.current = null;
    };
  }, []);

  // جلب البيانات
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.klines(asset, '1h', 300);
        if (!cancelled) {
          setCandles(res.candles);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [asset]);

  // تحديث السلاسل
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleSeriesRef.current || candles.length === 0) return;

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const closes = candles.map((c) => c.close);
    const e21 = ema(closes, 21);
    const e50 = ema(closes, 50);
    ema21Ref.current?.setData(
      candles.map((c, i) => ({ time: c.time as UTCTimestamp, value: e21[i] })).filter((p) => Number.isFinite(p.value)),
    );
    ema50Ref.current?.setData(
      candles.map((c, i) => ({ time: c.time as UTCTimestamp, value: e50[i] })).filter((p) => Number.isFinite(p.value)),
    );

    if (lastAssetRef.current !== asset) {
      chart.timeScale().fitContent();
      lastAssetRef.current = asset;
    }
  }, [candles, asset]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="text-sm font-bold text-zinc-300">
          {t(lang, ASSET_TITLE_KEY[asset])} — {t(lang, 'chartTitleSuffix')}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-amber-400" /> EMA21</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-sky-400" /> EMA50</span>
        </div>
      </div>
      {error ? (
        <div className="flex h-72 items-center justify-center text-sm text-rose-300">{t(lang, 'chartError')} {error}</div>
      ) : (
        <div ref={containerRef} className="h-72 w-full sm:h-80" />
      )}
    </div>
  );
}
