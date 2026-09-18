// محرك الباك تست: نفس محرك الإشارات الحي بالحرف — على شموع تاريخية حقيقية
import type { Candle, SupportedAsset, BacktestTrade, BacktestResult, MonthlyStat, RobustnessCell, SmcSnapshot, WalkForwardCell, WalkForwardResult } from '../shared/types';
import {
  computeHtfSnapshot,
  computeSmcStructure,
  computeDailyTrend,
  resample,
  ema,
  rsi,
  macd,
  atr as atrSeries,
  adx,
  bollinger,
  relativeVolume,
  type IndicatorSnapshot,
} from '../shared/indicators';
import { computeRiskTargets, STRATEGY_RISK_MULTIPLIERS, TRAILING } from '../shared/strategyConstants';
import { computePerformanceStats } from './performance';
import { buildSignal } from './signalEngine';

export interface BacktestOptions {
  riskPercent: number; // مخاطرة لكل صفقة % من الرصيد
  feePercent: number; // عمولة كل جانب
  cooldownCandles: number; // فترة تهدئة بعد الخروج (شموع 1h)
  initialEquity: number;
  entryMinScore: number; // فلتر إضافي للدرجة (0 = افتراضي المحرك)
  adxFloor: number;
  slippagePercent: number; // فلتر إضافي لقوة الاتجاه (0 = بلا فلتر)
}

export const DEFAULT_BACKTEST_OPTIONS: BacktestOptions = {
  riskPercent: 1,
  feePercent: 0.1,
  cooldownCandles: 4,
  initialEquity: 10000,
  entryMinScore: 0,
  adxFloor: 0,
  slippagePercent: 0.05,
};

interface OpenPosition {
  entry: number;
  entryTime: number;
  qty: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  remainingRatio: number; // 1 → 0.5 → 0.2 → 0
  tp1Taken: boolean;
  tp2Taken: boolean;
  realizedPnl: number;
  entryFeeTotal: number;
  score: number;
  trailAtr: number;
  trailPeak: number;
}

