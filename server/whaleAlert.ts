// Whale Alert factor - large on-chain transactions from whale-alert.io (free tier, API key required).
// Interpretation: net exchange INFLOW = potential sell pressure; net OUTFLOW = accumulation.
// Without WHALE_ALERT_API_KEY the factor degrades to null (never throws).
// Comments are English-only on purpose (codepage safety under shell tooling).

export interface WhaleNetflow {
  netInflowUsd: number; // positive = net deposits TO exchanges (sell pressure)
  txCount: number;
}

const WHALE_CACHE = new Map<string, { value: WhaleNetflow | null; at: number }>();
const WHALE_TTL_MS = 10 * 60_000;
const WHALE_MIN_VALUE_USD = 1_000_000;
const WINDOW_SECONDS = 3600;

const WHALE_SYMBOLS: Record<string, string> = { BTC: 'btc', ETH: 'eth', PAXG: 'paxg', SOL: 'sol' };

function whaleAdjustmentInner(netInflowUsd: number): number {
  const abs = Math.abs(netInflowUsd);
  const sign = netInflowUsd > 0 ? -1 : 1; // inflow = sell pressure
  if (abs >= 25_000_000) return 3 * sign;
  if (abs >= 10_000_000) return 2 * sign;
  if (abs >= 3_000_000) return 1 * sign;
  return 0;
}

/** Single source of truth for the whale-netflow scoring rule (also used by signalEngine). */
export { whaleAdjustmentInner };
/** Back-compat alias for tests. */
export const __whaleAdjustmentInner = whaleAdjustmentInner;

/** Net exchange flow (USD) for the asset over the last hour, or null without a key / on failure. */
export async function getWhaleNetflow(asset: string): Promise<WhaleNetflow | null> {
  const cached = WHALE_CACHE.get(asset);
  if (cached && Date.now() - cached.at < WHALE_TTL_MS) return cached.value;
  const apiKey = process.env.WHALE_ALERT_API_KEY || '';
  const sym = WHALE_SYMBOLS[asset];
  if (!apiKey || !sym) {
    WHALE_CACHE.set(asset, { value: null, at: Date.now() });
    return null;
  }
  let value: WhaleNetflow | null = null;
  try {
    const startTime = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;
    const url =
      `https://api.whale-alert.io/v1/transactions?api_key=${apiKey}` +
      `&min_value=${WHALE_MIN_VALUE_USD}&start_time=${startTime}&limit=100&cursor=`;
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const body = (await res.json()) as {
        transactions?: {
          symbol: string;
          amountUsd: number;
          from?: { ownerType?: string };
          to?: { ownerType?: string };
        }[];
      };
      let netInflowUsd = 0;
      let txCount = 0;
      for (const tx of body?.transactions ?? []) {
        if (String(tx.symbol).toLowerCase() !== sym) continue;
        if (!Number.isFinite(tx.amountUsd)) continue;
        const toExchange = tx.to?.ownerType === 'exchange';
        const fromExchange = tx.from?.ownerType === 'exchange';
        if (!toExchange && !fromExchange) continue;
        if (toExchange && fromExchange) continue; // internal exchange shuffle
        txCount++;
        netInflowUsd += toExchange ? tx.amountUsd : -tx.amountUsd;
      }
      value = { netInflowUsd: Math.round(netInflowUsd), txCount };
    }
  } catch {
    value = null;
  }
  WHALE_CACHE.set(asset, { value, at: Date.now() });
  return value;
}