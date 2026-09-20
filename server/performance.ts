// Performance analytics layer - pure functions, no I/O, no side effects.
// Comments are intentionally English-only: keeps the file byte-safe under any
// console codepage when written/read through shell tooling.

import type { BacktestTrade, PerformanceStats, ScoreBucketStat, ExitReasonStat, MonteCarloResult } from '../shared/types';

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function scoreBucket(score: number): string {
  if (score >= 85) return '85+';
  if (score >= 80) return '80-84';
  if (score >= 75) return '75-79';
  if (score >= 70) return '70-74';
  return '<70';
}

function seededRng(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Deterministic seeded Monte Carlo permutation test (1,000 iterations).
 * Re-orders trade PnL sequence to test whether backtest results depend on a lucky sequence.
 */
export function computeMonteCarloSimulation(
  trades: BacktestTrade[],
  initialEquity: number,
  iterations = 1000,
  seed = 4242,
): MonteCarloResult | undefined {
  if (trades.length < 5 || initialEquity <= 0) return undefined;

  const rand = seededRng(seed);
  const pnlList = trades.map((t) => t.pnlUsd);
  const simDrawdowns: number[] = [];
  const simFinalEquities: number[] = [];
  let ruinHits = 0;
  const ruinThreshold = initialEquity * 0.5; // Capital drop >= 50%

  for (let iter = 0; iter < iterations; iter++) {
    const shuffled = [...pnlList];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const temp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }

    let eq = initialEquity;
    let peak = initialEquity;
    let iterMaxDD = 0;
    let touchedRuin = false;

    for (let i = 0; i < shuffled.length; i++) {
      eq += shuffled[i];
      if (eq > peak) {
        peak = eq;
      }
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (dd > iterMaxDD) {
        iterMaxDD = dd;
      }
      if (eq <= ruinThreshold) {
        touchedRuin = true;
      }
    }

    if (touchedRuin) ruinHits++;
    simDrawdowns.push(iterMaxDD);
    simFinalEquities.push(eq);
  }

  simDrawdowns.sort((a, b) => a - b);
  simFinalEquities.sort((a, b) => a - b);

  const idx5 = Math.floor(iterations * 0.05);
  const idx50 = Math.floor(iterations * 0.50);
  const idx95 = Math.min(iterations - 1, Math.floor(iterations * 0.95));

  const lossCount = simFinalEquities.filter((e) => e < initialEquity).length;

  return {
    iterations,
    maxDrawdown: {
      p5: round(simDrawdowns[idx5], 1),
      p50: round(simDrawdowns[idx50], 1),
      p95: round(simDrawdowns[idx95], 1),
      worst: round(simDrawdowns[simDrawdowns.length - 1], 1),
      best: round(simDrawdowns[0], 1),
    },
    finalEquity: {
      p5: round(simFinalEquities[idx5], 2),
      p50: round(simFinalEquities[idx50], 2),
      p95: round(simFinalEquities[idx95], 2),
      worst: round(simFinalEquities[0], 2),
      best: round(simFinalEquities[simFinalEquities.length - 1], 2),
    },
    riskOfRuinPercent: round((ruinHits / iterations) * 100, 1),
    lossProbabilityPercent: round((lossCount / iterations) * 100, 1),
    confidenceInterval95: {
      minEquity: round(simFinalEquities[idx5], 2),
      maxEquity: round(simFinalEquities[idx95], 2),
      minDrawdown: round(simDrawdowns[idx5], 1),
      maxDrawdown: round(simDrawdowns[idx95], 1),
    },
  };
}

/**
 * Compute advanced performance statistics from backtest output.
 * @param trades chronological trade list (entry order, NOT the reversed display slice)
 * @param equityCurve chronological equity points (time in epoch seconds)
 * @param initialEquity starting equity used to normalize R multiples
 * @param riskPercent risk per trade, percent of initial equity (defines the R unit)
 */
