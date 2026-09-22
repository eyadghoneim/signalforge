import type { OrderBookDepth, OrderBookTier, OrderBookWall, SupportedAsset } from '../shared/types';
import { getTicker } from './marketData';

const SYMBOL_MAP: Record<SupportedAsset, { binance: string; coinbase: string; fallbackPrice: number }> = {
  BTC: { binance: 'BTCUSDT', coinbase: 'BTC-USD', fallbackPrice: 88000 },
  ETH: { binance: 'ETHUSDT', coinbase: 'ETH-USD', fallbackPrice: 3200 },
  SOL: { binance: 'SOLUSDT', coinbase: 'SOL-USD', fallbackPrice: 180 },
  PAXG: { binance: 'PAXGUSDT', coinbase: 'PAXG-USD', fallbackPrice: 2650 },
};

async function fetchWithTimeout(url: string, ms = 3000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'signalforge-terminal/3.1' },
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Generates deterministic fallback order book if live exchange APIs fail or are rate-limited.
 */
function generateFallbackDepth(asset: SupportedAsset, midPrice: number): OrderBookDepth {
  const bids: OrderBookTier[] = [];
  const asks: OrderBookTier[] = [];
  let cumBid = 0;
  let cumAsk = 0;

  for (let i = 1; i <= 15; i++) {
    const bidStep = midPrice * (1 - i * 0.0015);
    const askStep = midPrice * (1 + i * 0.0015);
    // Exponentially larger volume at key round levels (simulating whale walls)
    const isWall = i === 5 || i === 10;
    const bidAmt = Number(((isWall ? 8.5 : 1.8) * (1 + (i % 3) * 0.4)).toFixed(3));
    const askAmt = Number(((isWall ? 7.2 : 1.6) * (1 + (i % 2) * 0.5)).toFixed(3));

    cumBid += bidAmt;
    cumAsk += askAmt;

    bids.push({ price: Number(bidStep.toFixed(2)), amount: bidAmt, total: Number(cumBid.toFixed(3)) });
    asks.push({ price: Number(askStep.toFixed(2)), amount: askAmt, total: Number(cumAsk.toFixed(3)) });
  }

  const totalBidVol = cumBid;
  const totalAskVol = cumAsk;
  const total = totalBidVol + totalAskVol || 1;
  const buyerPct = Math.round((totalBidVol / total) * 100);
  const sellerPct = 100 - buyerPct;
  const imbalance = Math.round(((totalBidVol - totalAskVol) / total) * 100);

  const bestBid = bids[0]?.price || midPrice * 0.999;
  const bestAsk = asks[0]?.price || midPrice * 1.001;
  const spread = Number((bestAsk - bestBid).toFixed(2));
  const spreadPct = Number(((spread / midPrice) * 100).toFixed(4));

  return {
    asset,
    source: 'Synthetic Liquidity Model (Deterministic Fallback)',
    isSimulated: true,
    bids,
    asks,
    spread,
    spreadPercent: spreadPct,
    midPrice,
    imbalancePercent: imbalance,
    buyerPercentage: buyerPct,
    sellerPercentage: sellerPct,
    bidWall: { price: bids[4].price, amount: bids[4].amount, distancePercent: 0.75 },
    askWall: { price: asks[4].price, amount: asks[4].amount, distancePercent: 0.75 },
    rule3Passed: spreadPct < 0.15,
    lastUpdated: Date.now(),
  };
}

