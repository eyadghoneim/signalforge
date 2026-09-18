// كشف أنماط الشموع اليابانية (Japanese candlestick patterns).
// Pure + deterministic + zero network: تعمل على آخر شموع الجلسة فقط،
// وتُعدّ عاملاً واحداً إضافياً في المحرك — مستوحاة من فكرة مكتبة
// technicalindicators (MIT) لكن بكتابة مستقلة وشروط نسب محلية.
// Comments are English-only on purpose (codepage safety under shell tooling).

import type { Candle } from '../shared/types';

export type PatternDirection = 'BULLISH' | 'BEARISH';

export interface PatternHit {
  id: string; // stable machine id (used in tests/keys)
  nameAr: string;
  nameEn: string;
  direction: PatternDirection;
  weight: number; // suggested score adjustment magnitude
}

// ── Candle geometry helpers ────────────────────────────────────────────
const bodySize = (c: Candle) => Math.abs(c.close - c.open);
const rangeSize = (c: Candle) => Math.max(c.high - c.low, 1e-9);
const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close);
const lowerWick = (c: Candle) => Math.min(c.open, c.close) - c.low;
const isBull = (c: Candle) => c.close > c.open;
const isBear = (c: Candle) => c.close < c.open;

const BULLISH_ENGULFING: PatternHit = { id: 'bullish-engulfing', nameAr: 'ابتلاع صاعد', nameEn: 'Bullish Engulfing', direction: 'BULLISH', weight: 4 };
const BEARISH_ENGULFING: PatternHit = { id: 'bearish-engulfing', nameAr: 'ابتلاع هابط', nameEn: 'Bearish Engulfing', direction: 'BEARISH', weight: 4 };
const HAMMER: PatternHit = { id: 'hammer', nameAr: 'المطرقة', nameEn: 'Hammer', direction: 'BULLISH', weight: 3 };
const SHOOTING_STAR: PatternHit = { id: 'shooting-star', nameAr: 'الشهاب', nameEn: 'Shooting Star', direction: 'BEARISH', weight: 3 };
const MORNING_STAR: PatternHit = { id: 'morning-star', nameAr: 'نجمة الصباح', nameEn: 'Morning Star', direction: 'BULLISH', weight: 5 };
const EVENING_STAR: PatternHit = { id: 'evening-star', nameAr: 'نجمة المساء', nameEn: 'Evening Star', direction: 'BEARISH', weight: 5 };
const DOJI: PatternHit = { id: 'doji', nameAr: 'دوجي (تردّد)', nameEn: 'Doji (indecision)', direction: 'BULLISH', weight: 0 };

/**
 * Detect candlestick patterns over the last candles of a session.
 * Pure function: returns zero or more hits, strongest weight last is NOT assumed —
 * callers pick their policy. No network, no state.
 * Requires at least 1 candle (single-candle patterns) and reads up to 3 back.
 */
export function detectCandlePatterns(candles: Candle[]): PatternHit[] {
  const hits: PatternHit[] = [];
  if (!candles || candles.length === 0) return hits;

  const last = candles[candles.length - 1];
  const prev = candles.length >= 2 ? candles[candles.length - 2] : undefined;
  const prev2 = candles.length >= 3 ? candles[candles.length - 3] : undefined;

  // ── 1. Doji: tiny body relative to range ──
  if (bodySize(last) <= rangeSize(last) * 0.08) {
    hits.push(DOJI);
  }

  // ── 2. Hammer / Shooting Star (single candle, long vs short wick) ──
  if (bodySize(last) > 0) {
    const lowerShadow = lowerWick(last);
    const upperShadow = upperWick(last);
    const body = bodySize(last);
    if (lowerShadow >= body * 2 && upperShadow <= body * 0.6) {
      hits.push(HAMMER);
    }
    if (upperShadow >= body * 2 && lowerShadow <= body * 0.6) {
      hits.push(SHOOTING_STAR);
    }
  }

  // ── 3. Bullish / Bearish Engulfing (two candles) ──
  if (prev) {
    if (isBear(prev) && isBull(last)) {
      const bodyEngulfs = last.close >= prev.open && last.open <= prev.close;
      const realBody = bodySize(last) > bodySize(prev);
      if (bodyEngulfs && realBody) hits.push(BULLISH_ENGULFING);
    }
    if (isBull(prev) && isBear(last)) {
      const bodyEngulfs = last.open >= prev.close && last.close <= prev.open;
      const realBody = bodySize(last) > bodySize(prev);
      if (bodyEngulfs && realBody) hits.push(BEARISH_ENGULFING);
    }
  }

  // ── 4. Morning / Evening Star (three candles) ──
  if (prev && prev2) {
    const firstBigBear = isBear(prev2) && bodySize(prev2) > rangeSize(prev2) * 0.5;
    const middleSmall = bodySize(prev) <= rangeSize(prev) * 0.3;
    const lastBigBull = isBull(last) && last.close > (prev2.open + prev2.close) / 2;
    if (firstBigBear && middleSmall && lastBigBull) hits.push(MORNING_STAR);

    const firstBigBull = isBull(prev2) && bodySize(prev2) > rangeSize(prev2) * 0.5;
    const lastBigBear = isBear(last) && last.close < (prev2.open + prev2.close) / 2;
    if (firstBigBull && middleSmall && lastBigBear) hits.push(EVENING_STAR);
  }

  return hits;
}

/**
 * Resolve the detected hits into a single engine adjustment.
 * Policy: conflicting bull+bear signals cancel out (0). Otherwise the
 * strongest non-zero weighted hit dominates. Doji alone (weight 0) →
 * 0 adjustment but the caller may still record the reason for transparency.
 */
export function resolvePatternAdjustment(candles: Candle[] | undefined): {
  adjustment: number;
  hit: PatternHit | null;
  hits: PatternHit[];
} {
  const empty = { adjustment: 0, hit: null, hits: [] as PatternHit[] };
  if (!candles || candles.length === 0) return empty;
  const hits = detectCandlePatterns(candles);
  if (hits.length === 0) return { ...empty, hits };
  let bull = false;
  let bear = false;
  let best: PatternHit | null = null;
  for (const h of hits) {
    if (h.direction === 'BULLISH') bull = true;
    else bear = true;
    if (!best || Math.abs(h.weight) > Math.abs(best.weight)) best = h;
  }
  if (bull && bear) return { adjustment: 0, hit: null, hits }; // تعارض → حياد صريح
  const weight = best ? Math.abs(best.weight) : 0;
  const sign = bull ? 1 : -1;
  return { adjustment: sign * weight, hit: best, hits };
}
