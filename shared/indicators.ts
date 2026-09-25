// مؤشرات فنية خالصة (بدون أي اعتماديات Node) — يستخدمها السيرفر والواجهة والباك تست
import type { Candle, SmcSnapshot, DailyTrend } from './types';
import { STRATEGY_THRESHOLDS } from './strategyConstants';

export function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let acc = 0;
  for (let i = 0; i < period; i++) acc += values[i];
  out[period - 1] = acc / period; // بذرة SMA
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { line: number[]; signal: number[]; hist: number[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line: number[] = values.map((_, i) =>
    Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i],
  );
  const valid = line.filter((v) => !Number.isNaN(v));
  const sigValid = ema(valid, signalPeriod);
  const signal: number[] = new Array(values.length).fill(NaN);
  let j = 0;
  for (let i = 0; i < line.length; i++) {
    if (!Number.isNaN(line[i])) {
      signal[i] = sigValid[j];
      j++;
    }
  }
  const hist: number[] = values.map((_, i) =>
    Number.isNaN(signal[i]) ? NaN : line[i] - signal[i],
  );
  return { line, signal, hist };
}

export function trueRanges(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      out[i] = candles[i].high - candles[i].low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    out[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    );
  }
  return out;
}

export function atr(candles: Candle[], period = 14): number[] {
  const tr = trueRanges(candles);
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return out;
  let acc = 0;
  for (let i = 1; i <= period; i++) acc += tr[i];
  let prev = acc / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function adx(
  candles: Candle[],
  period = 14,
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const n = candles.length;
  const adxOut: number[] = new Array(n).fill(NaN);
  const plusDI: number[] = new Array(n).fill(NaN);
  const minusDI: number[] = new Array(n).fill(NaN);
  if (n <= period * 2) return { adx: adxOut, plusDI, minusDI };

  const tr = trueRanges(candles);
  let plusDM = 0;
  let minusDM = 0;
  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM += up > down && up > 0 ? up : 0;
    minusDM += down > up && down > 0 ? down : 0;
    trSum += tr[i];
  }
  const dxSeries: number[] = new Array(n).fill(NaN);
  let prevPlusDI = 0;
  let prevMinusDI = 0;
  for (let i = period; i < n; i++) {
    if (i > period) {
      const up = candles[i].high - candles[i - 1].high;
      const down = candles[i - 1].low - candles[i].low;
      const pdm = up > down && up > 0 ? up : 0;
      const mdm = down > up && down > 0 ? down : 0;
      plusDM = plusDM - plusDM / period + pdm;
      minusDM = minusDM - minusDM / period + mdm;
      trSum = trSum - trSum / period + tr[i];
    }
    const pdi = trSum > 0 ? (100 * plusDM) / trSum : 0;
    const mdi = trSum > 0 ? (100 * minusDM) / trSum : 0;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const denom = pdi + mdi;
    dxSeries[i] = denom > 0 ? (100 * Math.abs(pdi - mdi)) / denom : 0;
    if (i >= period * 2 - 1) {
      const start = period * 2 - 1;
      if (i === start) {
        let sum = 0;
        let count = 0;
        for (let j = period; j <= i; j++) {
          if (!Number.isNaN(dxSeries[j])) {
            sum += dxSeries[j];
            count++;
          }
        }
        adxOut[i] = count > 0 ? sum / count : NaN;
      } else {
        adxOut[i] = (adxOut[i - 1] * (period - 1) + dxSeries[i]) / period;
      }
    }
  }
  return { adx: adxOut, plusDI, minusDI };
}

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { upper: number[]; mid: number[]; lower: number[] } {
  const mid = sma(values, period);
  const upper: number[] = new Array(values.length).fill(NaN);
  const lower: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mid[i];
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { upper, mid, lower };
}

export function relativeVolume(candles: Candle[], baseline = 20): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (i < baseline) continue;
    let sum = 0;
    for (let j = i - baseline; j < i; j++) sum += candles[j].volume;
    const avg = sum / baseline;
    out[i] = avg > 0 ? candles[i].volume / avg : 1;
  }
  return out;
}

// إعادة تشكيل شموع 1h إلى 4h (للباك تست والـ HTF من مصدر بلا 4h)
export function resample(candles: Candle[], bucketSeconds: number): Candle[] {
  const out: Candle[] = [];
  let current: Candle | null = null;
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    if (!current || current.time !== bucket) {
      if (current) out.push(current);
      current = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      current.high = Math.max(current.high, c.high);
      current.low = Math.min(current.low, c.low);
      current.close = c.close;
      current.volume += c.volume;
    }
  }
  if (current) out.push(current);
  return out;
}