export function computePerformanceStats(
  trades: BacktestTrade[],
  equityCurve: { time: number; equity: number; buyHold: number }[],
  initialEquity: number,
  riskPercent = 1,
): PerformanceStats {
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlUsd, 0));
  const profitFactor = grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? null : 0;

  const riskUnit = initialEquity * (riskPercent / 100);
  const expectancyR =
    trades.length > 0 && riskUnit > 0
      ? round(trades.reduce((a, t) => a + t.pnlUsd / riskUnit, 0) / trades.length, 3)
      : null;

  const avgWinUsd = wins.length > 0 ? round(grossWin / wins.length, 2) : null;
  const avgLossUsd = losses.length > 0 ? round(grossLoss / losses.length, 2) : null;
  const payoffRatio =
    avgWinUsd !== null && avgLossUsd !== null && avgLossUsd > 0 ? round(avgWinUsd / avgLossUsd, 2) : null;

  // Per-trade return on notional (entry * qty) - well defined from trade data alone.
  const returnPcts = trades
    .filter((t) => t.entry > 0 && t.qty > 0)
    .map((t) => (t.pnlUsd / (t.entry * t.qty)) * 100);
  const sd = stdev(returnPcts);
  const sharpePerTrade =
    returnPcts.length >= 2 && sd > 0
      ? round(returnPcts.reduce((a, v) => a + v, 0) / returnPcts.length / sd, 3)
      : null;

  // Sortino ratio: downside deviation penalizes negative returns only
  const meanReturnPct = returnPcts.length > 0 ? returnPcts.reduce((a, v) => a + v, 0) / returnPcts.length : 0;
  const downsideReturns = returnPcts.filter((r) => r < 0);
  const downsideDeviation =
    downsideReturns.length > 0
      ? Math.sqrt(downsideReturns.reduce((a, r) => a + r ** 2, 0) / returnPcts.length)
      : 0;
  const sortinoRatio =
    returnPcts.length >= 2 && downsideDeviation > 0
      ? round(meanReturnPct / downsideDeviation, 3)
      : null;

  // Max drawdown + peak-to-trough duration from the equity curve.
  let peak = initialEquity;
  let peakTime = equityCurve.length > 0 ? equityCurve[0].time : 0;
  let maxDD = 0;
  let maxDrawdownDurationHours: number | null = null;
  for (const p of equityCurve) {
    if (p.equity > peak) {
      peak = p.equity;
      peakTime = p.time;
    }
    const dd = peak > 0 ? ((peak - p.equity) / peak) * 100 : 0;
    if (dd > maxDD) {
      maxDD = dd;
      maxDrawdownDurationHours = round((p.time - peakTime) / 3600, 1);
    }
  }

  // Calmar ratio: Total Return % / Max Drawdown %
  const finalEq = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialEquity;
  const totalReturnPercent = initialEquity > 0 ? ((finalEq - initialEquity) / initialEquity) * 100 : 0;
  const calmarRatio = maxDD > 0 ? round(totalReturnPercent / maxDD, 2) : null;

  // Monte Carlo permutation simulation
  const monteCarlo = computeMonteCarloSimulation(trades, initialEquity);

  // Win/loss streaks over chronological order.
  let curWin = 0;
  let curLoss = 0;
  let longestWin = 0;
  let longestLoss = 0;
  for (const t of trades) {
    if (t.pnlUsd > 0) {
      curWin++;
      curLoss = 0;
    } else {
      curLoss++;
      curWin = 0;
    }
    longestWin = Math.max(longestWin, curWin);
    longestLoss = Math.max(longestLoss, curLoss);
  }

  // Time in market: total trade duration vs observed period span.
  let timeInMarketPercent: number | null = null;
  if (trades.length > 0 && equityCurve.length > 0) {
    const firstTime = Math.min(...trades.map((t) => t.entryTime));
    const lastTime = Math.max(...trades.map((t) => t.exitTime), equityCurve[equityCurve.length - 1].time);
    const span = lastTime - firstTime;
    if (span > 0) {
      const inMarket = trades.reduce((a, t) => a + (t.exitTime - t.entryTime), 0);
      timeInMarketPercent = round(Math.min(100, (inMarket / span) * 100), 1);
    }
  }

  // Score buckets: which conviction tier actually makes money.
  const bucketOrder = ['<70', '70-74', '75-79', '80-84', '85+'];
  const bucketMap = new Map<string, ScoreBucketStat>();
  for (const t of trades) {
    const key = scoreBucket(t.signalScore);
    const cur = bucketMap.get(key) ?? { bucket: key, trades: 0, wins: 0, winRatePercent: 0, totalPnlUsd: 0 };
    cur.trades++;
    if (t.pnlUsd > 0) cur.wins++;
    cur.totalPnlUsd = round(cur.totalPnlUsd + t.pnlUsd, 2);
    bucketMap.set(key, cur);
  }
  const scoreBuckets = bucketOrder
    .filter((k) => bucketMap.has(k))
    .map((k) => {
      const b = bucketMap.get(k);
      if (!b) throw new Error('missing bucket');
      return { ...b, winRatePercent: b.trades > 0 ? round((b.wins / b.trades) * 100, 1) : 0 };
    });

  // Exit reasons: shows whether stop-loss exits dominate (a quality red flag).
  const exitMap = new Map<string, ExitReasonStat>();
  for (const t of trades) {
    const cur = exitMap.get(t.exitReason) ?? { reason: t.exitReason, count: 0, totalPnlUsd: 0 };
    cur.count++;
    cur.totalPnlUsd = round(cur.totalPnlUsd + t.pnlUsd, 2);
    exitMap.set(t.exitReason, cur);
  }
  const exitBreakdown = [...exitMap.values()].sort((a, b) => b.count - a.count);

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePercent: trades.length > 0 ? round((wins.length / trades.length) * 100, 1) : 0,
    profitFactor,
    expectancyR,
    avgWinUsd,
    avgLossUsd,
    payoffRatio,
    sharpePerTrade,
    sortinoRatio,
    calmarRatio,
    maxDrawdownPercent: round(maxDD, 1),
    maxDrawdownDurationHours,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    timeInMarketPercent,
    scoreBuckets,
    exitBreakdown,
    monteCarlo,
  };
}