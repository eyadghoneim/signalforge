// DexScreener factor-source (free, no key) - live DEX pairs, liquidity and volume.
// Informational layer: exposed via /api/dex/pairs - NOT wired into scoring (our assets
// trade on CEXs; DEX liquidity is context, not a direct factor for them).
// Comments are English-only on purpose (codepage safety under shell tooling).

const CACHE = new Map<string, { value: DexPairInfo[] | null; at: number }>();
const TTL_MS = 5 * 60_000;
const CACHE_MAX_KEYS = 200; // سقف أمان — نص البحث مفتوح، الكاش لا ينمو بلا حدود

export interface DexPairInfo {
  chainId: string;
  dexId: string;
  pairUrl: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPercent: number | null;
}

/** Top DEX pools by liquidity for a search term, or null on failure. */
export async function getTopDexPairs(query: string): Promise<DexPairInfo[] | null> {
  const key = `search:${query.toLowerCase()}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value: DexPairInfo[] | null = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = (await res.json()) as { pairs?: any[] };
      const pairs = (body?.pairs ?? [])
        .filter((p) => Number.isFinite(Number(p?.liquidity?.usd)))
        .sort((a, b) => Number(b.liquidity.usd) - Number(a.liquidity.usd))
        .slice(0, 5)
        .map((p) => ({
          chainId: String(p.chainId ?? ''),
          dexId: String(p.dexId ?? ''),
          pairUrl: String(p.url ?? ''),
          priceUsd: p.priceUsd !== undefined ? Number(p.priceUsd) : null,
          liquidityUsd: Number(p?.liquidity?.usd) || null,
          volume24hUsd: Number(p?.volume?.h24) || null,
          priceChange24hPercent: p?.priceChange?.h24 !== undefined ? Number(p.priceChange.h24) : null,
        }));
      if (pairs.length > 0) value = pairs;
    }
  } catch {
    value = null;
  }
  CACHE.set(key, { value, at: Date.now() });
  // تنظيف الكاش: يمسح المنتهي + يحافظ على السقف الأقصى (LRU بسيط بالأقدم)
  if (CACHE.size > CACHE_MAX_KEYS) {
    for (const k of CACHE.keys()) {
      const e = CACHE.get(k);
      if (e && Date.now() - e.at > TTL_MS) CACHE.delete(k);
      if (CACHE.size <= CACHE_MAX_KEYS) break;
    }
    while (CACHE.size > CACHE_MAX_KEYS) {
      const first = CACHE.keys().next().value;
      if (first === undefined) break;
      CACHE.delete(first);
    }
  }
  return value;
}