function parseL2Depth(
  asset: SupportedAsset,
  rawBids: Array<[string, string] | string[]>,
  rawAsks: Array<[string, string] | string[]>,
  source: string,
): OrderBookDepth | null {
  if (!rawBids.length || !rawAsks.length) return null;
  const bids: OrderBookTier[] = [];
  const asks: OrderBookTier[] = [];
  let cumBid = 0;
  let cumAsk = 0;

  for (const [p, a] of rawBids.slice(0, 15)) {
    const price = parseFloat(p);
    const amount = parseFloat(a);
    if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
    cumBid += amount;
    bids.push({
      price: Number(price.toFixed(2)),
      amount: Number(amount.toFixed(4)),
      total: Number(cumBid.toFixed(4)),
    });
  }

  for (const [p, a] of rawAsks.slice(0, 15)) {
    const price = parseFloat(p);
    const amount = parseFloat(a);
    if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
    cumAsk += amount;
    asks.push({
      price: Number(price.toFixed(2)),
      amount: Number(amount.toFixed(4)),
      total: Number(cumAsk.toFixed(4)),
    });
  }

  if (!bids.length || !asks.length) return null;

  const bestBid = bids[0]?.price || 0;
  const bestAsk = asks[0]?.price || 0;
  const midPrice = Number(((bestBid + bestAsk) / 2).toFixed(2));
  const spread = Number((bestAsk - bestBid).toFixed(2));
  const spreadPct = midPrice > 0 ? Number(((spread / midPrice) * 100).toFixed(4)) : 0;

  const totalBidVol = cumBid;
  const totalAskVol = cumAsk;
  const total = totalBidVol + totalAskVol || 1;
  const buyerPct = Math.round((totalBidVol / total) * 100);
  const sellerPct = 100 - buyerPct;
  const imbalance = Math.round(((totalBidVol - totalAskVol) / total) * 100);

  let maxBid = bids[0];
  for (const b of bids) {
    if (b.amount > (maxBid?.amount || 0)) maxBid = b;
  }

  let maxAsk = asks[0];
  for (const a of asks) {
    if (a.amount > (maxAsk?.amount || 0)) maxAsk = a;
  }

  const bidWall: OrderBookWall | null = maxBid
    ? {
        price: maxBid.price,
        amount: maxBid.amount,
        distancePercent: Number((((midPrice - maxBid.price) / midPrice) * 100).toFixed(2)),
      }
    : null;

  const askWall: OrderBookWall | null = maxAsk
    ? {
        price: maxAsk.price,
        amount: maxAsk.amount,
        distancePercent: Number((((maxAsk.price - midPrice) / midPrice) * 100).toFixed(2)),
      }
    : null;

  return {
    asset,
    source,
    isSimulated: false,
    bids,
    asks,
    spread,
    spreadPercent: spreadPct,
    midPrice,
    imbalancePercent: imbalance,
    buyerPercentage: buyerPct,
    sellerPercentage: sellerPct,
    bidWall,
    askWall,
    rule3Passed: spreadPct < 0.15,
    lastUpdated: Date.now(),
  };
}

export async function getOrderBookDepth(asset: SupportedAsset): Promise<OrderBookDepth> {
  const conf = SYMBOL_MAP[asset] || SYMBOL_MAP.BTC;

  // 1. Try Binance Live Order Book Depth
  try {
    const res = await fetchWithTimeout(
      `https://api.binance.com/api/v3/depth?symbol=${conf.binance}&limit=40`,
      3500,
    );
    if (res.ok) {
      const data = (await res.json()) as { bids?: [string, string][]; asks?: [string, string][] };
      const parsed = parseL2Depth(asset, data.bids || [], data.asks || [], 'Binance L2 Depth API');
      if (parsed) return parsed;
    }
  } catch {
    // Proceed to next fallback
  }

  // 2. Try OKX Live Order Book Depth (reachable in geo-restricted regions like SA)
  try {
    const okxInst = `${asset}-USDT`;
    const res = await fetchWithTimeout(
      `https://www.okx.com/api/v5/market/books?instId=${okxInst}&sz=20`,
      3500,
    );
    if (res.ok) {
      const data = (await res.json()) as { code?: string; data?: Array<{ bids?: [string, string, string, string][]; asks?: [string, string, string, string][] }> };
      if (data.code === '0' && data.data?.[0]) {
        const parsed = parseL2Depth(asset, data.data[0].bids || [], data.data[0].asks || [], 'OKX L2 Depth API');
        if (parsed) return parsed;
      }
    }
  } catch {
    // Proceed to fallback
  }

  // 3. Fallback to latest ticker price with synthetic L2 depth
  let price = conf.fallbackPrice;
  try {
    const ticker = await getTicker(asset);
    if (ticker?.price && ticker.price > 0) {
      price = ticker.price;
    }
  } catch {
    // Keep fallback price
  }

  return generateFallbackDepth(asset, price);
}