export interface IndicatorSnapshot {
  index: number;
  close: number;
  volume: number;
  ema21: number;
  ema50: number;
  rsi14: number;
  macdHist: number;
  macdHistPrev: number;
  atr14: number;
  atrPercent: number;
  adx14: number;
  plusDI: number;
  minusDI: number;
  bbPercentB: number;
  rvol: number;
  emaTrend: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
}

export interface HtfSnapshot {
  close: number;
  ema21: number;
  ema50: number;
  ema200: number;
  bearish: boolean;
  bullish: boolean;
}

const MIN_CANDLES = 70;
const MIN_HTF_CANDLES = STRATEGY_THRESHOLDS.HTF_EMA_PERIOD + 30;

/** Sort candles ascending and keep one valid candle per timestamp for chart APIs. */
export function normalizeCandlesForChart(candles: Candle[]): Candle[] {
  if (!Array.isArray(candles)) return [];
  const byTime = new Map<number, Candle>();
  for (const candle of candles) {
    if (
      !candle ||
      !Number.isFinite(candle.time) ||
      ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
      candle.close <= 0
    ) continue;
    byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function computeSnapshot(candles: Candle[], index?: number): IndicatorSnapshot | null {
  if (!Array.isArray(candles) || candles.length < MIN_CANDLES) return null;
  const i = typeof index === 'number' ? index : candles.length - 1;
  if (i < MIN_CANDLES - 1 || i >= candles.length) return null;

  const closes = candles.map((c) => c.close);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = atr(candles, 14);
  const d = adx(candles, 14);
  const bb = bollinger(closes, 20, 2);
  const rv = relativeVolume(candles, 20);

  const close = candles[i].close;
  const atr14 = a[i];
  const ema21 = e21[i];
  const ema50 = e50[i];
  if ([ema21, ema50, atr14, d.adx[i], bb.upper[i]].some((v) => Number.isNaN(v))) return null;

  const distancePct = Math.abs(close - ema50) / close;
  let emaTrend: IndicatorSnapshot['emaTrend'] = 'NEUTRAL';
  if (close > ema21 && ema21 > ema50) emaTrend = distancePct > 0.03 ? 'STRONG_BULLISH' : 'BULLISH';
  else if (close < ema21 && ema21 < ema50) emaTrend = distancePct > 0.03 ? 'STRONG_BEARISH' : 'BEARISH';

  const bbRange = bb.upper[i] - bb.lower[i];
  const bbPercentB = bbRange > 0 ? (close - bb.lower[i]) / bbRange : 0.5;

  return {
    index: i,
    close,
    volume: candles[i].volume,
    ema21,
    ema50,
    rsi14: r[i],
    macdHist: m.hist[i],
    macdHistPrev: m.hist[i - 1],
    atr14,
    atrPercent: (atr14 / close) * 100,
    adx14: d.adx[i],
    plusDI: d.plusDI[i],
    minusDI: d.minusDI[i],
    bbPercentB,
    rvol: Number.isNaN(rv[i]) ? 1 : rv[i],
    emaTrend,
  };
}

export function computeHtfSnapshot(htfCandles: Candle[], index?: number): HtfSnapshot | null {
  if (!Array.isArray(htfCandles) || htfCandles.length < MIN_HTF_CANDLES) return null;
  const i = typeof index === 'number' ? index : htfCandles.length - 1;
  if (i < MIN_HTF_CANDLES - 1) return null;
  const closes = htfCandles.map((c) => c.close);
  const e21 = ema(closes, STRATEGY_THRESHOLDS.HTF_EMA_FAST);
  const e50 = ema(closes, STRATEGY_THRESHOLDS.HTF_EMA_SLOW);
  const e200 = ema(closes, STRATEGY_THRESHOLDS.HTF_EMA_PERIOD);
  const close = htfCandles[i].close;
  if ([e21[i], e50[i], e200[i]].some((v) => Number.isNaN(v))) return null;
  const belowEma = close < e200[i];
  const crossed = e21[i] < e50[i];
  const aboveEma = close > e200[i];
  const crossedUp = e21[i] > e50[i];
  return {
    close,
    ema21: e21[i],
    ema50: e50[i],
    ema200: e200[i],
    bearish: belowEma || crossed,
    bullish: aboveEma && crossedUp,
  };
}

// ═══════════════ v2.0: بنية السوق (SMC) والارتدادات والفريم اليومي ═══════════════

export interface Swing {
  index: number;
  price: number;
  kind: 'HIGH' | 'LOW';
}

export function findSwings(candles: Candle[], left = 3, right = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) out.push({ index: i, price: candles[i].high, kind: 'HIGH' });
    if (isLow) out.push({ index: i, price: candles[i].low, kind: 'LOW' });
  }
  return out;
}

