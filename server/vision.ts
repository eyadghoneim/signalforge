// Binance Vision bulk history - monthly kline ZIP archives from data.binance.vision.
// Zero rate limits, years of history - removes the backtest's biggest data constraint.
// The current (incomplete) month is NOT in Vision; callers must merge a recent tail
// from the live API. Comments are English-only (codepage safety).

import { unzipSync } from 'fflate';
import type { Candle, SupportedAsset } from '../shared/types';

const VISION_CACHE = new Map<string, { value: Candle[] | null; at: number }>();
const VISION_TTL_MS = 24 * 60 * 60_000; // archives are static - cache a full day

function visionSymbol(asset: SupportedAsset): string {
  return `${asset}USDT`;
}

/**
 * Pure CSV parser for Binance Vision kline files.
 * Rows: open_time,open,high,low,close,volume,... (no header; extra columns ignored).
 * Timestamp gotcha: recent archives use MICROSECONDS, older ones use milliseconds.
 */
export function parseBinanceVisionCsv(csvText: string): Candle[] {
  const out: Candle[] = [];
  for (const line of csvText.split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 6) continue;
    const openTimeMs = Number(cols[0]);
    if (!Number.isFinite(openTimeMs) || openTimeMs <= 0) continue;
    // normalize to epoch SECONDS (handle microseconds-era files)
    const time = openTimeMs > 1e14 ? Math.floor(openTimeMs / 1_000_000) : Math.floor(openTimeMs / 1000);
    const open = Number(cols[1]);
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    const volume = Number(cols[5]);
    if (![open, high, low, close, volume].every(Number.isFinite) || close <= 0) continue;
    out.push({ time, open, high, low, close, volume });
  }
  return out;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Fetch ~`months` monthly 1h archives (completed months only) for the asset.
 * Returns null when the bulk source is unavailable - callers fall back to the API.
 */
export async function getVisionMonthlyKlines(asset: SupportedAsset, months: number): Promise<Candle[] | null> {
  const cacheKey = `${asset}:${months}`;
  const cached = VISION_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < VISION_TTL_MS) return cached.value;

  const symbol = visionSymbol(asset);
  const all: Candle[] = [];
  const now = new Date();
  const requested: string[] = [];
  for (let m = 0; m < months; m++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    requested.push(monthKey(d));
  }
  requested.reverse(); // oldest first

  try {
    for (const mk of requested) {
      const cacheKeyMonth = `${cacheKey}:${mk}`;
      const cachedMonth = VISION_CACHE.get(cacheKeyMonth);
      if (cachedMonth && Date.now() - cachedMonth.at < VISION_TTL_MS) {
        if (cachedMonth.value) all.push(...cachedMonth.value);
        continue;
      }
      const url = `https://data.binance.vision/data/spot/monthly/klines/${symbol}/1h/${symbol}-1h-${mk}.zip`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        // missing archive (e.g. current month) - skip it silently
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const files = unzipSync(bytes);
      const csvEntry = Object.keys(files).find((f) => f.endsWith('.csv'));
      if (!csvEntry) continue;
      const csvText = new TextDecoder().decode(files[csvEntry]);
      const candles = parseBinanceVisionCsv(csvText);
      VISION_CACHE.set(cacheKeyMonth, { value: candles, at: Date.now() });
      all.push(...candles);
    }
  } catch {
    // خطأ مؤقت — كاش قصير جداً (دقيقة واحدة) حتى لا يُحظر الأصل 24 ساعة بسبب فشل اتصال عابر
    VISION_CACHE.set(cacheKey, { value: null, at: Date.now() - VISION_TTL_MS + 60_000 });
    return null;
  }

  // dedupe by time + sort ascending
  const byTime = new Map<number, Candle>();
  for (const c of all) byTime.set(c.time, c);
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);

  const value = merged.length > 0 ? merged : null;
  VISION_CACHE.set(cacheKey, { value, at: Date.now() });
  return value;
}