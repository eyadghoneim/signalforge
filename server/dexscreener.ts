// Verified DEX liquidity context from DexScreener (free, no key).
// Informational layer: exposed via /api/dex/pairs - NOT wired into scoring.
// We query canonical token addresses instead of ambiguous ticker symbols so a
// token that merely reuses BTC/ETH/PAXG/SOL cannot appear as the real asset.
// Comments are English-only on purpose (codepage safety under shell tooling).

import type { SupportedAsset } from '../shared/types';

const CACHE = new Map<string, { value: DexPairInfo[]; at: number }>();
const TTL_MS = 5 * 60_000;
const CACHE_MAX_KEYS = 200;
const DEX_HEADERS = {
  accept: 'application/json',
  'user-agent': 'SignalForge/3.1 (+https://github.com/eyadghoneim/signalforge)',
};

interface VerifiedDexAsset {
  chainId: string;
  address: string;
  wrappedSymbol: string;
}

// One canonical, publicly verifiable token representation per supported asset.
// Native SOL is represented by its official WSOL mint on Solana; the other
// three use their canonical Ethereum token contracts for DEX liquidity context.
export const VERIFIED_DEX_ASSETS: Record<SupportedAsset, VerifiedDexAsset> = {
  BTC: {
    chainId: 'ethereum',
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
    wrappedSymbol: 'WBTC',
  },
  ETH: {
    chainId: 'ethereum',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    wrappedSymbol: 'WETH',
  },
  PAXG: {
    chainId: 'ethereum',
    address: '0x45804880De22913dAFE09f4980848ECE6EcbAf78', // Paxos PAXG
    wrappedSymbol: 'PAXG',
  },
  SOL: {
    chainId: 'solana',
    address: 'So11111111111111111111111111111111111111112', // official WSOL mint
    wrappedSymbol: 'SOL',
  },
};

export interface DexPairInfo {
  chainId: string;
  dexId: string;
  pairUrl: string;
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPercent: number | null;
}

interface DexScreenerPair {
  chainId?: unknown;
  dexId?: unknown;
  url?: unknown;
  baseToken?: { address?: unknown; symbol?: unknown };
  quoteToken?: { address?: unknown; symbol?: unknown };
  priceUsd?: unknown;
  liquidity?: { usd?: unknown };
  volume?: { h24?: unknown };
  priceChange?: { h24?: unknown };
}

function sameAddress(value: unknown, expected: string): boolean {
  if (typeof value !== 'string') return false;
  return expected.startsWith('0x') ? value.toLowerCase() === expected.toLowerCase() : value === expected;
}

/** Convert only pairs containing the expected canonical token into UI data. */
export function normalizeDexPairs(raw: unknown, verified?: VerifiedDexAsset): DexPairInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is DexScreenerPair => {
      if (!item || typeof item !== 'object') return false;
      const pair = item as DexScreenerPair;
      if (!Number.isFinite(Number(pair.liquidity?.usd))) return false;
      if (verified && String(pair.chainId ?? '') !== verified.chainId) return false;
      if (
        verified &&
        !sameAddress(pair.baseToken?.address, verified.address) &&
        !sameAddress(pair.quoteToken?.address, verified.address)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => Number(b.liquidity?.usd) - Number(a.liquidity?.usd))
    .slice(0, 5)
    .map((p) => ({
      chainId: String(p.chainId ?? ''),
      dexId: String(p.dexId ?? ''),
      pairUrl: String(p.url ?? ''),
      baseTokenSymbol: String(p.baseToken?.symbol ?? ''),
      quoteTokenSymbol: String(p.quoteToken?.symbol ?? ''),
      priceUsd: p.priceUsd !== undefined && Number.isFinite(Number(p.priceUsd)) ? Number(p.priceUsd) : null,
      liquidityUsd: Number(p.liquidity?.usd) || null,
      volume24hUsd: p.volume?.h24 !== undefined && Number.isFinite(Number(p.volume.h24)) ? Number(p.volume.h24) : null,
      priceChange24hPercent:
        p.priceChange?.h24 !== undefined && Number.isFinite(Number(p.priceChange.h24)) ? Number(p.priceChange.h24) : null,
    }));
}

/** null means provider failure; [] means a valid response with no usable pairs. */
async function fetchDexTokenPairs(address: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`, {
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

/** Top verified DEX pools for one supported asset, or null on provider failure. */
export async function getTopDexPairs(query: string): Promise<DexPairInfo[] | null> {
  const asset = query.trim().toUpperCase() as SupportedAsset;
  const verified = VERIFIED_DEX_ASSETS[asset];
  if (!verified) return [];

  const key = `token:${asset}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const rawPairs = await fetchDexTokenPairs(verified.address);
  if (rawPairs === null) {
    // Never poison the cache with a temporary 403/429/timeout.
    return cached?.value ?? null;
  }

  const pairs = normalizeDexPairs(rawPairs, verified);
  CACHE.set(key, { value: pairs, at: Date.now() });

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
