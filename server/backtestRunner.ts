// Runs a backtest job in a child process (the compute is synchronous and CPU heavy).
import { fork } from 'child_process';
import * as path from 'path';
import type { Candle } from '../shared/types';

export type BacktestJobKind = 'backtest' | 'robustness' | 'walkforward';
const JOB_TIMEOUT_MS = 120_000;

export function runBacktestJob(kind: BacktestJobKind, asset: string, candles: Candle[]): Promise<any> {
  const isProd = process.env.NODE_ENV === 'production';
  // Production: bundled by `npm run build` next to server.cjs. Development: run the .ts via tsx.
  const file = isProd ? path.join(process.cwd(), 'dist', 'backtestWorker.cjs') : path.join(process.cwd(), 'server', 'backtestWorker.ts');
  const execArgv = isProd ? [] : ['--import', 'tsx'];
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
