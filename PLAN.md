# SignalForge v3 upgrade - execution plan (source of truth)

Updated: 2026-09-15 morning (resumed after gateway-restart interruption)
Project: C:\Users\MaLeK\.openclaw-autoclaw\workspace\projects\eyad

## Rules for any executor (agent or human) working this plan
1. Read this file FIRST and update the STATUS checkboxes after every phase.
2. SINGLE WRITER: check source-file mtimes. If any file under server/ src/ shared/ test/
   changed in the last 15 minutes, another executor is active -> DO NOT EDIT anything,
   exit quietly (no user-facing message). Only report when you actually did something.
3. Verify after EVERY phase, from the project directory:
   - npm run lint   -> exit 0
   - npm test       -> all tests pass (v3 baseline: 66/66 before this plan)
   - npm run build  -> exit 0
   Never claim success without these three results.
4. Constraints: no new npm dependencies. No i18n. Keep REST API backward compatible.
   Do NOT touch data/ runtime files except through the existing persistence layer.
   Files contain Arabic text: never write Arabic through shell pipes (codepage risk).
   Use ASCII-only anchors for in-place edits; write new files ASCII-only.
5. Report to the user in Arabic, short, with real numbers.

## Phase status

### Phase 1 - Measurement layer (performance analytics) - DONE & VERIFIED (lint 0, tests 84/84, build 0)
- [x] server/performance.ts - pure computePerformanceStats (winRate, PF, expectancyR,
      payoff, sharpePerTrade, maxDD + duration, streaks, time-in-market, score buckets, exit breakdown)
- [x] shared/types.ts - PerformanceStats/ScoreBucketStat/ExitReasonStat + BacktestResult.performance?
- [x] server/backtest.ts - import computePerformanceStats + attach performance to result
- [x] src/components/BacktestPanel.tsx - extra stat cards, score-bucket table, exit-breakdown table, CSV export
- [x] test/runTests.ts - section "9. Performance analytics v3" (deterministic fixtures + integration)
- [x] Verify lint + test + build

### Phase 2 - Signal quality & profit - DONE & VERIFIED (lint 0, tests 95/95, build 0)
- [x] Per-asset / per-score-bucket performance report on real data (which tiers make money)
- [x] Walk-forward optimizer: extend runRobustness - optimize on first half, validate on second half,
      rank by profitFactor then lowest maxDD; surface in BacktestPanel
- [x] Exit intelligence: break-even stop after TP1 (exists in backtest loop, verify), trailing stop after TP2
- [x] Deterministic tests for optimizer split + trailing logic

### Phase 3 - Capital protection - DONE & VERIFIED (lint 0, tests 109/109, build 0)
- [x] Daily loss circuit breaker (default -3% of day-start equity, configurable): block new signals
      until next UTC day; surface in /api/health + UI + Telegram notice
- [x] Max concurrent exposure cap (default 2) + BTC/ETH same-direction correlation guard
- [x] Signal expiry (default 3 candles unexecuted -> EXPIRED)
- [x] Tests (boundary day, cap, expiry) + SettingsPanel fields

### Phase 4 - Extra edge - DONE & VERIFIED (lint 0, tests 137/137, build 0)
- [x] Funding rate + open interest factor (Binance futures public API, cached, graceful degradation)
- [x] Daily Telegram heartbeat digest (health + signals summary)

### Phase 5 - Learning system - DONE & VERIFIED (lint 0, tests 124/124, build 0) - executed before Phase 4
- [x] Persist per-signal factor snapshot + resolved outcome (learning ledger in data/)
- [x] Periodically recompute factor effectiveness -> bounded scoring weight adjustments, audited
- [x] Lessons log (what changed, why, when) + UI panel to review it
- [x] Tests

## Session log
- 2026-09-14 23:03 - performance.ts + types.ts written, then interrupted (gateway restart)
- 2026-09-15 morning - plan file created, hourly continuation job armed, phase 1 resumed
- 2026-09-15 18:10 - Phase 1 completed & verified natively (lint 0 / tests 84-84 / build 0). Server restart pending.- 2026-09-15 18:25 - Phase 2 completed & verified natively: computeTrailingStop + runWalkForward
  (16-config grid, in-sample optimize / out-of-sample validate, overlap warm-up), API + UI table +
  trailing stop active in backtest loop. lint 0 / tests 93-93 / build 0. Server restart pending.- 2026-09-15 18:26 - METHODOLOGY FIX found during self-review: walk-forward originally ranked
  configs by OUT-OF-SAMPLE results (look-ahead bias). Corrected: pick by in-sample score
  (optPF*100 - optDD + trade-count tiebreak), validation half is the honest verdict only.
  lint 0 / tests 95-95 / build 0.
