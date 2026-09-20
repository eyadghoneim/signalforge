// Optional Dune Analytics read-only context. It is deliberately kept out of
// signal scoring until its data quality and historical coverage are validated.
import type { SupportedAsset } from '../shared/types';

const DUNE_API = 'https://api.dune.com/api/v1';
const CACHE_TTL_MS = 30 * 60_000;
const QUERY_TIMEOUT_MS = 45_000;

const WATCHED_ASSETS: { asset: SupportedAsset; blockchain: string; tokenAddress: string }[] = [
  { asset: 'ETH', blockchain: 'ethereum', tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  { asset: 'PAXG', blockchain: 'ethereum', tokenAddress: '0x45804880de22913dafe09f4980848ece6ecbaf78' },
  { asset: 'SOL', blockchain: 'solana', tokenAddress: 'so11111111111111111111111111111111111111112' },
  { asset: 'BTC', blockchain: 'ethereum', tokenAddress: '0x2260fac5e5542a773aa44fbcedf7c193bc2c599' },
];

const WATCHED_SQL = WATCHED_ASSETS
  .map((item) => `('${item.asset}', '${item.blockchain}', '${item.tokenAddress}')`)
  .join(', ');

const DEX_CONTEXT_SQL = `
WITH watched AS (
  SELECT * FROM (VALUES ${WATCHED_SQL}) AS t(asset, blockchain, token_address)
)
SELECT
  w.asset,
  dt.blockchain,
  SUM(dt.amount_usd) AS volume_usd,
  COUNT(*) AS trade_count,
  SUM(CASE WHEN dt.amount_usd >= 100000 THEN 1 ELSE 0 END) AS whale_trade_count,
  SUM(CASE WHEN dt.amount_usd >= 100000 THEN dt.amount_usd ELSE 0 END) AS whale_volume_usd,
  MAX(dt.amount_usd) AS largest_trade_usd
FROM dex.trades dt
JOIN watched w
  ON dt.blockchain = w.blockchain
 AND (
   LOWER(CAST(dt.token_bought_address AS VARCHAR)) = w.token_address
   OR LOWER(CAST(dt.token_sold_address AS VARCHAR)) = w.token_address
 )
WHERE dt.block_time > NOW() - INTERVAL '24' HOUR
  AND dt.amount_usd IS NOT NULL
GROUP BY 1, 2
ORDER BY volume_usd DESC
`;

export interface DuneAssetMetric {
  asset: SupportedAsset;
  blockchain: string;
  volume24hUsd: number;
  tradeCount: number;
  whaleTradeCount: number;
  whaleVolume24hUsd: number;
  largestTradeUsd: number | null;
}

export interface DuneSnapshot {
  ok: true;
  enabled: true;
  source: 'DUNE';
  windowHours: 24;
  fetchedAt: number;
  assets: DuneAssetMetric[];
  noteAr: string;
  noteEn: string;
}

export interface DuneUnavailable {
  ok: false;
  enabled: boolean;
  source: 'DUNE';
  fetchedAt: number | null;
  error: string;
}

export type DuneResponse = DuneSnapshot | DuneUnavailable;

type JsonRecord = Record<string, unknown>;

let cached: DuneSnapshot | null = null;
let inFlight: Promise<DuneResponse> | null = null;

function apiKey(): string {
  return (process.env.DUNE_API_KEY || '').trim();
}

async function duneJson<T extends JsonRecord>(url: string, init: RequestInit): Promise<T> {
  const key = apiKey();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'X-Dune-Api-Key': key,
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

async function executeSql(): Promise<DuneSnapshot> {
  const started = await duneJson<{ execution_id?: string }>(`${DUNE_API}/sql/execute`, {
    method: 'POST',
    body: JSON.stringify({ sql: DEX_CONTEXT_SQL, performance: 'medium' }),
  });
  const executionId = String(started.execution_id || '');
  if (!executionId) throw new Error('Dune did not return an execution id');

  const deadline = Date.now() + QUERY_TIMEOUT_MS;
  let status: JsonRecord = {};
  while (Date.now() < deadline) {
    status = await duneJson<JsonRecord>(`${DUNE_API}/execution/${executionId}/status`, { method: 'GET' });
    if (status.is_execution_finished === true || status.state === 'QUERY_STATE_COMPLETED' || status.state === 'QUERY_STATE_FAILED') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (status.state !== 'QUERY_STATE_COMPLETED') {
    throw new Error(`Dune query did not complete: ${String(status.state || 'timeout')}`);
  }

  const result = await duneJson<{ result?: { rows?: JsonRecord[] } }>(`${DUNE_API}/execution/${executionId}/results`, { method: 'GET' });
  const rows = Array.isArray(result.result?.rows) ? result.result.rows : [];
  const assets: DuneAssetMetric[] = rows
    .map((row) => ({
      asset: String(row.asset) as SupportedAsset,
      blockchain: String(row.blockchain || ''),
      volume24hUsd: asNumber(row.volume_usd),
      tradeCount: Math.round(asNumber(row.trade_count)),
      whaleTradeCount: Math.round(asNumber(row.whale_trade_count)),
      whaleVolume24hUsd: asNumber(row.whale_volume_usd),
      largestTradeUsd: Number.isFinite(Number(row.largest_trade_usd)) ? Number(row.largest_trade_usd) : null,
    }))
    .filter((row) => WATCHED_ASSETS.some((asset) => asset.asset === row.asset));

  return {
    ok: true,
    enabled: true,
    source: 'DUNE',
    windowHours: 24,
    fetchedAt: Date.now(),
    assets,
    noteAr: 'بيانات DEX لآخر 24 ساعة — سياق بحثي فقط ولا تغيّر قرار الإشارة تلقائيًا.',
    noteEn: 'DEX data for the last 24 hours — research context only; it does not change signals automatically.',
  };
}

export async function getDuneSnapshot(): Promise<DuneResponse> {
  const key = apiKey();
  if (!key) {
    return { ok: false, enabled: false, source: 'DUNE', fetchedAt: null, error: 'DUNE_API_KEY is not configured' };
  }
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = executeSql()
    .then((snapshot) => {
      cached = snapshot;
      return snapshot;
    })
    .catch((error) => ({
      ok: false as const,
      enabled: true,
      source: 'DUNE' as const,
      fetchedAt: cached?.fetchedAt ?? null,
      error: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