/** ينفذ الباك تست على شموع 1h (يفترض ≥ 1200 شمعة تشمل فترة إحماء المؤشرات) */
export function runBacktest(
  asset: SupportedAsset,
  candles1h: Candle[],
  opts: BacktestOptions = DEFAULT_BACKTEST_OPTIONS,
): BacktestResult {
  if (candles1h.length < 1200) {
    throw new Error(`بيانات غير كافية للباك تست (${candles1h.length} شمعة — المطلوب 1200+)`);
  }

  // ─── حساب المؤشرات مرة واحدة على السلسلة الكاملة (كل القيم causal — لا تسريب مستقبلي) ───
  const closes = candles1h.map((c) => c.close);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const r14 = rsi(closes, 14);
  const m = macd(closes);
  const a14 = atrSeries(candles1h, 14);
  const dmi = adx(candles1h, 14);
  const bb = bollinger(closes, 20, 2);
  const rv = relativeVolume(candles1h, 20);

  // ─── فريم 4h من نفس البيانات ───
  const htf = resample(candles1h, 14400);
  const htfCloses = htf.map((c) => c.close);
  void htfCloses;

  // آخر شمعة 1h داخل كل دلو 4h — نستخدم فقط الدلوس المكتملة (بلا تسريب)
  const htfLast1hIndex: number[] = [];
  {
    let hIdx = -1;
    let currentBucket = -1;
    for (let i = 0; i < candles1h.length; i++) {
      const bucket = Math.floor(candles1h[i].time / 14400) * 14400;
      if (bucket !== currentBucket) {
        hIdx++;
        currentBucket = bucket;
      }
      htfLast1hIndex[hIdx] = i;
    }
  }

  // ─── الفريم اليومي من نفس البيانات + خريطة دلوس مكتملة ───
  const daily = resample(candles1h, 86400);
  const dailyLast1hIndex: number[] = [];
  {
    let dIdx = -1;
    let currentBucket = -1;
    for (let i = 0; i < candles1h.length; i++) {
      const bucket = Math.floor(candles1h[i].time / 86400) * 86400;
      if (bucket !== currentBucket) {
        dIdx++;
        currentBucket = bucket;
      }
      dailyLast1hIndex[dIdx] = i;
    }
  }

  function snapshotAt(i: number): IndicatorSnapshot | null {
    const close = closes[i];
    const atr14 = a14[i];
    const ema21 = e21[i];
    const ema50 = e50[i];
    const adx14 = dmi.adx[i];
    const bbU = bb.upper[i];
    const bbL = bb.lower[i];
    if ([close, atr14, ema21, ema50, adx14, bbU, bbL].some((v) => Number.isNaN(v))) return null;
    const distancePct = Math.abs(close - ema50) / close;
    let emaTrend: IndicatorSnapshot['emaTrend'] = 'NEUTRAL';
    if (close > ema21 && ema21 > ema50) emaTrend = distancePct > 0.03 ? 'STRONG_BULLISH' : 'BULLISH';
    else if (close < ema21 && ema21 < ema50) emaTrend = distancePct > 0.03 ? 'STRONG_BEARISH' : 'BEARISH';
    const bbRange = bbU - bbL;
    return {
      index: i,
      close,
      volume: candles1h[i].volume,
      ema21,
      ema50,
      rsi14: r14[i],
      macdHist: m.hist[i],
      macdHistPrev: m.hist[i - 1],
      atr14,
      atrPercent: (atr14 / close) * 100,
      adx14,
      plusDI: dmi.plusDI[i],
      minusDI: dmi.minusDI[i],
      bbPercentB: bbRange > 0 ? (close - bbL) / bbRange : 0.5,
      rvol: Number.isNaN(rv[i]) ? 1 : rv[i],
      emaTrend,
    };
  }

  // ─── حلقة المحاكاة ───
  const WARMUP = 1000;
  // Round-trip cost model (review fix): entry fee + exit fee + slippage, charged at entry.
  const feeRate = (opts.feePercent * 2 + opts.slippagePercent) / 100;
  let equity = opts.initialEquity;
  let position: OpenPosition | null = null;
  let cooldownUntil = -1;
  const trades: BacktestTrade[] = [];
  const equityCurve: { time: number; equity: number; buyHold: number }[] = [];
  const firstPrice = candles1h[WARMUP].close;

  for (let i = WARMUP; i < candles1h.length; i++) {
    const candle = candles1h[i];

    // ─── 1) إدارة مركز مفتوح (افتُتح في شمعة سابقة) ───
    if (position) {
      // الوقف أولاً (متحفظ) — مع معالجة فجوة الفتح + انزلاق تنفيذي واقعي
      if (candle.low <= position.stop) {
        // انزلاق وقف السوق: أمر Stop-Market في الواقع يتنفذ أسوأ من سعر الوقف
        // وقت الفجوات والضغط. نحاكي ده بـ نسبة صغيرة من ATR بدل تنفيذ مثالي.
        const stopSlippage = position.trailAtr * STRATEGY_RISK_MULTIPLIERS.STOP_SLIPPAGE_ATR;
        const gapOpen = Math.min(candle.open, position.stop); // فجوة: تنفيذ على الفتح
        const exit = Math.min(gapOpen, position.stop - stopSlippage);
        const qtyPart = position.qty * position.remainingRatio;
        const pnl = (exit - position.entry) * qtyPart - position.entryFeeTotal * position.remainingRatio;
        position.realizedPnl += pnl;
        const reason: BacktestTrade['exitReason'] = position.tp2Taken ? 'TP2_SL' : position.tp1Taken ? 'TP1_SL' : 'SL';
        const pos = position;
        position = null;
        recordAndClose(pos, exit, reason, candle.time, pnl);
      } else {
        // سلّم الأهداف
        if (!position.tp1Taken && candle.high >= position.tp1) {
          const qtyPart = position.qty * 0.5;
          position.realizedPnl += (position.tp1 - position.entry) * qtyPart - position.entryFeeTotal * 0.5;
          position.remainingRatio -= 0.5;
          position.tp1Taken = true;
          position.stop = position.entry; // وقف تعادل بعد TP1
        }
        if (position.tp1Taken && !position.tp2Taken && candle.high >= position.tp2) {
          const qtyPart = position.qty * 0.3;
          position.realizedPnl += (position.tp2 - position.entry) * qtyPart - position.entryFeeTotal * 0.3;
          position.remainingRatio -= 0.3;
          position.tp2Taken = true;
        }
        if (position.tp2Taken && candle.high >= position.tp3) {
          const qtyPart = position.qty * position.remainingRatio;
          position.realizedPnl += (position.tp3 - position.entry) * qtyPart - position.entryFeeTotal * position.remainingRatio;
          position.remainingRatio = 0;
        }
        if (position.remainingRatio <= 0) {
          const pos = position;
          const avgExit = computeAvgExit(pos);
          position = null;
          recordAndClose(pos, avgExit, 'TP3', candle.time, pos.realizedPnl);
        }
      }
      // freqtrade-style active trailing after TP2: wait for 1×ATR profit, then
      // follow the peak with 2×ATR margin, tightening to 1×ATR above 2×ATR profit.
      if (position && position.tp2Taken) {
        if (trailingActivated(position.entry, candle.high, position.trailAtr)) {
          position.stop = computeTrailingStop(position.stop, position.trailPeak, candle.high, position.trailAtr, 2, position.entry);
        }
        position.trailPeak = Math.max(position.trailPeak, candle.high);
      }
    }

    // ─── 2) إشارة جديدة (عند عدم وجود مركز) ───
    if (!position && i >= cooldownUntil) {
      const snap = snapshotAt(i);
      if (snap) {
        // آخر دلو 4h مكتمل قبل هذه الشمعة
        let hIdx = -1;
        for (let k = 0; k < htfLast1hIndex.length; k++) {
          if (htfLast1hIndex[k] < i) hIdx = k;
          else break;
        }
        const htfSnap = hIdx >= 200 ? computeHtfSnapshot(htf, hIdx) : null;
        // آخر دلو يومي مكتمل
        let dIdx = -1;
        for (let k = 0; k < dailyLast1hIndex.length; k++) {
          if (dailyLast1hIndex[k] < i) dIdx = k;
          else break;
        }
        const dailySnap = dIdx >= 70 ? computeDailyTrend(daily, dIdx) : null;
        // بنية SMC على نافذة 160 شمعة حتى i
        const smcSnap: SmcSnapshot | null = computeSmcStructure(candles1h, i, snap.atr14);
        const sig = buildSignal({
          asset,
          snapshot: snap,
          htf: htfSnap,
          fundingPct8h: null, // قيد تاريخي معلن: التمويل التاريخي غير متوفر مجاناً
          change24h: 0,
          dataSource: 'LIVE',
          gates: { htf: true, chop: true, rvol: true, funding: true },
          smc: smcSnap,
          daily: dailySnap,
          // طبقة السيولة معطلة داخل الباك تست — بياناتها التاريخية غير متاحة مجاناً (قيد معلن)
          candles: candles1h.slice(0, i + 1), // لا تسرّب: الأنماط تقرأ حتى اللحظة i فقط
        });

        const entryAllowed =
          sig.spotAction === 'SPOT_BUY' &&
          (opts.entryMinScore <= 0 || sig.convictionScore >= opts.entryMinScore) &&
          (opts.adxFloor <= 0 || snap.adx14 >= opts.adxFloor);

        if (entryAllowed) {
          const targets = computeRiskTargets(snap.close, snap.atr14);
          const riskAmount = equity * (opts.riskPercent / 100);
          const perUnitRisk = Math.max(snap.close - targets.stopLoss, snap.close * 0.001);
          let qty = riskAmount / perUnitRisk;
          const notional = qty * snap.close;
          if (notional > equity * 0.95) qty = (equity * 0.95) / snap.close;
          const entryFeeTotal = qty * snap.close * feeRate;
          position = {
            entry: snap.close,
            entryTime: candle.time,
            qty,
            stop: targets.stopLoss,
            tp1: targets.target1,
            tp2: targets.target2,
            tp3: targets.target3,
            remainingRatio: 1,
            tp1Taken: false,
            tp2Taken: false,
            realizedPnl: 0,
            entryFeeTotal,
            score: sig.convictionScore,
            trailAtr: snap.atr14,
            trailPeak: 0,
          };
        }
      }
    }
  }

  function computeAvgExit(pos: OpenPosition): number {
    // متوسط سعر خروج تقديري لصفقة اكتملت بسلم الأهداف
    return (pos.tp1 * 0.5 + pos.tp2 * 0.3 + pos.tp3 * 0.2);
  }

  function recordAndClose(
    pos: OpenPosition,
    exitAvgPrice: number,
    reason: BacktestTrade['exitReason'],
    time: number,
    pnlExtra: number,
  ): void {
    trades.push({
      entryTime: pos.entryTime,
      exitTime: time,
      entry: pos.entry,
      exitAvgPrice: Number(exitAvgPrice.toFixed(2)),
      qty: Number(pos.qty.toFixed(6)),
      pnlUsd: Number((pos.realizedPnl).toFixed(2)),
      exitReason: reason,
      signalScore: pos.score,
    });
    void pnlExtra;
    equity += pos.realizedPnl;
    const idx = candles1h.findIndex((c) => c.time === time);
    const bh = idx >= 0 ? opts.initialEquity * (candles1h[idx].close / firstPrice) : opts.initialEquity;
    equityCurve.push({ time, equity: Number(equity.toFixed(2)), buyHold: Number(bh.toFixed(2)) });
    cooldownUntil = idx + opts.cooldownCandles;
  }

  // ─── صفقة مفتوحة في النهاية → تُقفل على آخر إغلاق ───
  if (position && position.remainingRatio > 0) {
    const lastCandle = candles1h[candles1h.length - 1];
    const qtyPart = position.qty * position.remainingRatio;
    position.realizedPnl += (lastCandle.close - position.entry) * qtyPart - position.entryFeeTotal * position.remainingRatio;
    const pos = position;
    position = null;
    recordAndClose(pos, lastCandle.close, 'END', lastCandle.time, pos.realizedPnl);
  }

  // ─── الإحصائيات ───
  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const grossWin = trades.filter((t) => t.pnlUsd > 0).reduce((a, t) => a + t.pnlUsd, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnlUsd <= 0).reduce((a, t) => a + t.pnlUsd, 0));
  const profitFactor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? null : 0;

  let peak = opts.initialEquity;
  let maxDD = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    maxDD = Math.max(maxDD, ((peak - p.equity) / peak) * 100);
  }

  const lastCandle = candles1h[candles1h.length - 1];
  const buyHoldFinal = Number((opts.initialEquity * (lastCandle.close / firstPrice)).toFixed(2));
  const finalEquity = Number(equity.toFixed(2));
  const outperform = finalEquity >= buyHoldFinal;

  if (equityCurve.length === 0 || equityCurve[equityCurve.length - 1].time !== lastCandle.time) {
    equityCurve.push({
      time: lastCandle.time,
      equity: finalEquity,
      buyHold: buyHoldFinal,
    });
  }

  // ─── الإحصائيات الشهرية — هل الأداء ثابت ولا شهر حظ؟ ───
  const monthlyMap = new Map<string, MonthlyStat>();
  for (const t of trades) {
    const d = new Date(t.exitTime * 1000);
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const cur = monthlyMap.get(monthKey) || { monthKey, trades: 0, wins: 0, winRatePercent: 0, pnlUsd: 0 };
    cur.trades++;
    if (t.pnlUsd > 0) cur.wins++;
    cur.pnlUsd = Number((cur.pnlUsd + t.pnlUsd).toFixed(2));
    monthlyMap.set(monthKey, cur);
  }
  const monthlyStats: MonthlyStat[] = [...monthlyMap.values()]
    .map((m) => ({ ...m, winRatePercent: m.trades ? Number(((m.wins / m.trades) * 100).toFixed(1)) : 0 }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  return {
    asset,
    period: { from: candles1h[WARMUP].time, to: lastCandle.time, candles: candles1h.length },
    startEquity: opts.initialEquity,
    finalEquity,
    buyHoldFinal,
    totalTrades: trades.length,
    wins,
    winRatePercent: trades.length ? Number(((wins / trades.length) * 100).toFixed(1)) : 0,
    profitFactor,
    maxDrawdownPercent: Number(maxDD.toFixed(1)),
    performance: computePerformanceStats(trades, equityCurve, opts.initialEquity, opts.riskPercent),
    trades: trades.slice(-50).reverse(),
    equityCurve,
    verdictAr: outperform
      ? '✅ تفوقت الاستراتيجية على الشراء والاحتفاظ في هذه الفترة — لكن النتائج التاريخية لا تضمن المستقبل'
      : '⚠️ الاستراتيجية أدّت أقل من الشراء والاحتفاظ بعد العمولات في هذه الفترة — هذه أداة بحثية وليست نصيحة استثمارية',
    limitsAr: [
      'بوابة التمويل معطلة داخل الباك تست (التمويل التاريخي غير متاح مجاناً) — القيد معلن بصدق',
      'طبقة السيولة (DefiLlama) معطلة داخل الباك تست — بياناتها التاريخية غير متاحة مجاناً',
      'الوقف يُنفذ بأسلوب متحفظ: لو الوقف والهدف في نفس الشمعة يُحسب الوقف أولاً',
      'العمولة 0.1% لكل جانب، مع انزلاق تفيذي 15% من ATR عند ضرب الوقف (محاكاة لواقع أوامر Stop-Market)',
    ],
    monthlyStats,
  };
}

/** شبكة المتانة: 3 مستويات درجة × 3 أرضيات ADX = 9 سيناريوهات — عشان نعرف هل النتائج حساسة للتضبيط أم لا */
export function runRobustness(
  asset: SupportedAsset,
  candles1h: Candle[],
  opts: BacktestOptions = DEFAULT_BACKTEST_OPTIONS,
): { base: BacktestResult; grid: RobustnessCell[] } {
  const base = runBacktest(asset, candles1h, opts);
  const entryLevels = [70, 75, 80];
  const adxFloors = [12, 18, 24];
  const grid: RobustnessCell[] = [];
  for (const entryMinScore of entryLevels) {
    for (const adxFloor of adxFloors) {
      const r = runBacktest(asset, candles1h, { ...opts, entryMinScore, adxFloor });
      grid.push({
        entryMinScore,
        adxFloor,
        totalTrades: r.totalTrades,
        winRatePercent: r.winRatePercent,
        profitFactor: r.profitFactor,
        finalEquity: r.finalEquity,
        maxDrawdownPercent: r.maxDrawdownPercent,
      });
    }
  }
  return { base, grid };
}

/**
 * Pure trailing-stop rule with freqtrade-style activation offset:
 * the stop does not ratchet until the running peak clears `entry + activationAtr * ATR`,
 * then it follows the peak with `offsetAtr * ATR` margin, tightening to `tightOffsetAtr`
 * once the peak profit reaches `tightAfterAtr * ATR`.
 * The stop may only ratchet up, never down.
 */
export function computeTrailingStop(
  currentStop: number,
  trailPeak: number,
  candleHigh: number,
  trailAtr: number,
  atrMultiplier = 2,
  entry?: number,
): number {
  const peak = Math.max(trailPeak, candleHigh);
  const offset = entry !== undefined ? resolveTrailingOffset(entry, peak, trailAtr, atrMultiplier) : atrMultiplier;
  const candidate = peak - offset * trailAtr;
  return Math.max(currentStop, candidate);
}

/** يختار هامش الرحل: مضيق فوق العتبة العليا، وإلا الافتراضي. */
export function resolveTrailingOffset(
  entry: number,
  peak: number,
  trailAtr: number,
  defaultMultiplier = 2,
): number {
  const profitAtr = trailAtr > 0 ? (peak - entry) / trailAtr : 0;
  if (profitAtr >= TRAILING.TIGHT_AFTER_ATR) return TRAILING.TIGHT_OFFSET_ATR;
  if (profitAtr >= TRAILING.ACTIVATE_AFTER_ATR) return TRAILING.OFFSET_ATR;
  // دون العتبة: لم يفعل الرحل — نحافظ على الوقف الحالي (الهامش عديم الأثر عملياً)
  return defaultMultiplier;
}

/** هل فعّل الرحل عند هذه القمة؟ (نفس عتبة التفعيل الرسمية) */
export function trailingActivated(entry: number, peak: number, trailAtr: number): boolean {
  return trailAtr > 0 && peak - entry >= TRAILING.ACTIVATE_AFTER_ATR * trailAtr;
}

/**
 * Walk-forward optimizer: grid-search entry/ADX thresholds on the first half
 * (in-sample), rank by OUT-OF-SAMPLE profit factor with a drawdown penalty.
 * The validation slice reuses the last 1000 candles of the in-sample half as
 * indicator warm-up only; trading starts exactly at the split index.
 */
export function runWalkForward(
  asset: SupportedAsset,
  candles1h: Candle[],
  opts: BacktestOptions = DEFAULT_BACKTEST_OPTIONS,
): WalkForwardResult {
  if (candles1h.length < 2400) {
    throw new Error(`Walk-forward needs >= 2400 candles (got ${candles1h.length})`);
  }
  const splitIdx = Math.floor(candles1h.length / 2);
  const firstHalf = candles1h.slice(0, splitIdx);
  const secondHalf = candles1h.slice(Math.max(0, splitIdx - 1000));
  const entryLevels = [0, 70, 75, 80];
  const adxFloors = [0, 12, 18, 24];
  const results: WalkForwardCell[] = [];
  for (const entryMinScore of entryLevels) {
    for (const adxFloor of adxFloors) {
      const o = runBacktest(asset, firstHalf, { ...opts, entryMinScore, adxFloor });
      const v = runBacktest(asset, secondHalf, { ...opts, entryMinScore, adxFloor });
      // Rank ONLY by in-sample performance; validation half is the honest out-of-sample verdict.
      const opf = o.profitFactor ?? (o.finalEquity > opts.initialEquity ? 99 : 0);
      results.push({
        entryMinScore,
        adxFloor,
        cooldownCandles: opts.cooldownCandles,
        optimizeTrades: o.totalTrades,
        optimizeProfitFactor: o.profitFactor,
        optimizeWinRatePercent: o.winRatePercent,
        optimizeMaxDrawdownPercent: o.maxDrawdownPercent,
        optimizeFinalEquity: o.finalEquity,
        validateTrades: v.totalTrades,
        validateProfitFactor: v.profitFactor,
        validateWinRatePercent: v.winRatePercent,
        validateMaxDrawdownPercent: v.maxDrawdownPercent,
        validateFinalEquity: v.finalEquity,
        score: Math.round((opf * 100 - o.maxDrawdownPercent) * 10) / 10 + Math.min(9, o.totalTrades) / 10,
      });
    }
  }
  // Tie-break: equal in-sample scores prefer more evidence (in-sample trades).
  results.sort((a, b) => b.score - a.score || b.optimizeTrades - a.optimizeTrades);
  return { splitIndex: splitIdx, results, best: results.length > 0 ? results[0] : null };
}