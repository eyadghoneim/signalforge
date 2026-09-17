// طبقة بيانات السوق: مزودين متعددين + كاش + مهل زمنية + فشل صريح (بدون أسعار وهمية أبداً)
import type { Candle, SupportedAsset } from '../shared/types';
import { getVisionMonthlyKlines } from './vision';
import { OKX_BAR, OKX_SWAP, hasOkxSwap } from './symbols';

export class DataUnavailableError extends Error {
  asset: string;
  kind: string;
  constructor(asset: string, kind: string) {
    super(`Market data unavailable for ${asset} (${kind}) — all upstream providers failed`);
    this.asset = asset;
    this.kind = kind;
  }
}

const SYMBOLS: Record<SupportedAsset, { binance: string; coinbase: string; coingecko: string; bybit: string; okx: string }> = {
  BTC: { binance: 'BTCUSDT', coinbase: 'BTC-USD', coingecko: 'bitcoin', bybit: 'BTCUSDT', okx: 'BTC-USDT' },
  ETH: { binance: 'ETHUSDT', coinbase: 'ETH-USD', coingecko: 'ethereum', bybit: 'ETHUSDT', okx: 'ETH-USDT' },
  PAXG: { binance: 'PAXGUSDT', coinbase: 'PAXG-USD', coingecko: 'pax-gold', bybit: 'PAXGUSDT', okx: 'PAXG-USDT' },
  SOL: { binance: 'SOLUSDT', coinbase: 'SOL-USD', coingecko: 'solana', bybit: 'SOLUSDT', okx: 'SOL-USDT' },
};

// ─── كاش TTL مع منع الطلبات المكررة المتوازية ───
type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function readCache<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return e.data as T;
}

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = readCache<T>(key);
  if (hit !== null) return hit;
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = loader()
    .then((data) => {
      cache.set(key, { data, expiresAt: Date.now() + ttlMs });
      return data;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p as Promise<unknown>);
  return p;
}

// ─── تتبع صحة المزودين — شفافية كاملة عن مصادر البيانات ───
export function noteProviderHealth(provider: string, ok: boolean, error?: string): void {
  const cur = providerHealth.get(provider) || { lastOkAt: null, lastFailAt: null, lastError: null };
  if (ok) {
    cur.lastOkAt = Date.now();
  } else {
    cur.lastFailAt = Date.now();
    cur.lastError = (error || 'unknown error').slice(0, 120);
  }
  providerHealth.set(provider, cur);
}
export const providerHealth = new Map<string, { lastOkAt: number | null; lastFailAt: number | null; lastError: string | null }>();
/**
 * Hard wall-clock guard: resolve with `fallback` if `promise` does not settle in time.
 * Exists because a fetch stuck at the DNS stage may ignore its own abort signal.
 */
export function withTimeoutFallback<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    void promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 3500): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Ticker: السعر الحي + تغير 24 ساعة ───
export interface TickerData {
  asset: SupportedAsset;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  source: string;
}

