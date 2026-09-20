// Dune Analytics Plus On-Chain Integration Service
// Provides live on-chain whale flow, large DEX trades (> $100k), and fast SQL execution.
// Designed with resilient caching, rate-limit protection, and safe fallback.

import { loadConfig } from './persistence';

export interface DuneWhaleTrade {
  block_time: string;
  project: string;
  token_bought_symbol: string;
  token_sold_symbol: string;
  amount_usd: number;
}

export interface DuneTopToken {
  token_bought_symbol: string;
  trades: number;
  total_usd: number;
}

export function getDuneApiKey(): string {
  if (process.env.DUNE_API_KEY && process.env.DUNE_API_KEY.trim()) {
    return process.env.DUNE_API_KEY.trim();
  }
  try {
    const cfg = loadConfig() as unknown as { duneApiKey?: string };
    if (cfg.duneApiKey && cfg.duneApiKey.trim()) {
      return cfg.duneApiKey.trim();
    }
  } catch {
    // fallback
  }
  return '';
}

// In-memory cache to preserve user query credits and provide sub-second responses
const queryCache = new Map<string, { data: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    queryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  queryCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function isDuneAvailable(): boolean {
  const key = getDuneApiKey();
  return Boolean(key && key.trim().length > 0);
}

/**
 * Execute raw SQL query on Dune Analytics using Trino SQL engine.
 * Automatically polls for completion and returns typed rows.
 */
export async function executeDuneSql<T = Record<string, unknown>>(
  sql: string,
  ttlMs = 120_000,
  maxWaitMs = 12_000,
): Promise<{ ok: boolean; rows: T[]; executionTimeMs: number; error?: string }> {
  if (!isDuneAvailable()) {
    return { ok: false, rows: [], executionTimeMs: 0, error: 'Dune API key not configured' };
  }

  const cacheKey = `dune:sql:${sql.trim()}`;
  const cached = getCached<{ rows: T[]; executionTimeMs: number }>(cacheKey);
  if (cached) {
    return { ok: true, rows: cached.rows, executionTimeMs: cached.executionTimeMs };
  }

  const startTime = Date.now();
  const apiKey = getDuneApiKey();

  try {
    // 1. Submit query
    const submitRes = await fetch('https://api.dune.com/api/v1/sql/execute', {
      method: 'POST',
      headers: {
        'X-DUNE-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(6000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => '');
      return { ok: false, rows: [], executionTimeMs: Date.now() - startTime, error: `Dune submit failed (${submitRes.status}): ${errText}` };
    }

    const submitJson = (await submitRes.json()) as { execution_id?: string; state?: string; error?: string };
    const executionId = submitJson.execution_id;
    if (!executionId) {
      return { ok: false, rows: [], executionTimeMs: Date.now() - startTime, error: submitJson.error || 'No execution_id returned' };
    }

    // 2. Poll for results
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1200));

      const pollRes = await fetch(`https://api.dune.com/api/v1/execution/${executionId}/results`, {
        headers: {
          'X-DUNE-API-KEY': apiKey,
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!pollRes.ok) continue;

      const pollJson = (await pollRes.json()) as {
        is_execution_finished?: boolean;
        state?: string;
        result?: { rows?: T[]; metadata?: { execution_time_millis?: number } };
        error?: string;
      };

      if (pollJson.is_execution_finished) {
        if (pollJson.state === 'QUERY_STATE_COMPLETED') {
          const rows = pollJson.result?.rows || [];
          const executionTimeMs = pollJson.result?.metadata?.execution_time_millis || (Date.now() - startTime);
          setCached(cacheKey, { rows, executionTimeMs }, ttlMs);
          return { ok: true, rows, executionTimeMs };
        } else {
          return { ok: false, rows: [], executionTimeMs: Date.now() - startTime, error: pollJson.error || `Execution state: ${pollJson.state}` };
        }
      }
    }

    return { ok: false, rows: [], executionTimeMs: Date.now() - startTime, error: 'Execution timeout exceeded' };
  } catch (e) {
    return { ok: false, rows: [], executionTimeMs: Date.now() - startTime, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Get real on-chain whale DEX netflow for an asset over the last 1-2 hours.
 * Inflow = selling crypto into stables (sell pressure).
 * Outflow = buying crypto with stables (accumulation).
 */
export async function getDuneWhaleNetflow(asset: string): Promise<{ netInflowUsd: number; txCount: number } | null> {
  const symMap: Record<string, string[]> = {
    BTC: ['WBTC', 'cbBTC', 'BTC'],
    ETH: ['WETH', 'ETH'],
    SOL: ['SOL', 'WSOL'],
    PAXG: ['PAXG'],
  };

  const symbols = symMap[asset.toUpperCase()];
  if (!symbols || symbols.length === 0) return null;

  const symbolListSql = symbols.map((s) => `'${s}'`).join(', ');

  const sql = `
    SELECT
      SUM(CASE WHEN token_bought_symbol IN (${symbolListSql}) THEN amount_usd ELSE 0 END) as buy_usd,
      SUM(CASE WHEN token_sold_symbol IN (${symbolListSql}) THEN amount_usd ELSE 0 END) as sell_usd,
      COUNT(*) as tx_count
    FROM dex.trades
    WHERE block_time > now() - interval '2' hour
      AND amount_usd >= 25000
      AND (
        (token_bought_symbol IN (${symbolListSql}) AND token_sold_symbol IN ('USDC', 'USDT', 'DAI', 'FDUSD', 'USDbC'))
        OR (token_sold_symbol IN (${symbolListSql}) AND token_bought_symbol IN ('USDC', 'USDT', 'DAI', 'FDUSD', 'USDbC'))
      )
  `.trim();

  // Cache for 6 minutes to protect quota
  const res = await executeDuneSql<{ buy_usd: number | null; sell_usd: number | null; tx_count: number | null }>(sql, 6 * 60_000);
  if (!res.ok || !res.rows || res.rows.length === 0) return null;

  const row = res.rows[0];
  const buyUsd = Number(row.buy_usd) || 0;
  const sellUsd = Number(row.sell_usd) || 0;
  const txCount = Number(row.tx_count) || 0;

  // Inflow = net sell pressure (selling asset to stablecoins)
  // Negative = net buy accumulation
  const netInflowUsd = Math.round(sellUsd - buyUsd);

  return { netInflowUsd, txCount };
}

/**
 * Get recent high-value DEX whale trades (> $100k) across Uniswap, Curve, etc.
 */
export async function getDuneWhaleTrades(limit = 15): Promise<DuneWhaleTrade[]> {
  const safeLimit = Math.min(50, Math.max(5, limit));
  const sql = `
    SELECT
      CAST(block_time AS VARCHAR) as block_time,
      project,
      token_bought_symbol,
      token_sold_symbol,
      amount_usd
    FROM dex.trades
    WHERE block_time > now() - interval '3' hour
      AND amount_usd >= 100000
    ORDER BY block_time DESC
    LIMIT ${safeLimit}
  `.trim();

  const res = await executeDuneSql<DuneWhaleTrade>(sql, 90_000);
  return res.ok ? res.rows : [];
}

/**
 * Get top traded DEX tokens by 24h USD volume.
 */
export async function getDuneTopTokens24h(limit = 10): Promise<DuneTopToken[]> {
  const safeLimit = Math.min(25, Math.max(5, limit));
  const sql = `
    SELECT
      token_bought_symbol,
      count(*) as trades,
      sum(amount_usd) as total_usd
    FROM dex.trades
    WHERE block_time > now() - interval '24' hour
      AND amount_usd >= 10000
      AND token_bought_symbol IS NOT NULL
      AND length(token_bought_symbol) <= 10
    GROUP BY token_bought_symbol
    ORDER BY total_usd DESC
    LIMIT ${safeLimit}
  `.trim();

  const res = await executeDuneSql<DuneTopToken>(sql, 10 * 60_000);
  return res.ok ? res.rows : [];
}
