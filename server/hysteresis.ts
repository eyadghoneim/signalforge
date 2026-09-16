// Label hysteresis - pure state machine (no I/O, no engine changes).
// Backlog item 1 (external review): a NEW actionable BUY label must hold its
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
