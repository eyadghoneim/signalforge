// Runs a backtest job in a child process (the compute is synchronous and CPU heavy).
import { fork } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '../shared/types';

export type BacktestJobKind = 'backtest' | 'robustness' | 'walkforward';
const JOB_TIMEOUT_MS = 300_000;

export function runBacktestJob(kind: BacktestJobKind, asset: string, candles: Candle[]): Promise<any> {
  // Worker location does not depend on NODE_ENV: use the bundled worker next to the server bundle
  // when it exists (production, no tsx needed), otherwise run the .ts source through tsx (dev/tests).
  const bundled = [
    path.join(path.dirname(process.argv[1] || ''), 'backtestWorker.cjs'),
    path.join(process.cwd(), 'dist', 'backtestWorker.cjs'),
  ].find((f) => fs.existsSync(f));
  const file = bundled || path.join(process.cwd(), 'server', 'backtestWorker.ts');
  const execArgv = bundled ? [] : ['--import', 'tsx'];
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
