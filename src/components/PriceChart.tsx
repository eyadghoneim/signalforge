import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ema, normalizeCandlesForChart } from '../../shared/indicators';
import { api, type SupportedAsset, type Candle, type Signal } from '../api';
import { t, type Lang, type TKey } from '../i18n';

interface Props {
  asset: SupportedAsset;
  signal?: Signal | null;
  lang: Lang;
}

const ASSET_TITLE_KEY: Record<SupportedAsset, TKey> = {
  BTC: 'assetBTC',
  ETH: 'assetETH',
  SOL: 'assetSOL',
  PAXG: 'assetPAXG',
};

export default function PriceChart({ asset, signal, lang }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema21Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastAssetRef = useRef<string>('');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [showLevels, setShowLevels] = useState<boolean>(true);

  // إنشاء الرسم البياني مرة واحدة وتثبيته في الحاوية
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
      priceLinesRef.current = [];
    };
  }, []);

  // دالة جلب البيانات
  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.klines(asset, '1h', 300);
      setCandles(normalizeCandlesForChart(res.candles));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // جلب البيانات عند تغير الأصل وتحديث دوري
  useEffect(() => {
    void loadData();
    const t = setInterval(() => {
      if (!document.hidden) void loadData();
    }, 60_000);
    return () => clearInterval(t);
  }, [asset]);

  // تحديث السلاسل
  useEffect(() => {
    const chart = chartRef.current;
    const ordered = normalizeCandlesForChart(candles);
    if (!chart || !candleSeriesRef.current || ordered.length === 0) return;

    candleSeriesRef.current.setData(
      ordered.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const closes = ordered.map((c) => c.close);
    const e21 = ema(closes, 21);
    const e50 = ema(closes, 50);
    ema21Ref.current?.setData(
      ordered.map((c, i) => ({ time: c.time as UTCTimestamp, value: e21[i] })).filter((p) => Number.isFinite(p.value)),
    );
    ema50Ref.current?.setData(
      ordered.map((c, i) => ({ time: c.time as UTCTimestamp, value: e50[i] })).filter((p) => Number.isFinite(p.value)),
    );

    if (lastAssetRef.current !== asset) {
      chart.timeScale().fitContent();
      lastAssetRef.current = asset;
    }
  }, [candles, asset]);

  // رسم وتحديث خطوط التوصية (Entry, Stop Loss, TP1, TP2, TP3)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // إزالة الخطوط السابقة أولاً
    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // تجاهل أي خط تمت إزالته بالفعل مع إعادة بناء الشارت
      }
    }
    priceLinesRef.current = [];

    // إذا تم تفعيل العرض وكانت التوصية تخص نفس الأصل
    if (showLevels && signal && signal.asset === asset && signal.entryPrice > 0) {
      const created: IPriceLine[] = [];

      // 1. سعر الدخول Entry (أزرق سماوي)
      created.push(
        series.createPriceLine({
          price: signal.entryPrice,
          color: '#38bdf8',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `ENTRY $${signal.entryPrice.toLocaleString('en-US')}`,
        }),
      );

      // 2. وقف الخسارة Stop Loss (أحمر وردي)
      if (signal.stopLoss > 0) {
        created.push(
          series.createPriceLine({
            price: signal.stopLoss,
            color: '#f43f5e',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `SL $${signal.stopLoss.toLocaleString('en-US')}`,
          }),
        );
      }

      // 3. الهدف الأول TP1 (أخضر زمردي)
      if (signal.target1 > 0) {
        created.push(
          series.createPriceLine({
            price: signal.target1,
            color: '#10b981',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `TP1 $${signal.target1.toLocaleString('en-US')}`,
          }),
        );
      }

      // 4. الهدف الثاني TP2 (أخضر داكن)
      if (signal.target2 > 0) {
        created.push(
          series.createPriceLine({
            price: signal.target2,
            color: '#059669',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `TP2 $${signal.target2.toLocaleString('en-US')}`,
          }),
        );
      }

      // 5. الهدف الثالث TP3 (أخضر عميق)
      if (signal.target3 > 0) {
        created.push(
          series.createPriceLine({
            price: signal.target3,
            color: '#047857',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `TP3 $${signal.target3.toLocaleString('en-US')}`,
          }),
        );
      }

      priceLinesRef.current = created;
    }

    return () => {
      for (const line of priceLinesRef.current) {
        try {
          series.removePriceLine(line);
        } catch {
          // cleanup
        }
      }
      priceLinesRef.current = [];
    };
  }, [signal, asset, showLevels]);

  const hasSignalLevels = Boolean(signal && signal.asset === asset && signal.entryPrice > 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-bold text-zinc-300">
            {t(lang, ASSET_TITLE_KEY[asset])} — {t(lang, 'chartTitleSuffix')}
          </div>
          {hasSignalLevels && (
            <button
              onClick={() => setShowLevels(!showLevels)}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-bold transition ${
                showLevels
                  ? 'border border-amber-400/40 bg-amber-400/10 text-amber-300'
                  : 'border border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              🎯 {lang === 'ar' ? (showLevels ? 'إخفاء مستويات التوصية' : 'إظهار مستويات التوصية') : (showLevels ? 'Hide Levels' : 'Show Levels')}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="flex items-center gap-1 text-zinc-400">
            <span className="h-0.5 w-3 rounded bg-amber-400" /> EMA21
          </span>
          <span className="flex items-center gap-1 text-zinc-400">
            <span className="h-0.5 w-3 rounded bg-sky-400" /> EMA50
          </span>
          {showLevels && hasSignalLevels && signal && (
            <div className="flex flex-wrap items-center gap-1.5 border-r border-zinc-800 pr-2 font-mono" dir="ltr">
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-400">
                Entry: ${signal.entryPrice.toLocaleString('en-US')}
              </span>
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">
                SL: ${signal.stopLoss.toLocaleString('en-US')}
              </span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                TP1: ${signal.target1.toLocaleString('en-US')}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="relative h-72 w-full sm:h-80">
        <div ref={containerRef} className="h-full w-full" />
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-zinc-950/85 p-4 text-center backdrop-blur-sm">
            <div className="text-sm font-semibold text-rose-300">
              {t(lang, 'chartError')}: {error}
            </div>
            <button
              onClick={() => void loadData()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-200 transition hover:bg-zinc-700 hover:text-white"
            >
              {lang === 'ar' ? 'إعادة المحاولة 🔄' : 'Retry 🔄'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
