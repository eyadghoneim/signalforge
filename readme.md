# SignalForge

**A self-learning crypto signal terminal - measure, protect, adapt.**

SignalForge is a local-first trading signal workstation for BTC, ETH and PAXG. It watches
multi-timeframe market structure, scores conviction through a gated deterministic engine, tracks
the outcome of every signal it publishes, and continuously adjusts its own factor weights from
measured results - with a full audit trail.

> **Honest by design:** SignalForge is an educational paper-trading research tool. It does not
> place real orders, and it does not promise profits. Its own walk-forward analysis is published
> in the repository because measured truth beats marketing.

---

## Features

| | |
|---|---|
| **Deterministic signal engine** | Multi-timeframe scoring (1h/4h/daily) with regime gates: HTF trend, chop (ADX), volume (RVOL) and funding squeeze - signals are reproducible, not hand-waved |
| **Advanced measurement** | Win rate, profit factor, expectancy (R), payoff, per-trade Sharpe, max drawdown + duration, streaks, time-in-market, score-bucket and exit-reason diagnostics, equity curve with buy & hold benchmark, CSV export |
| **Honest walk-forward optimizer** | Grid-search on the first half of the data, verdict on the unseen second half - ranking uses in-sample performance only, so the validation result cannot flatter itself |
| **Capital protection** | Daily loss circuit breaker (R-based), max concurrent exposure with a BTC/ETH correlation guard, automatic expiry of stale unexecuted signals |
| **Self-learning** | Every resolved signal feeds a bounded per-factor bias (clamped, evidence-gated at 10+ samples, >= 8pt deviation from baseline). Every bias change is logged with its evidence in a lessons ledger |
| **Open interest factor** | 24h open-interest change from Binance futures confirms or warns on the prevailing move (graceful degradation when unavailable) |
| **Multi-source market data** | Binance, Coinbase and CoinGecko with automatic failover and per-provider health tracking |
| **Telegram alerts** | Signal pushes, daily digest heartbeat, circuit-breaker and scan-failure alerts |
| **Web dashboard** | React + Tailwind terminal: live chart, signal card, history, backtest lab, learning panel, settings |

## Quick start

```bash
npm install
npm run dev        # dashboard on http://localhost:3000
```

| Script | Purpose |
|---|---|
| `npm run dev` | Run the server + serve the dashboard |
| `npm run lint` | TypeScript check (strict) |
| `npm test` | 137 deterministic tests |
| `npm run build` | Production build (vite + esbuild server bundle) |
| `npm start` | Run the built server |

Telegram notifications are optional - configure a bot token and chat id in the dashboard settings
(step-by-step guide included in the UI).

## How the learning works

1. Every actionable signal stores the factor tags that produced it.
2. When a signal resolves (TP1 first / stop first), the outcome feeds a per-tag ledger.
3. A tag with 10+ resolved samples whose win rate deviates 8+ points from the baseline earns a
   bounded bias (+/-1..3) that nudges future scores.
4. Every bias change is written to an audited lessons log - what changed, why, and on what evidence.

No evidence, no bias. The system refuses to learn from thin data.

## Project structure

```
server/    Express API, scan loop, signal engine, backtest, protection, learning
shared/    Types, indicators, strategy constants (used by both server and UI)
src/       React dashboard (Vite + Tailwind)
test/      Deterministic test suite (npm test)
data/      Runtime state (gitignored - contains private config)
```

## Disclaimer

This project is for educational and research purposes only. Nothing in this repository is financial
advice. Crypto markets are risky; backtested and paper-traded performance is not indicative of
future results. Always verify anything you read - including this repository.