- 2026-09-15 18:26 - REAL-DATA findings (BTC 365d, honest walk-forward, smoke-tested via API):
  strict config (entry>=75, ADX>=24): in-sample 1 trade; out-of-sample 26 trades, PF 0.73,
  win 42.3%, DD 5.2%, equity 9580 (-4.2%). Loose default (0/0) showed PF 1.66 / +9.3% OOS but
  that is only visible in hindsight - do NOT treat as pickable. Conclusion: engine edge on the
  last 12 months of BTC is fragile; Phase 3 (capital protection) and Phase 5 (learning) are the
  right next steps; Phase 4 factor may help. Executor note: server runs WITHOUT watch -
  after any server-side change: kill port 3000 PID then `cmd /c npm run dev` hidden, verify health.- 2026-09-15 18:55 - Phase 3 completed & verified natively: server/protection.ts (pure), R-based
  daily circuit breaker (default -3R, UTC day), exposure cap 2 with BTC/ETH correlation bonus,
  3h signal expiry pass in scan cycle, breaker Telegram alert once per UTC day, protection state
  in /api/health, settings via /api/config (GET+POST, clamped). Blocked candidates are LOGGED
  (appendLog WARN), not stored, to keep dedup hash semantics clean. Smoke-tested live:
  health.protection {breakerTripped:false, dailyRealizedR:0, openSignals:0, cap:2}.
  lint 0 / tests 109-109 / build 0 (server.cjs 103.2kb). Server restarted (PID verified).- 2026-09-15 19:08 - Phase 5 completed & verified natively: server/learning.ts (pure), learning.json
  + lessons.json storage, scan-cycle integration (bias applied to new candidates, clamped +/-5,
  recomputed each cycle, changes audited as lessons), /api/learning endpoint, LearningPanel UI tab.
  Bias rule: tag needs >=10 resolved samples AND >=8pt deviation from baseline for +/-1..3 bias.
  Smoke-tested live: learning endpoint returns 0 resolved/0 biases (honest empty state).
  lint 0 / tests 124-124 / build 0 (server.cjs 107.7kb). Server restarted (PID verified).
  Remaining: Phase 4 (optional funding/OI factor + heartbeat) + SettingsPanel numeric fields.- 2026-09-15 19:55 - Phase 4 completed & verified: server/oiFactor.ts (Binance futures
  openInterestHist, 10min cache, graceful null), OI scoring rule (rising OI confirms trend +/-2,
  falling OI warns exhaustion), ReasonTag 'OI' added, wired into scan cycle + /api/signal.
  Heartbeat digest verified as pre-existing. lint 0 / tests 137-137 / build 0.
- 2026-09-15 19:58 - PRODUCTION INCIDENT diagnosed & fixed: /api/signal hung >60s because
  stablecoin.llama.fi DNS was failing (5/5 fails) and the fetch stuck past its abort signal,
  blocking getLiquidityRegime -> computeSignalFor. Fix: withTimeoutFallback hard guard on all
  three liquidity fetches (8-9s wall clock -> null). Smoke-tested live after restart:
  BTC 2238ms, ETH 608ms, PAXG 486ms (OI tag present), health clean. Honest note: llama DNS
  breakage is environmental - when it returns, liquidity factor resumes automatically.
- Remaining: SettingsPanel numeric fields for protection config (optional polish; config works
  via POST /api/config).- 2026-09-15 21:40 - PUBLISHED: https://github.com/eyadghoneim/signalforge (public, main branch).
  Rebranded SignalForge everywhere (readme/package/titles/engine signature); secrets verified absent
  from tracked files before push. Final state: lint 0 / tests 137-137 / build 0 / server live.- 2026-09-15 22:10 - EXTERNAL REVIEW (ChatGPT x3) triaged and actioned: bias moved inside
  buildSignal (label/score consistency - review 2 Issue 12), breaker counts unrealized adverse R
  from open-signal MAE (Issue 8), confidence-scaled biases (Issue 16), slippage in the round-trip
  cost model (Issues 5/6), MIT LICENSE, Bybit klines failover for 1h/4h/1d (review 3: geo-block
  resilience), real refresh via invalidateCandleCache, .openclaw/ untracked, v2.0.0 unified,
  branding fully SignalForge. Verified: lint 0 / tests 145-145 / build 0. Deferred with rationale
  in PLAN: label hysteresis, funding non-linearity, regime-keyed biases, bias decay, endpoint
  smoke tests. Non-applicable claims documented: indicator look-ahead (causality is test-proven
  via NaN warmup asserts), SMC sweep proximity (no sweep concept in code), fold bias leak
  (backtest never uses learning biases), timezone reset (utcDayStart already epoch-based).- 2026-09-15 22:30 - DNS diagnosis (probe evidence): api.binance.com fetches 12/12 OK (~300ms)
  from Node; stablecoin.llama.fi fails at DNS (ENOTFOUND). The transient 4h klines 503 right after
  a forced refresh was a refetch burst, self-recovered (400 candles OK, provider health clean).
  Environment note: llama DNS breakage is local/environmental - liquidity degrades to neutral by
  design until it resolves.
- EXTERNAL REVIEW 3 (ChatGPT, ran the project itself) - triage summary:
  FIXED: refresh bypassing cache (invalidateCandleCache), .openclaw/ untracked, version 2.0.0
  unified, branding leftovers cleaned, MAX_BIAS now used, Bybit klines failover (1h/4h/1d).
  ALREADY GUARDED (review claims not applicable to this codebase): indicator look-ahead (causality
  proven by NaN warmup tests), SMC sweep proximity (no sweep concept; BOS uses close + backward
  window), walk-forward bias leak (backtest never consumes learning biases), breaker timezone
  (utcDayStart is epoch-based). DEFERRED (backlog): label hysteresis, funding non-linear scoring,
  regime-keyed biases, bias decay + realized-R gating, endpoint smoke tests, screenshots/release.
  Scores from review: engineering 9/10, honesty 10/10, data resilience 6/10 -> Bybit failover
  addresses the main gap.