// Learning system v2 - pure functions, no I/O, no side effects.
// Synthesis of external review guidance (freqtrade/jesse methodology + review Issues 13-16):
//  - REGIME-KEYED biases: a tag learned in a bull regime must not apply in a bear one.
//    Bias keys are "TAG|REGIME" with REGIME in BULLISH|BEARISH|UNKNOWN (from daily trend).
//  - RECENCY DECAY: evidence is weighted by a 30-day half-life (EWMA-style), so stale
//    lessons fade instead of persisting forever.
//  - REALIZED-R weighting: a TP1 win pays its true R multiple ((target1-entry)/(entry-stop)),
//    a stop loss costs -1R - not a flat binary count.
//  - CONFIDENCE scaling: full bias weight only after enough weighted evidence.
// All changes are audited by the caller (lessons ledger). No evidence -> no bias.
// Comments are English-only on purpose (codepage safety under shell tooling).

import type { StoredSignal } from '../shared/types';

export interface TagLearningStat {
  key: string; // "TAG|REGIME"
  tag: string;
  regime: string;
  samples: number; // decay-weighted
  wins: number; // decay-weighted
  losses: number; // decay-weighted
  winRatePercent: number;
  netR: number; // decay-weighted realized R
}

export interface LearningState {
  baselineWinRatePercent: number;
  totalResolved: number;
  perTag: TagLearningStat[];
  biases: Record<string, number>;
}

export interface LearningLesson {
  at: number;
  key: string;
  tag: string;
  regime: string;
  from: number;
  to: number;
  samples: number;
  tagWinRatePercent: number;
  baselineWinRatePercent: number;
}

const MIN_SAMPLES = 10;
const MIN_DEVIATION_POINTS = 8;
const MAX_BIAS = 3;
const MAX_APPLIED_BIAS = 5;
const DECAY_HALF_LIFE_DAYS = 30;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function regimeOf(s: StoredSignal): string {
  if (s.dailyTrend === 'BULLISH' || s.dailyTrend === 'BEARISH') return s.dailyTrend;
  return 'UNKNOWN';
}

/** Recency weight: 30-day half-life. Signals older than ~10 half-lives weigh ~0. */
function recencyWeight(generatedAt: number, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - generatedAt) / 86_400_000);
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
}

/** Realized R of a resolved signal: TP1 pays (target1-entry)/(entry-stop); SL costs 1R. */
export function realizedR(s: StoredSignal): number {
  const stopDist = s.entryPrice - s.stopLoss;
  if (!(stopDist > 0)) return 0;
  if (s.outcomes.resolution === 'TP1_FIRST') return (s.target1 - s.entryPrice) / stopDist;
  if (s.outcomes.resolution === 'SL_FIRST') return -1;
  return 0;
}

function isCountable(s: StoredSignal): boolean {
  if (s.isGateBlocked) return false;
  return s.outcomes.resolution === 'TP1_FIRST' || s.outcomes.resolution === 'SL_FIRST';
}

export function computeTagStats(signals: StoredSignal[], nowMs: number): TagLearningStat[] {
  const map = new Map<string, { wWins: number; wLosses: number; netR: number }>();
  for (const s of signals) {
    if (!isCountable(s)) continue;
    const w = recencyWeight(s.generatedAt, nowMs);
    const r = realizedR(s);
    const win = s.outcomes.resolution === 'TP1_FIRST';
    const regime = regimeOf(s);
    for (const tag of new Set(s.reasons.map((x) => x.tag))) {
      const key = `${tag}|${regime}`;
      const cur = map.get(key) ?? { wWins: 0, wLosses: 0, netR: 0 };
      if (win) cur.wWins += w;
      else cur.wLosses += w;
      cur.netR += r * w;
      map.set(key, cur);
    }
  }
  const out: TagLearningStat[] = [];
  for (const [key, v] of map) {
    const samples = v.wWins + v.wLosses;
    out.push({
      key,
      tag: key.split('|')[0],
      regime: key.split('|')[1] ?? 'UNKNOWN',
      samples: round2(samples),
      wins: round2(v.wWins),
      losses: round2(v.wLosses),
      winRatePercent: samples > 0 ? round1((v.wWins / samples) * 100) : 0,
      netR: round2(v.netR),
    });
  }
  return out.sort((a, b) => b.samples - a.samples);
}

