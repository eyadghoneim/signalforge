import type { BacktestTrade, MonteCarloStats, MonteCarloPercentiles } from '../shared/types';

export const MONTE_CARLO_SIMULATIONS = 1000;
export const MONTE_CARLO_SEED = 0x51a1f0;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
}

function percentiles(values: number[], digits: number): MonteCarloPercentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p5: round(percentile(sorted, 0.05), digits),
    p50: round(percentile(sorted, 0.5), digits),
    p95: round(percentile(sorted, 0.95), digits),
  };
}

/** Small deterministic PRNG; Monte Carlo output must be reproducible for audit. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reorders completed trade P&Ls without changing the strategy or its trade set.
 * This is a research-only stress test: it measures path dependency, not a new
 * forecast and never feeds signal scoring or Paper Trading.
 */
export function runMonteCarlo(
  trades: BacktestTrade[],
  initialEquity: number,
  simulations = MONTE_CARLO_SIMULATIONS,
  seed = MONTE_CARLO_SEED,
): MonteCarloStats | null {
  const pnls = trades.map((trade) => Number(trade.pnlUsd)).filter((pnl) => Number.isFinite(pnl));
  const count = Math.max(1, Math.floor(Number(simulations) || MONTE_CARLO_SIMULATIONS));
  if (pnls.length === 0 || !(initialEquity > 0)) return null;

  const random = mulberry32(seed);
  const drawdowns: number[] = [];
  const minimumEquities: number[] = [];
  let capitalDipCount = 0;

  for (let simulation = 0; simulation < count; simulation++) {
    const shuffled = [...pnls];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let equity = initialEquity;
    let minimumEquity = initialEquity;
    let peak = initialEquity;
    let maxDrawdown = 0;
    let dippedBelowStart = false;
    for (const pnl of shuffled) {
      equity += pnl;
      minimumEquity = Math.min(minimumEquity, equity);
      if (equity < initialEquity) dippedBelowStart = true;
      peak = Math.max(peak, equity);
      const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    minimumEquities.push(Math.max(0, minimumEquity));
    drawdowns.push(maxDrawdown);
    if (dippedBelowStart) capitalDipCount++;
  }

  return {
    simulations: count,
    seed: seed >>> 0,
    bestMaxDrawdownPercent: round(Math.min(...drawdowns), 1),
    worstMaxDrawdownPercent: round(Math.max(...drawdowns), 1),
    maxDrawdownPercentiles: percentiles(drawdowns, 1),
    minimumEquityPercentiles: percentiles(minimumEquities, 2),
    capitalDipProbabilityPercent: round((capitalDipCount / count) * 100, 1),
  };
}
