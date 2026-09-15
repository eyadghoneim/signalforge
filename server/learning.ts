// Learning system - pure functions, no I/O, no side effects.
// The bot studies its own resolved signals and derives a BOUNDED bias per reason tag.
// Bias rule: a tag with >= 10 resolved samples whose win rate deviates >= 8 points from
// the overall baseline earns +/-1..3 bias (stepped by deviation, capped). A bias is only
// a small score nudge - never a gate, never an unbounded change. All changes are audited
// as lessons by the caller.
// Comments are English-only on purpose (codepage safety under shell tooling).

import type { StoredSignal } from '../shared/types';

export interface TagLearningStat {
  tag: string;
  samples: number;
  wins: number;
  losses: number;
  winRatePercent: number;
  netR: number;
}

export interface LearningState {
  baselineWinRatePercent: number;
  totalResolved: number;
  perTag: TagLearningStat[];
  biases: Record<string, number>;
}

export interface LearningLesson {
  at: number;
  tag: string;
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Per-tag win/loss stats over resolved actionable signals (one count per distinct tag per signal). */
export function computeTagStats(signals: StoredSignal[]): TagLearningStat[] {
  const map = new Map<string, { samples: number; wins: number; losses: number }>();
  for (const s of signals) {
    if (s.isGateBlocked) continue;
    const res = s.outcomes.resolution;
    if (res !== 'TP1_FIRST' && res !== 'SL_FIRST') continue;
    const win = res === 'TP1_FIRST';
    const tags = new Set<string>(s.reasons.map((r) => r.tag));
    for (const t of tags) {
      const cur = map.get(t) ?? { samples: 0, wins: 0, losses: 0 };
      cur.samples++;
      if (win) cur.wins++;
      else cur.losses++;
      map.set(t, cur);
    }
  }
  const out: TagLearningStat[] = [];
  for (const [tag, v] of map) {
    out.push({
      tag,
      samples: v.samples,
      wins: v.wins,
      losses: v.losses,
      winRatePercent: v.samples > 0 ? round1((v.wins / v.samples) * 100) : 0,
      netR: v.wins - v.losses,
    });
  }
  return out.sort((a, b) => b.samples - a.samples);
}

export function baselineWinRatePercent(signals: StoredSignal[]): number {
  let wins = 0;
  let losses = 0;
  for (const s of signals) {
    if (s.isGateBlocked) continue;
    const res = s.outcomes.resolution;
    if (res === 'TP1_FIRST') wins++;
    else if (res === 'SL_FIRST') losses++;
  }
  return wins + losses > 0 ? round1((wins / (wins + losses)) * 100) : 0;
}

/** Derive bounded biases from evidence. No evidence -> no bias. */
export function computeLearningState(signals: StoredSignal[]): LearningState {
  const baseline = baselineWinRatePercent(signals);
  const perTag = computeTagStats(signals);
  const biases: Record<string, number> = {};
  for (const t of perTag) {
    if (t.samples < MIN_SAMPLES) {
      biases[t.tag] = 0;
      continue;
    }
    const dev = t.winRatePercent - baseline;
    if (Math.abs(dev) < MIN_DEVIATION_POINTS) {
      biases[t.tag] = 0;
      continue;
    }
    const steps = Math.min(3, Math.max(1, Math.round(Math.abs(dev) / 8)));
    // Confidence scaling (review Issue 16): 10 samples = huge variance, so bias ramps
    // from 0 at MIN_SAMPLES to full weight at +30 samples (N >= 40).
    const confidence = Math.min(1, (t.samples - MIN_SAMPLES) / 30);
    biases[t.tag] = Math.round((dev > 0 ? 1 : -1) * steps * confidence * 100) / 100;
  }
  let totalResolved = 0;
  for (const s of signals) {
    if (s.isGateBlocked) continue;
    const res = s.outcomes.resolution;
    if (res === 'TP1_FIRST' || res === 'SL_FIRST') totalResolved++;
  }
  return { baselineWinRatePercent: baseline, totalResolved, perTag, biases };
}

/** Audit entries for every bias value that changed between two learning runs. */
export function diffLessons(
  oldBiases: Record<string, number>,
  newBiases: Record<string, number>,
  perTag: TagLearningStat[],
  baselineWinRatePercent: number,
  nowMs: number,
): LearningLesson[] {
  const statsByTag = new Map(perTag.map((t) => [t.tag, t]));
  const lessons: LearningLesson[] = [];
  for (const tag of Object.keys(newBiases)) {
    const from = oldBiases[tag] ?? 0;
    const to = newBiases[tag];
    if (from === to) continue;
    const st = statsByTag.get(tag);
    lessons.push({
      at: nowMs,
      tag,
      from,
      to,
      samples: st ? st.samples : 0,
      tagWinRatePercent: st ? st.winRatePercent : 0,
      baselineWinRatePercent,
    });
  }
  return lessons;
}

/** Total applied bias for a candidate signal's reason tags, clamped to [-5, +5]. */
export function biasForReasons(reasonTags: string[], biases: Record<string, number>): number {
  const tags = new Set(reasonTags);
  let sum = 0;
  for (const t of tags) sum += biases[t] ?? 0;
  return Math.max(-MAX_APPLIED_BIAS, Math.min(MAX_APPLIED_BIAS, sum));
}