// Performance analytics layer - pure functions, no I/O, no side effects.
// Comments are intentionally English-only: keeps the file byte-safe under any
// console codepage when written/read through shell tooling.

import type { BacktestTrade, PerformanceStats, ScoreBucketStat, ExitReasonStat } from '../shared/types';

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
    maxDrawdownPercent: round(maxDD, 1),
    maxDrawdownDurationHours,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    timeInMarketPercent,
    scoreBuckets,
    exitBreakdown,
  };
}