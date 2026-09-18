// ─── طبقة ccxt — شبكة أمان أخيرة للبيانات ───
// مكتبة ccxt (43k★، MIT) توحد +100 بورصة. هنا نستخدمها كطبقة مظلة:
// تُستدعى فقط عندما تفشل المصادر المباشرة (OKX/Coinbase/Binance/Coingecko/Bybit)
// كلها — حتى يبقى المسار السريع المعتاد كما هو في marketData.ts.
// نتجنب استيراد ccxt في المسار الساخن: الاستيراد مؤجل (dynamic import) ليبقى
// تشغيل السياق الأول خفيفاً ولا يُحمَّل ما لا يُستخدم.
import type { SupportedAsset, Candle } from '../shared/types';
import { noteProviderHealth } from './marketData';

// بورصات ccxt التي نُجربها بالتسلسل (بعيداً عن المحجوبة جغرافياً، يفتح حسب المتاح).
const CCXT_EXCHANGES = ['kucoin', 'gate', 'mexc', 'okx', 'binance', 'htx', 'bitget'] as const;
type CcxtExchangeId = (typeof CCXT_EXCHANGES)[number];

interface CcxtModule {
  version: string;
  [id: string]: unknown;
}

let ccxtPromise: Promise<CcxtModule> | null = null;

/** تحميل مؤجل لمكتبة ccxt — cache العملية الواحدة. */
function loadCcxt(): Promise<CcxtModule> {
  if (!ccxtPromise) {
    ccxtPromise = import('ccxt').then((m) => m as unknown as CcxtModule).catch((e) => {
      ccxtPromise = null; // السماح بمحاولة لاحقة بعد فشل عابر
      throw e;
    });
  }
  return ccxtPromise;
}

interface CcxtTicker {
  last?: number;
  percentage?: number;
  high?: number;
  low?: number;
  baseVolume?: number;
  quoteVolume?: number;
}

interface CcxtExchangeLike {
  fetchTicker: (symbol: string) => Promise<CcxtTicker>;
  fetchOHLCV: (symbol: string, timeframe: string, since?: number, limit?: number) => Promise<unknown[][]>;
}

function makeExchange(mod: CcxtModule, id: CcxtExchangeId, timeoutMs: number): CcxtExchangeLike | null {
  const Ctor = mod[id];
  if (typeof Ctor !== 'function') return null;
  try {
    return new (Ctor as new (cfg: { timeout: number; enableRateLimit: boolean }) => CcxtExchangeLike)({
      timeout: timeoutMs,
      enableRateLimit: true,
    });
  } catch {
    return null;
  }
}

const INTERVAL_CCXT: Record<'1h' | '4h' | '1d', string> = { '1h': '1h', '4h': '4h', '1d': '1d' };

function mapCcxtOhlcv(rows: unknown[][]): Candle[] {
  return rows
    .map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.close > 0 && c.time > 0)
    .sort((a, b) => a.time - b.time);
}

/** تيكر عبر ccxt — أول بورصة ترد بنجاح. */
export async function tickerFromCcxt(asset: SupportedAsset, timeoutMs = 7000): Promise<{
  asset: SupportedAsset;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  source: string;
}> {
  const mod = await loadCcxt();
  const pair = SYMBOL_BY_ID[asset];
  let lastErr: unknown = null;
  for (const id of CCXT_EXCHANGES) {
    const ex = makeExchange(mod, id, timeoutMs);
    if (!ex) continue;
    try {
      const t = await ex.fetchTicker(pair);
      const price = Number(t?.last);
      if (!Number.isFinite(price) || price <= 0) throw new Error(`${id} bad price`);
      noteProviderHealth(`ccxt:${id}:ticker`, true);
      return {
        asset,
        price,
        change24h: Number.isFinite(t?.percentage as number) ? Number(((t.percentage as number)).toFixed(2)) : 0,
        high24h: Number(t?.high) || price,
        low24h: Number(t?.low) || price,
        volume24h: Number(t?.quoteVolume ?? t?.baseVolume) || 0,
        source: `ccxt:${id}`,
      };
    } catch (e) {
      lastErr = e;
      noteProviderHealth(`ccxt:${id}:ticker`, false, e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`ccxt ticker failed: ${String((lastErr as Error)?.message || lastErr)}`);
}

/** شموع عبر ccxt — أول بورصة ترد بعدد كافٍ. */
export async function candlesFromCcxt(
  asset: SupportedAsset,
  interval: '1h' | '4h' | '1d',
  limit: number,
  timeoutMs = 8000,
): Promise<Candle[]> {
  const mod = await loadCcxt();
  const pair = SYMBOL_BY_ID[asset];
  const tf = INTERVAL_CCXT[interval];
  let lastErr: unknown = null;
  for (const id of CCXT_EXCHANGES) {
    const ex = makeExchange(mod, id, timeoutMs);
    if (!ex) continue;
    try {
      const rows = await ex.fetchOHLCV(pair, tf, undefined, Math.min(limit, 1000));
      const out = mapCcxtOhlcv(rows);
      if (out.length < 50) throw new Error(`${id} candles too short (${out.length})`);
      noteProviderHealth(`ccxt:${id}:klines`, true);
      return out.slice(-limit);
    } catch (e) {
      lastErr = e;
      noteProviderHealth(`ccxt:${id}:klines`, false, e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`ccxt candles failed: ${String((lastErr as Error)?.message || lastErr)}`);
}

// نسخة محلية من خريطة الرموز لتجنب تصدير SYMBOLS من marketData (يبقى الاقتران فضفاضاً).
const SYMBOL_BY_ID: Record<SupportedAsset, string> = {
  BTC: 'BTC/USDT',
  ETH: 'ETH/USDT',
  PAXG: 'PAXG/USDT',
  SOL: 'SOL/USDT',
};
