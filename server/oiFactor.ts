// Open interest factor - Binance futures public data, cached, graceful degradation.
// Rising OI = new money confirms the prevailing move; falling OI = move losing fuel.
// Comments are English-only on purpose (codepage safety under shell tooling).

const OI_CACHE = new Map<string, { value: number | null; at: number }>();
const OI_TTL_MS = 10 * 60_000;
const SYMBOLS: Record<string, string> = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', PAXG: 'PAXGUSDT' };

/** 24h open-interest percent change, or null when unavailable (never throws). */
export async function getOpenInterestChange24h(asset: string): Promise<number | null> {
  const cached = OI_CACHE.get(asset);
  if (cached && Date.now() - cached.at < OI_TTL_MS) return cached.value;
  let value: number | null = null;
  try {
    const symbol = SYMBOLS[asset];
    if (symbol) {
      const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=25`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const arr = (await res.json()) as { sumOpenInterest: string }[];
        if (Array.isArray(arr) && arr.length >= 2) {
          const first = Number(arr[0].sumOpenInterest);
          const last = Number(arr[arr.length - 1].sumOpenInterest);
          if (Number.isFinite(first) && Number.isFinite(last) && first > 0) {
            value = Math.round(((last - first) / first) * 1000) / 10;
          }
        }
      }
    }
  } catch {
    value = null;
  }
  OI_CACHE.set(asset, { value, at: Date.now() });
  return value;
}

/**
 * Pure scoring rule: rising OI confirms the prevailing trend (+/-2), falling OI
 * warns of exhaustion (sign flips). No data -> 0.
 */
export function openInterestAdjustment(oiChange24h: number | null, emaTrend: string): number {
  if (oiChange24h === null || !Number.isFinite(oiChange24h)) return 0;
  const bearish = emaTrend === 'BEARISH' || emaTrend === 'STRONG_BEARISH';
  if (oiChange24h >= 3) return bearish ? -2 : 2;
  if (oiChange24h <= -3) return bearish ? 2 : -2;
  return 0;
}