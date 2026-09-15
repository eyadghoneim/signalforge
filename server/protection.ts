// Capital protection layer - pure functions, no I/O, no side effects.
// R unit convention: TP1_FIRST = +1R, SL_FIRST = -1R, EXPIRED = 0R (paper attribution).
// Comments are English-only on purpose (codepage safety when written via shell tooling).

import type { StoredSignal } from '../shared/types';

export interface ProtectionConfig {
  dailyLossLimitR: number; // R lost in the current UTC day before the breaker trips (default 3)
  maxConcurrentSignals: number; // max simultaneously OPEN buy signals (default 2)
  signalExpiryHours: number; // unexecuted OPEN buy signals older than this expire (default 3)
  correlationGuard: boolean; // BTC+ETH longs held together count as +1 exposure (default true)
}

export const DEFAULT_PROTECTION: ProtectionConfig = {
  dailyLossLimitR: 3,
  maxConcurrentSignals: 2,
  signalExpiryHours: 3,
  correlationGuard: true,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampProtection(p: ProtectionConfig): ProtectionConfig {
  return {
    dailyLossLimitR: clampNumber(p.dailyLossLimitR, 0.5, 20, 3),
    maxConcurrentSignals: clampNumber(p.maxConcurrentSignals, 1, 10, 2),
    signalExpiryHours: clampNumber(p.signalExpiryHours, 1, 72, 3),
    correlationGuard: Boolean(p.correlationGuard),
  };
}

export function utcDayStart(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isActionableOpenBuy(s: StoredSignal): boolean {
  return !s.isGateBlocked && s.spotAction === 'SPOT_BUY' && s.outcomes.resolution === 'OPEN';
}

export interface DailyPnLR {
  realizedR: number;
  resolvedToday: number;
  winsToday: number;
  lossesToday: number;
}

/** Realized paper PnL (in R) for the current UTC day, from resolved actionable signals. */
export function dayRealizedR(signals: StoredSignal[], nowMs: number): DailyPnLR {
  const start = utcDayStart(nowMs);
  let realizedR = 0;
  let resolvedToday = 0;
  let winsToday = 0;
  let lossesToday = 0;
  for (const s of signals) {
    if (s.isGateBlocked) continue;
    const res = s.outcomes.resolution;
    if (res !== 'TP1_FIRST' && res !== 'SL_FIRST') continue;
    const at = s.outcomes.resolvedAt ?? 0;
    if (at < start || at > nowMs) continue;
    resolvedToday++;
    if (res === 'TP1_FIRST') {
      realizedR += 1;
      winsToday++;
    } else {
      realizedR -= 1;
      lossesToday++;
    }
  }
  return { realizedR, resolvedToday, winsToday, lossesToday };
}

export interface BreakerState {
  unrealizedR: number;
  tripped: boolean;
  realizedR: number;
  limit: number;
  resolvedToday: number;
  lossesToday: number;
  dayStartMs: number;
}

function unrealizedAdverseR(signals: StoredSignal[]): number {
  // Conservative estimate from the latest 4h attribution window: worst adverse move (MAE)
  // divided by the stop distance. MAE is a worst-case snapshot, so this trips early, not late.
  let r = 0;
  for (const s of signals) {
    if (!isActionableOpenBuy(s)) continue;
    const stopDistPct = ((s.entryPrice - s.stopLoss) / s.entryPrice) * 100;
    if (!(stopDistPct > 0)) continue;
    const mae = s.outcomes.windows.h4.maePercent;
    const adverse = Math.max(0, -mae);
    if (adverse > 0) r += adverse / stopDistPct;
  }
  return r;
}

export function evaluateCircuitBreaker(signals: StoredSignal[], config: ProtectionConfig, nowMs: number): BreakerState {
  const pnl = dayRealizedR(signals, nowMs);
  const unrealizedR = -unrealizedAdverseR(signals);
  const totalR = pnl.realizedR + unrealizedR;
  return {
    tripped: totalR <= -Math.abs(config.dailyLossLimitR),
    realizedR: pnl.realizedR,
    unrealizedR,
    limit: config.dailyLossLimitR,
    resolvedToday: pnl.resolvedToday,
    lossesToday: pnl.lossesToday,
    dayStartMs: utcDayStart(nowMs),
  };
}

export interface ExposureState {
  openCount: number;
  correlatedPairBonus: number;
  effectiveExposure: number;
  hasBtcLong: boolean;
  hasEthLong: boolean;
}

export function currentExposure(signals: StoredSignal[], config: ProtectionConfig): ExposureState {
  let openCount = 0;
  let hasBtcLong = false;
  let hasEthLong = false;
  for (const s of signals) {
    if (!isActionableOpenBuy(s)) continue;
    openCount++;
    if (s.asset === 'BTC') hasBtcLong = true;
    if (s.asset === 'ETH') hasEthLong = true;
  }
  const correlatedPairBonus = config.correlationGuard && hasBtcLong && hasEthLong ? 1 : 0;
  return { openCount, correlatedPairBonus, effectiveExposure: openCount + correlatedPairBonus, hasBtcLong, hasEthLong };
}

/** Exposure after a candidate BUY on the given asset would be opened. */
export function projectedExposure(signals: StoredSignal[], config: ProtectionConfig, candidateAsset: string): number {
  const cur = currentExposure(signals, config);
  const pairBonus =
    config.correlationGuard &&
    ((candidateAsset === 'BTC' && cur.hasEthLong) || (candidateAsset === 'ETH' && cur.hasBtcLong))
      ? 1
      : 0;
  return cur.effectiveExposure + pairBonus + 1;
}

export interface ExpiryCandidate {
  id: string;
  generatedAt: number;
  ageHours: number;
}

/** Unexecuted OPEN buy signals older than the expiry window. */
export function findExpiredSignals(signals: StoredSignal[], config: ProtectionConfig, nowMs: number): ExpiryCandidate[] {
  const cutoffMs = config.signalExpiryHours * 3600_000;
  const out: ExpiryCandidate[] = [];
  for (const s of signals) {
    if (!isActionableOpenBuy(s)) continue;
    const age = nowMs - s.generatedAt;
    if (age > cutoffMs) out.push({ id: s.id, generatedAt: s.generatedAt, ageHours: Math.round((age / 3600_000) * 10) / 10 });
  }
  return out;
}

export type ProtectionBlockReason = 'CIRCUIT_BREAKER' | 'EXPOSURE_CAP';

/** Should a candidate actionable BUY be refused right now? */
export function protectionVerdict(
  signals: StoredSignal[],
  config: ProtectionConfig,
  candidateAsset: string,
  nowMs: number,
): { allow: boolean; reason: ProtectionBlockReason | null; breaker: BreakerState; projected: number } {
  const breaker = evaluateCircuitBreaker(signals, config, nowMs);
  if (breaker.tripped) {
    return { allow: false, reason: 'CIRCUIT_BREAKER', breaker, projected: currentExposure(signals, config).effectiveExposure };
  }
  const projected = projectedExposure(signals, config, candidateAsset);
  if (projected > config.maxConcurrentSignals) {
    return { allow: false, reason: 'EXPOSURE_CAP', breaker, projected };
  }
  return { allow: true, reason: null, breaker, projected };
}