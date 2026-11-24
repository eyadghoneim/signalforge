// Runs a backtest job in a child process (the compute is synchronous and CPU heavy).
import { fork } from 'child_process';
import * as path from 'path';
import type { Candle } from '../shared/types';

export type BacktestJobKind = 'backtest' | 'robustness' | 'walkforward';
const JOB_TIMEOUT_MS = 300_000;

/**
 * Chooses the worker by how THIS process was started, not by what happens to exist on disk:
 * a built server (entry is a .cjs bundle) uses the backtestWorker.cjs next to it, with no tsx;
 * source runs (tsx dev server, tests) always use the .ts source, so a stale dist/ is ignored.
 */
export function resolveBacktestWorker(entry: string, cwd: string): { file: string; execArgv: string[] } {
  if (path.extname(entry) === '.cjs') {
    return { file: path.join(path.dirname(entry), 'backtestWorker.cjs'), execArgv: [] };
  }
  return { file: path.join(cwd, 'server', 'backtestWorker.ts'), execArgv: ['--import', 'tsx'] };
}

export function runBacktestJob(kind: BacktestJobKind, asset: string, candles: Candle[]): Promise<any> {
  const { file, execArgv } = resolveBacktestWorker(process.argv[1] || '', process.cwd());
  return new Promise((resolve, reject) => {
    const child = fork(file, [], { execArgv, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(() => reject(new Error('backtest job timed out')));
    }, JOB_TIMEOUT_MS);
    child.once('message', (m: any) => done(() => (m?.ok ? resolve(m.out) : reject(new Error(m?.error || 'backtest failed')))));
    child.once('error', (e) => done(() => reject(e)));
    child.once('exit', (code) => done(() => reject(new Error(`backtest worker exited (${code})`))));
    child.send({ kind, asset, candles });
  });
}
