// Whale Alert factor - large on-chain transactions from whale-alert.io (free tier, API key required).
// Interpretation: net exchange INFLOW = potential sell pressure; net OUTFLOW = accumulation.
// Without WHALE_ALERT_API_KEY the factor degrades to null (never throws).

export interface WhaleNetflow {
  netInflowUsd: number; // positive = net deposits TO exchanges (sell pressure)
  txCount: number;
}

/** صف معاملة من الـ API — الحقول اختيارية لتغطية صيغتي التوثيق (snake_case وcamelCase). */
interface WhaleTxRow {
  symbol?: string;
  amount_usd?: number;
  amountUsd?: number;
  from?: { owner_type?: string; ownerType?: string };
  to?: { owner_type?: string; ownerType?: string };
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
    let netInflowUsd = 0;
    let txCount = 0;
    let cursor = '';
    // Whale Alert يعرض حتى 100 معاملة للصفحة ويرقم البقية بـ cursor — نجمع حتى 3
    // صفحات عشان الساعة المحمومة أزيد من 100 معاملة ما تتحسبش ناقصة.
    for (let page = 0; page < 3; page++) {
      const url =
        `https://api.whale-alert.io/v1/transactions?api_key=${apiKey}` +
        `&min_value=${WHALE_MIN_VALUE_USD}&start_time=${startTime}&limit=100` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) break;
      // الحقول هنا متسامحة مع صيغتي التوثيق: result/transactions و amount_usd/amountUsd
      // و owner_type/ownerType — النتيجة نفسها مهما كانت الصيغة الفعلية للـ API.
      const body = (await res.json()) as {
        transactions?: WhaleTxRow[];
        result?: WhaleTxRow[];
        cursor?: string;
      };
      const rows = body.transactions ?? body.result ?? [];
      for (const tx of rows) {
        if (String(tx.symbol ?? '').toLowerCase() !== sym) continue;
        const amountUsd = tx.amount_usd ?? tx.amountUsd;
        if (amountUsd === undefined || !Number.isFinite(amountUsd)) continue;
        const toType = tx.to?.owner_type ?? tx.to?.ownerType;
        const fromType = tx.from?.owner_type ?? tx.from?.ownerType;
        const toExchange = toType === 'exchange';
        const fromExchange = fromType === 'exchange';
        if (!toExchange && !fromExchange) continue;
        if (toExchange && fromExchange) continue; // internal exchange shuffle
        txCount++;
        netInflowUsd += toExchange ? amountUsd : -amountUsd;
      }
      if (rows.length < 100) break;
      const next = typeof body.cursor === 'string' ? body.cursor.trim() : '';
      if (!next) break;
      cursor = next;
    }
    value = { netInflowUsd: Math.round(netInflowUsd), txCount };
  } catch {
    value = null;
  }
  WHALE_CACHE.set(asset, { value, at: Date.now() });
  return value;
}