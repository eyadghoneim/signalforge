// Capital protection layer - pure functions, no I/O, no side effects.
// R unit convention: TP1_FIRST = +1R, SL_FIRST = -1R, EXPIRED = 0R (paper attribution).
// Comments are English-only on purpose (codepage safety when written via shell tooling).

import type { PaperTradeOutcome, ProtectionConfig, StoredSignal } from '../shared/types';
import { realizedR } from './learning';


export const DEFAULT_PROTECTION: ProtectionConfig = {
  dailyLossLimitR: 3,
  maxConcurrentSignals: 2,
  signalExpiryHours: 3,
  correlationGuard: true,
  stoplossGuardMax: 3,
  stoplossGuardHours: 6,
  lossCooldownHours: 2,
  choppyLossStreak: 3,
  choppyCooldownHours: 24,
  paperMaxHoldHours: 168,
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
    stoplossGuardMax: clampNumber(p.stoplossGuardMax, 1, 10, 3),
    stoplossGuardHours: clampNumber(p.stoplossGuardHours, 1, 72, 6),
    lossCooldownHours: clampNumber(p.lossCooldownHours, 0, 48, 2),
    choppyLossStreak: clampNumber(p.choppyLossStreak, 2, 10, 3),
    choppyCooldownHours: clampNumber(p.choppyCooldownHours, 1, 168, 24),
    paperMaxHoldHours: clampNumber(p.paperMaxHoldHours, 24, 720, 168),
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
  let totalR = 0;
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
      // True R multiple from the strategy constants (TP1 = ~1.25R), consistent
      // with the learning system - a win is no longer a flat +1.
      totalR += realizedR(s);
      winsToday++;
    } else {
      totalR -= 1;
      lossesToday++;
    }
  }
  return { realizedR: Number(totalR.toFixed(2)), resolvedToday, winsToday, lossesToday };
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
  const openAssets = new Set<string>();
  let hasBtcLong = false;
  let hasEthLong = false;
  for (const s of signals) {
    if (!isActionableOpenBuy(s)) continue;
    // Exposure is a position count, not a signal-history count. Repeated BUY
    // signals for one asset must not freeze every other asset at the cap.
    openAssets.add(s.asset);
    if (s.asset === 'BTC') hasBtcLong = true;
    if (s.asset === 'ETH') hasEthLong = true;
  }
  const openCount = openAssets.size;
  const correlatedPairBonus = config.correlationGuard && hasBtcLong && hasEthLong ? 1 : 0;
  return { openCount, correlatedPairBonus, effectiveExposure: openCount + correlatedPairBonus, hasBtcLong, hasEthLong };
}

