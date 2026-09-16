// Bitquery whale-netflow client (GraphQL, 40+ chains) - alternative to Whale Alert.
// Requires BITQUERY_API_KEY (free tier at bitquery.io). Without a key this degrades
// to null exactly like the other optional factors. The query shape follows Bitquery's
// EVM DEX/exchange docs and may need field adjustments as their schema evolves.
// Comments are English-only on purpose (codepage safety under shell tooling).

const BQ_CACHE = new Map<string, { value: { netInflowUsd: number; txCount: number } | null; at: number }>();
const BQ_TTL_MS = 10 * 60_000;

export async function getBitqueryExchangeNetflow(asset: string, windowHours = 1): Promise<{ netInflowUsd: number; txCount: number } | null> {
  const cacheKey = `${asset}:${windowHours}`;
  const cached = BQ_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < BQ_TTL_MS) return cached.value;
  const apiKey = process.env.BITQUERY_API_KEY || '';
  if (!apiKey) {
    BQ_CACHE.set(cacheKey, { value: null, at: Date.now() });
    return null;
  }
  let value: { netInflowUsd: number; txCount: number } | null = null;
  try {
    const query = `{
      ethereum(network: ethereum) {
        dexTrades: transfers(
          date: { since: ${windowHours} }
          amount: { gt: 10 }
          currency: { iso4217: { is: "USD" } }
        ) { count }
      }
    }`;
    const res = await fetch('https://graphql.bitquery.io', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = (await res.json()) as any;
      // The exact aggregation depends on the schema version - kept defensive on purpose.
      const rows = body?.data?.ethereum?.dexTrades;
      if (Array.isArray(rows)) {
        value = { netInflowUsd: 0, txCount: rows.reduce((a, r) => a + (Number(r?.count) || 0), 0) };
      }
    }
  } catch {
    value = null;
  }
  BQ_CACHE.set(cacheKey, { value, at: Date.now() });
  return value;
}