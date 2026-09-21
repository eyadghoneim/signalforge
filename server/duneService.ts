// Dune Analytics Plus read-only research service.
// The Dune layer is intentionally kept out of signal scoring and trading decisions.
// The API key is accepted from the process environment only; it is never persisted.

import { STABLECOIN_SYMBOLS } from '../shared/stablecoins';

const DUNE_API = 'https://api.dune.com/api/v1';
const DEFAULT_CACHE_TTL_MS = 30 * 60_000;
const QUERY_TIMEOUT_MS = 45_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SQL_LENGTH = 20_000;
const MAX_RESULT_ROWS = 500;

const STABLE_SYMBOLS = STABLECOIN_SYMBOLS;

const WATCHED_ASSETS = {
  BTC: { blockchain: 'ethereum', address: '0x2260fac5e5542a773aa44fbcedf7c193bc2c599' },
  ETH: { blockchain: 'ethereum', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  PAXG: { blockchain: 'ethereum', address: '0x45804880de22913dafe09f4980848ece6ecbaf78' },
  SOL: { blockchain: 'solana', address: 'so11111111111111111111111111111111111111112' },
} as const;

type WatchedAsset = keyof typeof WATCHED_ASSETS;

type JsonRecord = Record<string, unknown>;

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

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const queryCache = new Map<string, CacheEntry>();

function getApiKey(): string {
  return String(process.env.DUNE_API_KEY || '').trim();
}

export function getDuneApiKey(): string {
  // Deliberately do not read config.json or any other persisted file.
  return getApiKey();
}

export function isDuneAvailable(): boolean {
  return getApiKey().length > 0;
}

function getCached<T>(key: string): T | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    queryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T, ttlMs = DEFAULT_CACHE_TTL_MS): void {
  queryCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Validate SQL before it can be sent to Dune. Dune itself remains read-only. */
export function validateDuneSql(sql: string, requireLimit = false): string | null {
  const text = String(sql || '').trim();
  if (!text) return 'SQL query is required';
  if (text.length > MAX_SQL_LENGTH) return `SQL query is too long (maximum ${MAX_SQL_LENGTH} characters)`;

  const normalized = text.toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    return 'Only SELECT / WITH read-only queries are permitted';
  }
  if (text.includes(';')) return 'Multiple SQL statements are not permitted';
  if (/\b(insert|update|delete|drop|alter|create|merge|truncate|grant|revoke|call|execute)\b/i.test(text)) {
    return 'Only read-only SQL is permitted';
  }
  if (requireLimit && !/\blimit\s+\d+\b/i.test(text)) {
    return 'A LIMIT clause is required for custom Dune queries';
  }
  return null;
}