/** Exposure after a candidate BUY on the given asset would be opened. */
export function projectedExposure(signals: StoredSignal[], config: ProtectionConfig, candidateAsset: string): number {
  const cur = currentExposure(signals, config);
  const candidateAlreadyOpen = signals.some((s) => isActionableOpenBuy(s) && s.asset === candidateAsset);
  const nextOpenCount = cur.openCount + (candidateAlreadyOpen ? 0 : 1);
  const nextHasBtcLong = cur.hasBtcLong || candidateAsset === 'BTC';
  const nextHasEthLong = cur.hasEthLong || candidateAsset === 'ETH';
  const nextPairBonus = config.correlationGuard && nextHasBtcLong && nextHasEthLong ? 1 : 0;
  return nextOpenCount + nextPairBonus;
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

export type ProtectionBlockReason = 'CIRCUIT_BREAKER' | 'EXPOSURE_CAP' | 'STOPLOSS_GUARD' | 'LOSS_COOLDOWN' | 'CHOPPY_COOLDOWN';

export interface ChoppyCooldownState {
  consecutiveLosses: number;
  lastLossAt: number | null;
  cooldownUntil: number | null;
  active: boolean;
}

export interface PaperClosedTrade {
  closedAt: number;
  outcome?: PaperTradeOutcome;
  /** Legacy Paper JSON may not have outcome; reason is retained for safe inference. */
  reason?: 'TP3' | 'SL' | 'SELL_SIGNAL' | 'TIME';
}

function inferPaperOutcome(trade: PaperClosedTrade): PaperTradeOutcome {
  if (trade.outcome) return trade.outcome;
  if (trade.reason === 'SL') return 'SL_FIRST';
  if (trade.reason === 'TP3') return 'TP1_FIRST';
  if (trade.reason === 'TIME') return 'TIME';
  return 'SELL_SIGNAL';
}

/** Count the newest consecutive SL_FIRST outcomes from actually closed Paper trades. */
export function choppyCooldownState(
  trades: PaperClosedTrade[],
  maxLosses: number,
  cooldownHours: number,
  nowMs: number,
): ChoppyCooldownState {
  const resolved = trades
    .filter((trade) => Number.isFinite(trade.closedAt) && trade.closedAt > 0 && trade.closedAt <= nowMs)
    .sort((a, b) => a.closedAt - b.closedAt);
  let consecutiveLosses = 0;
  let lastLossAt: number | null = null;
  for (let i = resolved.length - 1; i >= 0; i--) {
    if (inferPaperOutcome(resolved[i]) !== 'SL_FIRST') break;
    consecutiveLosses++;
    lastLossAt = resolved[i].closedAt;
  }
  const cooldownUntil = lastLossAt === null ? null : lastLossAt + cooldownHours * 3600_000;
  return {
    consecutiveLosses,
    lastLossAt,
    cooldownUntil,
    active: consecutiveLosses >= maxLosses && cooldownHours > 0 && nowMs < (cooldownUntil ?? 0),
  };
}

/** Should the global paper BUY cooldown be active after a consecutive loss streak? */
export function choppyCooldownActive(
  trades: PaperClosedTrade[],
  maxLosses: number,
  cooldownHours: number,
  nowMs: number,
): boolean {
  return choppyCooldownState(trades, maxLosses, cooldownHours, nowMs).active;
}

/** Should a candidate actionable BUY be refused right now? */
export function protectionVerdict(
  signals: StoredSignal[],
  config: ProtectionConfig,
  candidateAsset: string,
  nowMs: number,
  paperTrades: PaperClosedTrade[] = [],
): { allow: boolean; reason: ProtectionBlockReason | null; breaker: BreakerState; projected: number } {
  const breaker = evaluateCircuitBreaker(signals, config, nowMs);
  if (breaker.tripped) {
    return { allow: false, reason: 'CIRCUIT_BREAKER', breaker, projected: currentExposure(signals, config).effectiveExposure };
  }
  if (choppyCooldownActive(paperTrades, config.choppyLossStreak, config.choppyCooldownHours, nowMs)) {
    return { allow: false, reason: 'CHOPPY_COOLDOWN', breaker, projected: currentExposure(signals, config).effectiveExposure };
  }
  const slCount = stoplossGuardCount(signals, candidateAsset, config.stoplossGuardHours, nowMs);
  if (slCount >= config.stoplossGuardMax) {
    return { allow: false, reason: 'STOPLOSS_GUARD', breaker, projected: currentExposure(signals, config).effectiveExposure };
  }
  if (lossCooldownActive(signals, candidateAsset, config.lossCooldownHours, nowMs)) {
    return { allow: false, reason: 'LOSS_COOLDOWN', breaker, projected: currentExposure(signals, config).effectiveExposure };
  }
  const projected = projectedExposure(signals, config, candidateAsset);
  if (projected > config.maxConcurrentSignals) {
    return { allow: false, reason: 'EXPOSURE_CAP', breaker, projected };
  }
  return { allow: true, reason: null, breaker, projected };
}
/** Number of stop-loss resolutions for the asset inside the StoplossGuard window. */
export function stoplossGuardCount(signals: StoredSignal[], asset: string, windowHours: number, nowMs: number): number {
  const start = nowMs - windowHours * 3600_000;
  let count = 0;
  for (const s of signals) {
    if (s.isGateBlocked || s.asset !== asset) continue;
    if (s.outcomes.resolution !== 'SL_FIRST') continue;
    const at = s.outcomes.resolvedAt ?? 0;
    if (at >= start && at <= nowMs) count++;
  }
  return count;
}

/** True while the asset is still cooling down after its most recent stop-loss. */
export function lossCooldownActive(signals: StoredSignal[], asset: string, cooldownHours: number, nowMs: number): boolean {
  if (cooldownHours <= 0) return false;
  let lastSlAt = 0;
  for (const s of signals) {
    if (s.isGateBlocked || s.asset !== asset) continue;
    if (s.outcomes.resolution !== 'SL_FIRST') continue;
    const at = s.outcomes.resolvedAt ?? 0;
    if (at > lastSlAt) lastSlAt = at;
  }
  return lastSlAt > 0 && nowMs - lastSlAt < cooldownHours * 3600_000;
}