export function computeSmcStructure(
  candles: Candle[],
  index?: number,
  atr14Value?: number,
): SmcSnapshot | null {
  const i = typeof index === 'number' ? index : candles.length - 1;
  if (!candles || candles.length < 40 || i < 40) return null;

  // القمم/القيعان المؤكدة فقط (مكتملة من الجانبين) — من غير القمم الأخيرة لسه متكونة
  const window = candles.slice(Math.max(0, i - 160), i - 2);
  const swings = findSwings(window, 3, 3);
  const highs = swings.filter((s) => s.kind === 'HIGH');
  const lows = swings.filter((s) => s.kind === 'LOW');
  const lastSwingHigh = highs.length ? highs[highs.length - 1] : null;
  const lastSwingLow = lows.length ? lows[lows.length - 1] : null;

  const close = candles[i].close;
  let structure: SmcSnapshot['structure'] = 'RANGE';
  if (lastSwingHigh && close > lastSwingHigh.price) structure = 'BULLISH_BOS';
  else if (lastSwingLow && close < lastSwingLow.price) structure = 'BEARISH_BOS';

  // منطقة الطلب: آخر شمعة معاكسة قبل دفعة الكسر (تبسيط صريح ومعلن)
  let orderBlock: SmcSnapshot['orderBlock'] = null;
  if (structure === 'BULLISH_BOS') {
    for (let k = i; k > Math.max(0, i - 15); k--) {
      if (candles[k].close < candles[k].open) {
        orderBlock = { low: candles[k].low, high: candles[k].high, kind: 'BULLISH' };
        break;
      }
    }
  } else if (structure === 'BEARISH_BOS') {
    for (let k = i; k > Math.max(0, i - 15); k--) {
      if (candles[k].close > candles[k].open) {
        orderBlock = { low: candles[k].low, high: candles[k].high, kind: 'BEARISH' };
        break;
      }
    }
  }

  const atr14v = atr14Value !== undefined && Number.isFinite(atr14Value) ? atr14Value : atr(candles, 14)[i];
  let nearOrderBlock = false;
  if (orderBlock && Number.isFinite(atr14v)) {
    const inZone = close >= orderBlock.low && close <= orderBlock.high;
    const nearEdge =
      Math.min(Math.abs(close - orderBlock.low), Math.abs(close - orderBlock.high)) <= atr14v * 0.5;
    nearOrderBlock = inZone || nearEdge;
  }

  return {
    structure,
    lastSwingHigh: lastSwingHigh?.price ?? null,
    lastSwingLow: lastSwingLow?.price ?? null,
    orderBlock,
    nearOrderBlock,
  };
}

// منطقة دخولPullback: بين EMA21 وتصحيح 0.382-0.5 لآخر موجة
export function computePullbackZone(
  candles: Candle[],
  index?: number,
): { low: number; high: number; ema21: number } | null {
  const i = typeof index === 'number' ? index : candles.length - 1;
  if (!candles || candles.length < 60 || i < 60) return null;
  const window = candles.slice(Math.max(0, i - 120), i + 1);
  const closes = window.map((c) => c.close);
  const e21 = ema(closes, 21);
  const ema21 = e21[e21.length - 1];
  if (Number.isNaN(ema21)) return null;

  const swings = findSwings(window.slice(0, -1), 3, 3);
  const lows = swings.filter((s) => s.kind === 'LOW');
  const highs = swings.filter((s) => s.kind === 'HIGH');
  const lastLow = lows.length ? lows[lows.length - 1].price : Math.min(...window.map((c) => c.low));
  const lastHigh = highs.length ? highs[highs.length - 1].price : Math.max(...window.map((c) => c.high));

  const leg = lastHigh - lastLow;
  if (!Number.isFinite(leg) || leg <= 0) return null;
  const fib382 = lastHigh - leg * 0.382;
  const fib500 = lastHigh - leg * 0.5;
  return { low: Math.min(ema21, fib500), high: Math.max(ema21, fib382), ema21 };
}

