// Child-process entry for heavy backtest jobs, so the main server's event loop stays free.
// Receives one message { kind, asset, candles }, replies with { ok, ... } and exits.
import { runBacktest, runRobustness, runWalkForward, DEFAULT_BACKTEST_OPTIONS } from './backtest';
import type { Candle } from '../shared/types';

type Job = { kind: 'backtest' | 'robustness' | 'walkforward'; asset: any; candles: Candle[] };

process.once('message', (job: Job) => {
  try {
    let out: unknown;
    if (job.kind === 'robustness') {
      const { base, grid } = runRobustness(job.asset, job.candles, DEFAULT_BACKTEST_OPTIONS);
      out = { result: base, robustness: grid };
    } else if (job.kind === 'walkforward') {
      out = { walkforward: runWalkForward(job.asset, job.candles, DEFAULT_BACKTEST_OPTIONS) };
    } else {
      out = { result: runBacktest(job.asset, job.candles, DEFAULT_BACKTEST_OPTIONS) };
    }
    process.send?.({ ok: true, out }, () => process.exit(0));
  } catch (e) {
    process.send?.({ ok: false, error: e instanceof Error ? e.message : String(e) }, () => process.exit(0));
  }
});