async function duneJson<T extends JsonRecord>(url: string, init: RequestInit): Promise<T> {
  const key = getApiKey();
  if (!key) throw new Error('Dune API key not configured');
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'X-DUNE-API-KEY': key,
      ...(init.headers || {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    throw new Error(String(body.error || body.detail || `Dune HTTP ${response.status}`));
  }
  return body as T;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function watchedValuesSql(): string {
  return Object.entries(WATCHED_ASSETS)
    .map(([asset, item]) => `(${sqlLiteral(asset)}, ${sqlLiteral(item.blockchain)}, ${sqlLiteral(item.address)})`)
    .join(', ');
}

export async function executeDuneSql<T = Record<string, unknown>>(
  sql: string,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  maxWaitMs = QUERY_TIMEOUT_MS,
): Promise<{ ok: boolean; rows: T[]; executionTimeMs: number; error?: string }> {
  const validationError = validateDuneSql(sql);
  if (validationError) return { ok: false, rows: [], executionTimeMs: 0, error: validationError };
  if (!isDuneAvailable()) return { ok: false, rows: [], executionTimeMs: 0, error: 'Dune API key not configured' };

  const normalizedSql = sql.trim();
  const cacheKey = `dune:sql:${normalizedSql}`;
  const cached = getCached<{ rows: T[]; executionTimeMs: number }>(cacheKey);
  if (cached) return { ok: true, rows: cached.rows, executionTimeMs: cached.executionTimeMs };

  const startedAt = Date.now();
  try {
    const submitted = await duneJson<{ execution_id?: string }>(`${DUNE_API}/sql/execute`, {
      method: 'POST',
      // Medium is available on the current Plus trial; small is not.
      body: JSON.stringify({ sql: normalizedSql, performance: 'medium' }),
    });
    const executionId = String(submitted.execution_id || '');
    if (!executionId) throw new Error('Dune did not return an execution id');

    const deadline = Date.now() + maxWaitMs;
    let status: JsonRecord = {};
    while (Date.now() < deadline) {
      status = await duneJson<JsonRecord>(`${DUNE_API}/execution/${executionId}/status`, { method: 'GET' });
      if (status.is_execution_finished === true || status.state === 'QUERY_STATE_COMPLETED' || status.state === 'QUERY_STATE_FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (status.state !== 'QUERY_STATE_COMPLETED') {
      throw new Error(`Dune query did not complete: ${String(status.state || 'timeout')}`);
    }

    const result = await duneJson<{ result?: { rows?: T[] } }>(`${DUNE_API}/execution/${executionId}/results`, { method: 'GET' });
    const rows = Array.isArray(result.result?.rows) ? result.result.rows.slice(0, MAX_RESULT_ROWS) : [];
    const executionTimeMs = Date.now() - startedAt;
    setCached(cacheKey, { rows, executionTimeMs }, ttlMs);
    return { ok: true, rows, executionTimeMs };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      executionTimeMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Asset-specific Dune netflow for the verified contract address only. */
export async function getDuneWhaleNetflow(asset: string): Promise<{ netInflowUsd: number; txCount: number } | null> {
  const key = String(asset || '').toUpperCase() as WatchedAsset;
  const watched = WATCHED_ASSETS[key];
  if (!watched) return null;
  const address = sqlLiteral(watched.address);
  const blockchain = sqlLiteral(watched.blockchain);
  const stables = STABLE_SYMBOLS.map(sqlLiteral).join(', ');
  const sql = `
SELECT
  SUM(CASE WHEN LOWER(CAST(token_sold_address AS VARCHAR)) = ${address} THEN amount_usd ELSE 0 END) AS sell_usd,
  SUM(CASE WHEN LOWER(CAST(token_bought_address AS VARCHAR)) = ${address} THEN amount_usd ELSE 0 END) AS buy_usd,
  COUNT(*) AS tx_count
FROM dex.trades
WHERE blockchain = ${blockchain}
  AND block_time > NOW() - INTERVAL '24' HOUR
  AND amount_usd >= 25000
  AND ((LOWER(CAST(token_sold_address AS VARCHAR)) = ${address} AND token_bought_symbol IN (${stables}))
    OR (LOWER(CAST(token_bought_address AS VARCHAR)) = ${address} AND token_sold_symbol IN (${stables})))
`.trim();

  const result = await executeDuneSql<{ sell_usd: number | null; buy_usd: number | null; tx_count: number | null }>(sql, DEFAULT_CACHE_TTL_MS);
  if (!result.ok || result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    netInflowUsd: Math.round((Number(row.sell_usd) || 0) - (Number(row.buy_usd) || 0)),
    txCount: Math.round(Number(row.tx_count) || 0),
  };
}

/** Recent large swaps involving only the verified BTC/ETH/PAXG/SOL contracts. */
export async function getDuneWhaleTrades(limit = 15): Promise<DuneWhaleTrade[]> {
  const safeLimit = Math.min(50, Math.max(5, Math.floor(Number(limit) || 15)));
  const sql = `
WITH watched AS (
  SELECT * FROM (VALUES ${watchedValuesSql()}) AS t(asset, blockchain, token_address)
)
SELECT
  CAST(dt.block_time AS VARCHAR) AS block_time,
  dt.project,
  dt.token_bought_symbol,
  dt.token_sold_symbol,
  dt.amount_usd
FROM dex.trades dt
JOIN watched w
  ON dt.blockchain = w.blockchain
 AND (LOWER(CAST(dt.token_bought_address AS VARCHAR)) = w.token_address
   OR LOWER(CAST(dt.token_sold_address AS VARCHAR)) = w.token_address)
WHERE dt.block_time > NOW() - INTERVAL '24' HOUR
  AND dt.amount_usd >= 100000
ORDER BY dt.block_time DESC
LIMIT ${safeLimit}
`.trim();
  const result = await executeDuneSql<DuneWhaleTrade>(sql, DEFAULT_CACHE_TTL_MS);
  if (!result.ok) return [];
  return result.rows.map((row) => ({
    block_time: String(row.block_time || ''),
    project: String(row.project || ''),
    token_bought_symbol: String(row.token_bought_symbol || ''),
    token_sold_symbol: String(row.token_sold_symbol || ''),
    amount_usd: asNumber(row.amount_usd),
  }));
}

/** Top DEX volume for the verified watched assets only. */
export async function getDuneTopTokens24h(limit = 10): Promise<DuneTopToken[]> {
  const safeLimit = Math.min(25, Math.max(5, Math.floor(Number(limit) || 10)));
  const sql = `
WITH watched AS (
  SELECT * FROM (VALUES ${watchedValuesSql()}) AS t(asset, blockchain, token_address)
)
SELECT
  dt.token_bought_symbol,
  COUNT(*) AS trades,
  SUM(dt.amount_usd) AS total_usd
FROM dex.trades dt
JOIN watched w
  ON dt.blockchain = w.blockchain
 AND LOWER(CAST(dt.token_bought_address AS VARCHAR)) = w.token_address
WHERE dt.block_time > NOW() - INTERVAL '24' HOUR
  AND dt.amount_usd >= 10000
  AND dt.token_bought_symbol IS NOT NULL
GROUP BY dt.token_bought_symbol
ORDER BY total_usd DESC
LIMIT ${safeLimit}
`.trim();
  const result = await executeDuneSql<DuneTopToken>(sql, DEFAULT_CACHE_TTL_MS);
  if (!result.ok) return [];
  return result.rows.map((row) => ({
    token_bought_symbol: String(row.token_bought_symbol || ''),
    trades: Math.round(asNumber(row.trades)),
    total_usd: asNumber(row.total_usd),
  }));
}

export { MAX_RESULT_ROWS };
