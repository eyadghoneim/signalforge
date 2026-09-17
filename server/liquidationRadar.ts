// رادار التصفية — بيانات تصفية العقود الحقيقية من OKX (مفتوح في السعودية).
// المفروض يبقى "خريطة التصفية" اللي عند العملات — بس بصحة كاملة: دي آخر
// عمليات التصفية المملوءة من مصدرها مباشرة، بدون أي أرقام محسوبة بالكود.
// ملاحظة أمانة: OKX بيعرض آخر أحداث التصفية المعلنة، مش إجمالي السوق الكامل —
// الواجهة بتوضح ده صراحة.
import type { SupportedAsset } from '../shared/types';
import { OKX_SWAP, hasOkxSwap } from './symbols';
import { noteProviderHealth } from './marketData';

export interface LiquidationEvent {
  time: number; // epoch ms
  posSide: 'long' | 'short';
  side: 'buy' | 'sell';
  price: number;
  sizeUsd: number; // حجم التصفية بالدولار تقريباً
}

export interface LiquidationRadar {
  asset: SupportedAsset;
  longCount: number;
  shortCount: number;
  longSizeUsd: number;
  shortSizeUsd: number;
  /** موجب = تطهير مراكز شراء (ضغط بيعي) — سالب = تطهير مراكز بيع (ضغط شرائي) */
  tilt: number; // -1..1 — اتجاه التصفية الخالص
  events: LiquidationEvent[];
  source: string;
  noteAr: string;
}

const CACHE = new Map<string, { value: LiquidationRadar | null; at: number }>();
const TTL_MS = 2 * 60_000; // تصفيات بتتحدث بسرعة — كاش دقيقتين

export async function getLiquidationRadar(asset: SupportedAsset): Promise<LiquidationRadar | null> {
  if (!hasOkxSwap(asset)) return null; // PAXG مالوش عقود دائمة — غياب صادق
  const cached = CACHE.get(asset);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  let value: LiquidationRadar | null = null;
  try {
    const instId = OKX_SWAP[asset];
    const uly = instId.replace('-SWAP', '');
    const url = `https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instId=${instId}&uly=${uly}&state=filled&limit=20`;
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { code: string; data?: any[] };
    if (json.code !== '0' || !Array.isArray(json.data)) throw new Error(`okx code ${json.code}`);

    const events: LiquidationEvent[] = [];
    let longCount = 0;
    let shortCount = 0;
    let longSizeUsd = 0;
    let shortSizeUsd = 0;

    for (const block of json.data) {
      const details = Array.isArray(block?.details) ? block.details : [];
      for (const d of details) {
        const posSide = d?.posSide === 'long' ? 'long' : 'short';
        const price = Number(d?.bkPx) || 0;
        const size = Number(d?.sz) || 0; // بالعملة — نقربها للدولار بالسعر
        const sizeUsd = price > 0 && size > 0 ? Math.round(size * price) : 0;
        if (size <= 0) continue;
        events.push({
          time: Number(d?.time) || 0,
          posSide,
          side: d?.side === 'buy' ? 'buy' : 'sell',
          price,
          sizeUsd,
        });
        if (posSide === 'long') {
          longCount++;
          longSizeUsd += sizeUsd;
        } else {
          shortCount++;
          shortSizeUsd += sizeUsd;
        }
      }
    }

    if (events.length === 0) throw new Error('no liquidation events');
    const total = longSizeUsd + shortSizeUsd;
    const tilt = total > 0 ? Number((((longSizeUsd - shortSizeUsd) / total)).toFixed(2)) : 0;

    value = {
      asset,
      longCount,
      shortCount,
      longSizeUsd,
      shortSizeUsd,
      tilt,
      events: events.sort((a, b) => b.time - a.time).slice(0, 12),
      source: 'OKX Liquidation Orders (live)',
      noteAr:
        'آخر عمليات التصفية المعلنة من OKX — ليست إجمالي السوق. قراءتك الشائعة: كتلة تصفية مراكز شراء (longs) المائلة للأحمر تعني ضغط بيعي مضاعف محتمل.',
    };
    noteProviderHealth('okx:liquidations', true);
  } catch (e) {
    noteProviderHealth('okx:liquidations', false, e instanceof Error ? e.message : String(e));
    value = null;
  }
  CACHE.set(asset, { value, at: Date.now() });
  return value;
}
