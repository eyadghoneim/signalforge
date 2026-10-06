// Label hysteresis - pure state machine (no I/O, no engine changes).
// Backlog item 1: a NEW actionable BUY label must hold its
// score above the BUY threshold on LABEL_HYSTERESIS_SCANS consecutive scan
// cycles before it is promoted (stored + Telegram). One-scan score spikes no
// longer create signals or alerts.
// Design constraints honored:
// - Engine (buildSignal) is untouched -> backtests stay deterministic.
// - Gate-blocked BUY cycles still count as "score held" (the label is
//   score-based; the regime gate is a separate filter) and remain stored for
//   transparency without needing confirmation.
// - SELL / exit labels are never delayed (risk-first).
// - State resets on process restart: the first candidate after a restart
//   always waits one full cycle (safe default).

import { STRATEGY_THRESHOLDS } from '../shared/strategyConstants';

export const LABEL_HYSTERESIS_SCANS = 2;

export interface HysteresisState {
  /** Scan cycle of the last BUY-label observation, or null. */
  lastBuyCycle: number | null;
}

export interface HysteresisDecision {
  /** True when the BUY label may be promoted (stored/alerted) this cycle. */
  promote: boolean;
  /** True when this cycle observed a BUY label (streak continues). */
  countsAsHold: boolean;
  nextState: HysteresisState;
}

export function evaluateLabelHysteresis(
  state: HysteresisState,
  isBuyLabel: boolean,
  cycle: number,
  requiredConsecutive: number = LABEL_HYSTERESIS_SCANS,
): HysteresisDecision {
  if (!isBuyLabel) {
    return { promote: false, countsAsHold: false, nextState: { lastBuyCycle: null } };
  }
  const heldLastCycle = state.lastBuyCycle !== null && state.lastBuyCycle === cycle - 1;
  const promote = requiredConsecutive <= 1 || heldLastCycle;
  return { promote, countsAsHold: true, nextState: { lastBuyCycle: cycle } };
}

/**
 * Determine if a generated signal represents a BUY score streak for hysteresis.
 * Gate-blocked BUY cycles (NO_TRADE with high score) still count as "score held".
 */
export function isBuyLabelSignal(signal: {
  spotAction: string;
  signalType?: string;
  convictionScore?: number;
  regimeGateStatus?: string;
}): boolean {
  if (signal.spotAction === 'SPOT_BUY') return true;
  if (
    signal.signalType === 'NO_TRADE' &&
    signal.regimeGateStatus &&
    signal.regimeGateStatus !== 'CLEAR' &&
    (signal.convictionScore ?? 0) >= STRATEGY_THRESHOLDS.BUY_MIN_SCORE
  ) {
    return true;
  }
  return false;
}