// اتجاه الفريم اليومي (EMA20/50) — تأكيد الماكرو
export function computeDailyTrend(daily: Candle[], index?: number): DailyTrend | null {
  if (!Array.isArray(daily) || daily.length < 70) return null;
  const i = typeof index === 'number' ? index : daily.length - 1;
  if (i < 69) return null;
  const closes = daily.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const close = daily[i].close;
  if ([e20[i], e50[i]].some((v) => Number.isNaN(v))) return null;
  return {
    close,
    ema20: e20[i],
    ema50: e50[i],
    bearish: close < e50[i] || e20[i] < e50[i],
    bullish: close > e50[i] && e20[i] > e50[i],
  };
}

// ═══════════════ v2.1: توافق متعدد الفريمات (Multi-Timeframe Confluence - 15m / 1h / 4h / 1d) ═══════════════
export function computeMtfConfluence(
  snapshot15m: IndicatorSnapshot,
  htf4h: HtfSnapshot | null,
  daily: DailyTrend | null,
): import('./types').MultiTimeframeConfluence {
  const m15Bull = snapshot15m.emaTrend === 'BULLISH' || snapshot15m.emaTrend === 'STRONG_BULLISH' || snapshot15m.macdHist > 0;
  const m15Bear = snapshot15m.emaTrend === 'BEARISH' || snapshot15m.emaTrend === 'STRONG_BEARISH' || snapshot15m.macdHist < 0;
  const m15State: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = m15Bull && !m15Bear ? 'BULLISH' : m15Bear && !m15Bull ? 'BEARISH' : snapshot15m.close > snapshot15m.ema21 ? 'BULLISH' : 'BEARISH';

  // 4H Trend
  const h4State: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = htf4h
    ? (htf4h.bullish ? 'BULLISH' : htf4h.bearish ? 'BEARISH' : 'NEUTRAL')
    : 'NEUTRAL';

  // 1D Trend
  const d1State: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = daily
    ? (daily.bullish ? 'BULLISH' : daily.bearish ? 'BEARISH' : 'NEUTRAL')
    : 'NEUTRAL';

  // Intermediate 1H estimate based on 15m ADX + 4H alignment
  let h1State: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (m15State === 'BULLISH' && h4State === 'BULLISH') h1State = 'BULLISH';
  else if (m15State === 'BEARISH' && h4State === 'BEARISH') h1State = 'BEARISH';
  else h1State = m15State;

  let bullPoints = 0;
  let totalWeights = 0;

  // Weightings: 15m (25%), 1h (25%), 4h (30%), 1d (20%)
  const addWeight = (state: 'BULLISH' | 'BEARISH' | 'NEUTRAL', weight: number) => {
    totalWeights += weight;
    if (state === 'BULLISH') bullPoints += weight;
    else if (state === 'NEUTRAL') bullPoints += weight * 0.5;
  };

  addWeight(m15State, 25);
  addWeight(h1State, 25);
  addWeight(h4State, 30);
  addWeight(d1State, 20);

  const score = totalWeights > 0 ? Math.round((bullPoints / totalWeights) * 100) : 50;

  let alignment: import('./types').MultiTimeframeConfluence['alignment'] = 'NEUTRAL';
  if (score >= 80) alignment = 'STRONG_BULLISH';
  else if (score >= 60) alignment = 'BULLISH';
  else if (score <= 20) alignment = 'STRONG_BEARISH';
  else if (score <= 40) alignment = 'BEARISH';

  const summaryAr =
    alignment === 'STRONG_BULLISH'
      ? 'توافق صاعد قوي عبر جميع الفريمات (15د، 1س، 4س، يومي)'
      : alignment === 'BULLISH'
      ? 'اتجاه صاعد مدعوم من الفريمات الأكبر'
      : alignment === 'STRONG_BEARISH'
      ? 'توافق هابط قوي يحذر من أي صفقات شراء'
      : alignment === 'BEARISH'
      ? 'ضغط هابط على الفريمات الأكبر'
      : 'تضارب بين الفريمات (حالة تذبذب / حياد)';

  const summaryEn =
    alignment === 'STRONG_BULLISH'
      ? 'Strong bullish confluence across all timeframes (15m, 1h, 4h, 1d)'
      : alignment === 'BULLISH'
      ? 'Bullish alignment supported by higher timeframes'
      : alignment === 'STRONG_BEARISH'
      ? 'Strong bearish confluence warning against long entries'
      : alignment === 'BEARISH'
      ? 'Bearish pressure on higher timeframes'
      : 'Mixed timeframe alignment (chop / neutral regime)';

  return {
    score,
    alignment,
    timeframes: {
      m15: m15State,
      h1: h1State,
      h4: h4State,
      d1: d1State,
    },
    summaryAr,
    summaryEn,
  };
}