export function baselineWinRatePercent(signals: StoredSignal[], nowMs: number): number {
  let wWins = 0;
  let wLosses = 0;
  for (const s of signals) {
    if (!isCountable(s)) continue;
    const w = recencyWeight(s.generatedAt, nowMs);
    if (s.outcomes.resolution === 'TP1_FIRST') wWins += w;
    else wLosses += w;
  }
  return wWins + wLosses > 0 ? round1((wWins / (wWins + wLosses)) * 100) : 0;
}

export function computeLearningState(signals: StoredSignal[], nowMs: number = Date.now()): LearningState {
  const baseline = baselineWinRatePercent(signals, nowMs);
  const perTag = computeTagStats(signals, nowMs);
  const biases: Record<string, number> = {};
  for (const t of perTag) {
    if (t.samples < MIN_SAMPLES) {
      biases[t.key] = 0;
      continue;
    }
    const dev = t.winRatePercent - baseline;
    if (Math.abs(dev) < MIN_DEVIATION_POINTS) {
      biases[t.key] = 0;
      continue;
    }
    const steps = Math.min(MAX_BIAS, Math.max(1, Math.round(Math.abs(dev) / 8)));
    // Confidence scaling (review Issue 16): evidence-weighted samples ramp the bias in.
    const confidence = Math.min(1, (t.samples - MIN_SAMPLES) / 30);
    biases[t.key] = Math.round((dev > 0 ? 1 : -1) * steps * confidence * 100) / 100;
  }
  let totalResolved = 0;
  for (const s of signals) {
    if (isCountable(s)) totalResolved++;
  }
  return { baselineWinRatePercent: baseline, totalResolved, perTag, biases };
}

export function diffLessons(
  oldBiases: Record<string, number>,
  newBiases: Record<string, number>,
  perTag: TagLearningStat[],
  baselineWinRatePercent: number,
  nowMs: number,
): LearningLesson[] {
  const statsByKey = new Map(perTag.map((t) => [t.key, t]));
  const lessons: LearningLesson[] = [];
  for (const key of Object.keys(newBiases)) {
    const from = oldBiases[key] ?? 0;
    const to = newBiases[key];
    if (from === to) continue;
    const st = statsByKey.get(key);
    lessons.push({
      at: nowMs,
      key,
      tag: st ? st.tag : key.split('|')[0],
      regime: st ? st.regime : key.split('|')[1] ?? 'UNKNOWN',
      from,
      to,
      samples: st ? st.samples : 0,
      tagWinRatePercent: st ? st.winRatePercent : 0,
      baselineWinRatePercent,
    });
  }
  return lessons;
}

function clampBias(sum: number): number {
  return Math.max(-MAX_APPLIED_BIAS, Math.min(MAX_APPLIED_BIAS, sum));
}

/** Plain-tag lookup (kept for simple configurations and tests). */
export function biasForReasons(reasonTags: string[], biases: Record<string, number>): number {
  let sum = 0;
  for (const t of new Set(reasonTags)) sum += biases[t] ?? 0;
  return clampBias(sum);
}

/**
 * Regime-aware lookup (v2): prefer "TAG|REGIME" keys, fall back to the plain "TAG" key
 * when no regime-specific entry exists. Sum over distinct tags, clamped to [-5, +5].
 */
export function biasForReasonsRegime(reasonTags: string[], regime: string, biases: Record<string, number>): number {
  let sum = 0;
  for (const t of new Set(reasonTags)) {
    sum += biases[`${t}|${regime}`] ?? biases[t] ?? 0;
  }
  return clampBias(sum);
}