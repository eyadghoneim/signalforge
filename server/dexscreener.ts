// DexScreener factor-source (free, no key) - live DEX pairs, liquidity and volume.
// Informational layer: exposed via /api/dex/pairs - NOT wired into scoring (our assets
// trade on CEXs; DEX liquidity is context, not a direct factor for them).
// Comments are English-only on purpose (codepage safety under shell tooling).

const CACHE = new Map<string, { value: DexPairInfo[]; at: number }>();
const TTL_MS = 5 * 60_000;
const CACHE_MAX_KEYS = 200; // سقف أمان — نص البحث مفتوح، الكاش لا ينمو بلا حدود
const DEX_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search?q=';
const DEX_HEADERS = {
  accept: 'application/json',
  // DexScreener may reject anonymous server-side requests without a user agent.
  'user-agent': 'SignalForge/3.1 (+https://github.com/eyadghoneim/signalforge)',
};

export interface DexPairInfo {
  chainId: string;
  dexId: string;
  pairUrl: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPercent: number | null;
}

interface DexScreenerPair {
  chainId?: unknown;
  dexId?: unknown;
  url?: unknown;
  priceUsd?: unknown;
  liquidity?: { usd?: unknown };
  volume?: { h24?: unknown };
  priceChange?: { h24?: unknown };
}

/** Convert the upstream payload into the small safe shape exposed to the UI. */
export function normalizeDexPairs(raw: unknown): DexPairInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is DexScreenerPair => {
      if (!item || typeof item !== 'object') return false;
      const pair = item as DexScreenerPair;
      return Number.isFinite(Number(pair.liquidity?.usd));
    })
    .sort((a, b) => Number(b.liquidity?.usd) - Number(a.liquidity?.usd))
    .slice(0, 5)
    .map((p) => ({
      chainId: String(p.chainId ?? ''),
      dexId: String(p.dexId ?? ''),
      pairUrl: String(p.url ?? ''),
      priceUsd: p.priceUsd !== undefined && Number.isFinite(Number(p.priceUsd)) ? Number(p.priceUsd) : null,
      liquidityUsd: Number(p.liquidity?.usd) || null,
      volume24hUsd: p.volume?.h24 !== undefined && Number.isFinite(Number(p.volume.h24)) ? Number(p.volume.h24) : null,
      priceChange24hPercent:
        p.priceChange?.h24 !== undefined && Number.isFinite(Number(p.priceChange.h24)) ? Number(p.priceChange.h24) : null,
    }));
}

/**
 * One upstream request. null means provider failure; [] means a valid response
 * with no usable pairs. Keeping that distinction prevents transient failures from
 * being cached as "no pairs".
 */
async function fetchDexSearch(query: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(`${DEX_SEARCH_URL}${encodeURIComponent(query)}`, {
      headers: DEX_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { pairs?: unknown };
    return Array.isArray(body?.pairs) ? body.pairs : [];
  } catch {
    return null;
  }
}

/** Top DEX pools by liquidity for a search term, or null on provider failure. */
export async function getTopDexPairs(query: string): Promise<DexPairInfo[] | null> {
  const normalized = query.trim().slice(0, 30);
  const key = `search:${normalized.toLowerCase()}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const rawPairs = await fetchDexSearch(normalized);
  if (rawPairs === null) {
    // Do not poison the cache with a temporary 403/429/timeout. If an older
    // successful result exists, keep showing it while the provider recovers.
    return cached?.value ?? null;
  }

  const pairs = normalizeDexPairs(rawPairs);
  CACHE.set(key, { value: pairs, at: Date.now() });

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
  return pairs;
}