async function tickerFromBinance(asset: SupportedAsset): Promise<TickerData> {
  try {
    const d = await fetchJsonWithTimeout<{
      lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; volume: string;
    }>(`https://api.binance.com/api/v3/ticker/24hr?symbol=${SYMBOLS[asset].binance}`);
    const price = parseFloat(d.lastPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error('binance bad price');
    noteProviderHealth('binance:ticker', true);
    return {
      asset, price,
      change24h: parseFloat(d.priceChangePercent) || 0,
      high24h: parseFloat(d.highPrice) || price,
      low24h: parseFloat(d.lowPrice) || price,
      volume24h: parseFloat(d.volume) || 0,
      source: 'binance',
    };
  } catch (e) {
    noteProviderHealth('binance:ticker', false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function tickerFromCoinbase(asset: SupportedAsset): Promise<TickerData> {
  const sym = SYMBOLS[asset].coinbase;
  try {
    const [ticker, stats] = await Promise.all([
      fetchJsonWithTimeout<{ price: string }>(`https://api.exchange.coinbase.com/products/${sym}/ticker`),
      fetchJsonWithTimeout<{ open: string; high: string; low: string; volume: string }>(
        `https://api.exchange.coinbase.com/products/${sym}/stats`,
      ),
    ]);
    const price = parseFloat(ticker.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error('coinbase bad price');
    const open = parseFloat(stats.open) || price;
    noteProviderHealth('coinbase:ticker', true);
    return {
      asset, price,
      change24h: open > 0 ? Number((((price - open) / open) * 100).toFixed(2)) : 0,
      high24h: parseFloat(stats.high) || price,
      low24h: parseFloat(stats.low) || price,
      volume24h: parseFloat(stats.volume) || 0,
      source: 'coinbase',
    };
  } catch (e) {
    noteProviderHealth('coinbase:ticker', false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function tickerFromCoingecko(asset: SupportedAsset): Promise<TickerData> {
  try {
    const d = await fetchJsonWithTimeout<Record<string, { usd: number; usd_24h_change?: number }>>(
      `https://api.coingecko.com/api/v3/simple/price?ids=${SYMBOLS[asset].coingecko}&vs_currencies=usd&include_24hr_change=true`,
    );
    const row = d[SYMBOLS[asset].coingecko];
    const price = row?.usd;
    if (!Number.isFinite(price) || price <= 0) throw new Error('coingecko bad price');
    noteProviderHealth('coingecko:ticker', true);
    return {
      asset, price,
      change24h: row.usd_24h_change ?? 0,
      high24h: price, low24h: price, volume24h: 0,
      source: 'coingecko',
    };
  } catch (e) {
    noteProviderHealth('coingecko:ticker', false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function getTicker(asset: SupportedAsset): Promise<TickerData> {
  return cached(`ticker:${asset}`, 30_000, async () => {
    // OKX/Coinbase first - reachable where Binance/Bybit are geo-blocked.
    const providers = [tickerFromOkx, tickerFromCoinbase, tickerFromBinance, tickerFromCoingecko];
    let lastErr: unknown = null;
    for (const p of providers) {
      try {
        return await p(asset);
      } catch (e) {
        lastErr = e;
      }
    }
    throw new DataUnavailableError(asset, `ticker (${String((lastErr as Error)?.message || lastErr)})`);
  });
}

async function tickerFromOkx(asset: SupportedAsset): Promise<TickerData> {
  try {
    const d = await fetchJsonWithTimeout<{
      code: string;
      data: Array<{ last: string; open24h: string; high24h: string; low24h: string; vol24h: string }>;
    }>(`https://www.okx.com/api/v5/market/ticker?instId=${SYMBOLS[asset].okx}`);
    const row = Array.isArray(d.data) ? d.data[0] : undefined;
    if (d.code !== '0' || !row) throw new Error('okx ticker bad response');
    const price = parseFloat(row.last);
    if (!Number.isFinite(price) || price <= 0) throw new Error('okx bad price');
    const open = parseFloat(row.open24h) || price;
    noteProviderHealth('okx:ticker', true);
    return {
      asset,
      price,
      change24h: open > 0 ? Number((((price - open) / open) * 100).toFixed(2)) : 0,
      high24h: parseFloat(row.high24h) || price,
      low24h: parseFloat(row.low24h) || price,
      volume24h: parseFloat(row.vol24h) || 0,
      source: 'okx',
    };
  } catch (e) {
    noteProviderHealth('okx:ticker', false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ─── الشموع ───
function mapBinanceKlines(rows: unknown[][]): Candle[] {
  return rows.map((r) => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: parseFloat(String(r[1])),
    high: parseFloat(String(r[2])),
    low: parseFloat(String(r[3])),
    close: parseFloat(String(r[4])),
    volume: parseFloat(String(r[5])),
  })).filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.close > 0);
}

async function candlesFromBinance(asset: SupportedAsset, interval: '1h' | '4h' | '1d', limit: number): Promise<Candle[]> {
  const d = await fetchJsonWithTimeout<unknown[][]>(
    `https://api.binance.com/api/v3/klines?symbol=${SYMBOLS[asset].binance}&interval=${interval}&limit=${limit}`,    6000,
  );
  const out = mapBinanceKlines(d);
  if (out.length < 50) throw new Error('binance candles too short');
  return out;
}

async function candlesFromOkx(asset: SupportedAsset, interval: '1h' | '4h' | '1d', limit: number): Promise<Candle[]> {
  // OKX v5 - primary live link (reachable where Binance/Bybit are geo-blocked, incl. SA).
  // market/candles returns max 300 newest-first rows; walk back with `after` for more.
  // Strictly sequential: OKX silently drops parallel history burst requests (verified).
  const bar = OKX_BAR[interval];
  const instId = SYMBOLS[asset].okx;
  const MAX = 300;
  const byTime = new Map<number, Candle>();
  let after: string | undefined;
  let pages = 0;
  while (byTime.size < limit && pages < 12) {
    const want = Math.min(MAX, limit - byTime.size);
    const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${want}${after ? `&after=${after}` : ''}`;
    const d = await fetchJsonWithTimeout<{ code?: string; data?: string[][] }>(url, 6000);
    if (d.code !== '0') throw new Error(`okx candles code ${d.code}`);
    const rows = (d.data ?? [])
      .map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: parseFloat(String(r[1])),
        high: parseFloat(String(r[2])),
        low: parseFloat(String(r[3])),
        close: parseFloat(String(r[4])),
        volume: parseFloat(String(r[5])),
      }))
      .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.close > 0);
    if (rows.length === 0) break;
    let oldest = Infinity;
    for (const c of rows) {
      if (c.time < oldest) oldest = c.time;
      if (!byTime.has(c.time)) byTime.set(c.time, c);
    }
    pages++;
    if (rows.length < MAX) break; // upstream exhausted
    after = String(oldest * 1000);
  }
  const out = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (out.length < 50) throw new Error('okx candles too short');
  return out.slice(-limit);
}
async function candlesFromCoinbase1h(asset: SupportedAsset): Promise<Candle[]> {
  // كوين بيس: 300 شمعة كحد أقصى ودعم 1h فقط — استخدام احتياطي
  const d = await fetchJsonWithTimeout<number[][]>(
    `https://api.exchange.coinbase.com/products/${SYMBOLS[asset].coinbase}/candles?granularity=3600`,
  );
  const out = d
    .map((r) => ({ time: r[0], low: r[1], high: r[2], open: r[3], close: r[4], volume: r[5] }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.close > 0)
    .sort((a, b) => a.time - b.time) as Candle[];
  if (out.length < 50) throw new Error('coinbase candles too short');
  return out;
}

async function candlesFromBybit(asset: SupportedAsset, interval: '1h' | '4h' | '1d', limit: number): Promise<Candle[]> {
  // Bybit v5 spot klines - a non-restricted fallback host for regions where Binance is blocked.
  const iv = interval === '1h' ? '60' : interval === '4h' ? '240' : 'D';
  const d = await fetchJsonWithTimeout<{ result?: { list?: string[][] } }>(
    `https://api.bybit.com/v5/market/kline?category=spot&symbol=${SYMBOLS[asset].bybit}&interval=${iv}&limit=${Math.min(limit, 1000)}`,    6000,
  );
  const rows = d.result?.list ?? [];
  const out = rows
    .map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: parseFloat(String(r[1])),
      high: parseFloat(String(r[2])),
      low: parseFloat(String(r[3])),
      close: parseFloat(String(r[4])),
      volume: parseFloat(String(r[5])),
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.close > 0)
    .sort((a, b) => a.time - b.time); // bybit returns newest-first
  if (out.length < 50) throw new Error('bybit candles too short');
  return out;
}

/** Drop cached candles for one asset so a forced refresh actually re-fetches. */
export function invalidateCandleCache(asset: SupportedAsset): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`c1h:${asset}:`) || key.startsWith(`c4h:${asset}:`) || key.startsWith(`c1d:${asset}:`)) cache.delete(key);
  }
}
export async function getCandles1h(asset: SupportedAsset, limit = 500): Promise<Candle[]> {
  return cached(`c1h:${asset}:${limit}`, 60_000, async () => {
    try {
      const out = await candlesFromOkx(asset, '1h', Math.min(limit, 1000));
      noteProviderHealth('okx:klines', true);
      return out;
    } catch (e) {
      noteProviderHealth('okx:klines', false, e instanceof Error ? e.message : String(e));
      try {
        const out = await candlesFromBinance(asset, '1h', Math.min(limit, 1000));
        noteProviderHealth('binance:klines', true);
        return out;
      } catch (e2) {
        noteProviderHealth('binance:klines', false, e2 instanceof Error ? e2.message : String(e2));
      }
      if (limit <= 300) {
        const cb = await candlesFromCoinbase1h(asset);
        noteProviderHealth('coinbase:candles', true);
        return cb.slice(-limit);
      }
      throw e;
    }
  });
}

// شموع الفريم اليومي — لبوابة الماكرو اليومية
export async function getCandles1d(asset: SupportedAsset, limit = 400): Promise<Candle[]> {
  return cached(`c1d:${asset}:${limit}`, 10 * 60_000, async () => {
    try {
      const out = await candlesFromOkx(asset, '1d', Math.min(limit, 400));
      noteProviderHealth('okx:klines', true);
      if (out.length < 75) throw new Error('okx daily too short');
      return out;
    } catch (e) {
      noteProviderHealth('okx:klines', false, e instanceof Error ? e.message : String(e));
      let out: Candle[];
      try {
        out = await candlesFromBinance(asset, '1d', Math.min(limit, 1000));
        noteProviderHealth('binance:klines', true);
      } catch {
        out = await candlesFromBybit(asset, '1d', Math.min(limit, 1000));
        noteProviderHealth('bybit:klines', true);
      }
      if (out.length < 75) throw new DataUnavailableError(asset, 'daily klines (too short)');
      return out;
    }
  });
}

export async function getCandles4h(asset: SupportedAsset, limit = 400): Promise<Candle[] | null> {
  // قد تكون غير متاحة (تعطل مصدر الشموع) — نرجع null بصراحة بدل بيانات مزيفة
  try {
    return await cached(`c4h:${asset}:${limit}`, 120_000, async () => {
      try {
        const rows = await candlesFromOkx(asset, '4h', Math.min(limit, 1000));
        noteProviderHealth('okx:klines', true);
        if (rows.length < 230) throw new Error('4h too short for HTF gate');
        return rows;
      } catch (e) {
        noteProviderHealth('okx:klines', false, e instanceof Error ? e.message : String(e));
        let rows: Candle[];
        try {
          rows = await candlesFromBinance(asset, '4h', Math.min(limit, 1000));
          noteProviderHealth('binance:klines', true);
        } catch {
          rows = await candlesFromBybit(asset, '4h', Math.min(limit, 1000));
          noteProviderHealth('bybit:klines', true);
        }
        if (rows.length < 230) throw new Error('4h too short for HTF gate');
        return rows;
      }
    });
  } catch {
    return null;
  }
}

// جلب تاريخي مُقطّع للباك تست (حتى ~سنة من شموع 1h)
// الترتيب: OKX (مفتوح في السعودية) ← Coinbase (مفتوح) ← Binance (محجوب، يظل خيارًا لغيره)
export async function getHistoricalCandles1h(asset: SupportedAsset, totalLimit: number): Promise<Candle[]> {
  const hist = await cached(`hist:${asset}:${totalLimit}`, 10 * 60_000, async () => {
    // 1) OKX pagination (reachable from SA) — fetch as deep as provider allows.
    try {
      const out = await candlesFromOkx(asset, '1h', Math.min(totalLimit, 3000));
      if (out.length >= 1200) {
        noteProviderHealth('okx:klines', true);
        return out;
      }
      noteProviderHealth('okx:klines', false, `too short (${out.length})`);
    } catch (e) {
      noteProviderHealth('okx:klines', false, e instanceof Error ? e.message : String(e));
    }

    // 2) Binance paginated (best depth, but geo-blocked in some regions incl. SA).
    try {
      const all: Candle[] = [];
      let endTime: number | undefined;
      while (all.length < totalLimit) {
        const url =
          `https://api.binance.com/api/v3/klines?symbol=${SYMBOLS[asset].binance}&interval=1h&limit=1000` +
          (endTime ? `&endTime=${endTime}` : '');
        const rows = await fetchJsonWithTimeout<unknown[][]>(url, 6000);
        const batch = mapBinanceKlines(rows);
        if (batch.length === 0) break;
        all.unshift(...batch);
        endTime = batch[0].time * 1000 - 1;
        if (rows.length < 1000) break;
      }
      if (all.length >= 1200) {
        noteProviderHealth('binance:klines', true);
        return all;
      }
      noteProviderHealth('binance:klines', false, `too short (${all.length})`);
    } catch (e) {
      noteProviderHealth('binance:klines', false, e instanceof Error ? e.message : String(e));
    }

    throw new DataUnavailableError(asset, 'historical klines (need 1200+, all providers failed)');
  });
  return hist.slice(-totalLimit);
}

// ─── تمويل العقود (كل 8 ساعات) — قد لا يتوفر لبعض الأصول ───
export async function getFundingPct8h(asset: SupportedAsset): Promise<number | null> {
  try {
    return await cached(`funding:${asset}`, 5 * 60_000, async () => {
      // OKX first - reachable from restricted regions; PAXG has no swap → Binance only.
      if (hasOkxSwap(asset)) {
        try {
          const d = await fetchJsonWithTimeout<{ code: string; data: Array<{ fundingRate: string }> }>(
            `https://www.okx.com/api/v5/public/funding-rate?instId=${OKX_SWAP[asset]}`,
          );
          const row = Array.isArray(d.data) ? d.data[0] : undefined;
          if (d.code === '0' && row) {
            const rate = parseFloat(row.fundingRate);
            if (Number.isFinite(rate)) {
              noteProviderHealth('okx:funding', true);
              return rate * 100;
            }
          }
        } catch (e) {
          noteProviderHealth('okx:funding', false, e instanceof Error ? e.message : String(e));
        }
      }
      const d = await fetchJsonWithTimeout<{ lastFundingRate: string }>(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${SYMBOLS[asset].binance}`,
      );
      const rate = parseFloat(d.lastFundingRate);
      if (Number.isFinite(rate)) noteProviderHealth('binance:funding', true);
      return Number.isFinite(rate) ? rate * 100 : null;
    });
  } catch (e) {
    noteProviderHealth('binance:funding', false, e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function isDataStale(candles: Candle[], intervalSeconds: number): boolean {
  if (!candles.length) return true;
  const age = Date.now() / 1000 - candles[candles.length - 1].time;
  return age > intervalSeconds * 2.5;
}

/**
 * Deep history for backtests: bulk archives from Binance Vision (months of 1h klines,
 * no rate limits) merged with a live-API tail so the series ends at "now".
 * Falls back to the paginated API when Vision is unavailable.
 */
export async function getHistoricalCandlesDeep(asset: SupportedAsset, totalLimit: number): Promise<Candle[]> {
  const months = Math.ceil(totalLimit / 720) + 1;
  try {
    const vision = await getVisionMonthlyKlines(asset, months);
    if (vision && vision.length >= 1200) {
      const tail = await getCandles1h(asset, 500);
      const tailStart = tail[0].time;
      const head = vision.filter((c) => c.time < tailStart);
      const merged = [...head, ...tail];
      if (merged.length >= 1200) return merged.slice(-totalLimit);
    }
  } catch {
    // fall through to the paginated API
  }
  return getHistoricalCandles1h(asset, totalLimit);
}