// طبقة السيولة العالمية من DefiLlama — 4 مصادر + كاش ذاكرة/قرص + تدهور رشيق لكل مصدر
// المصدر الرابع: الفائدة المفتوحة (Open Interest) للمشتقات — إشارة مبكرة لشهية الرافعة.
import * as fs from 'fs';
import * as path from 'path';
import type { LiquidityRegime } from '../shared/types';
import { fetchJsonWithTimeout, withTimeoutFallback } from './marketData';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'liquidity.json');
const MEMORY_TTL = 10 * 60_000; // 10 دقايق
const DISK_TTL = 30 * 60_000; // قرص: نستخدم نسخة حتى 30 دقيقة عند الإقلاع البارد

let memCache: { data: LiquidityRegime; at: number } | null = null;

interface Point {
  date?: number;
  timestamp?: number;
  totalLiquidityUsd?: number;
  totalCirculating?: Record<string, number>;
  totalVolume?: number;
}

// سلسلة Open Interest من DefiLlama: إما صفوف [ts, value] أو كائنات { date, totalOpenInterestUsd }.
interface OiSeries { timestamp: number; value: number }

async function fetchSeries(url: string, timeoutMs = 6000): Promise<Point[] | null> {
  try {
    const d = await fetchJsonWithTimeout<Point[] | unknown>(url, timeoutMs);
    return Array.isArray(d) ? (d as Point[]) : null;
  } catch {
    return null;
  }
}

async function fetchOiSeries(url: string, timeoutMs = 7000): Promise<OiSeries[] | null> {
  try {
    const d = await fetchJsonWithTimeout<{ totalDataChart?: unknown }>(url, timeoutMs);
    const rows = d?.totalDataChart;
    if (!Array.isArray(rows)) return null;
    const out: OiSeries[] = [];
    for (const r of rows) {
      let ts = 0;
      let value = 0;
      if (Array.isArray(r)) {
        ts = Number(r[0]) * 1000;
        value = Number(r[1]);
      } else if (r && typeof r === 'object') {
        const o = r as { date?: number | string; timestamp?: number | string; totalOpenInterestUsd?: number };
        const rawTs = o.date ?? o.timestamp;
        if (rawTs !== undefined) {
          const n = Number(rawTs);
          ts = String(rawTs).length <= 10 ? n * 1000 : n;
        }
        value = Number(o.totalOpenInterestUsd ?? 0);
      }
      if (ts > 0 && Number.isFinite(value)) out.push({ timestamp: ts, value });
    }
    return out.length ? out.sort((a, b) => a.timestamp - b.timestamp) : null;
  } catch {
    return null;
  }
}

function valueAt(p: Point, kind: 'tvl' | 'stables' | 'dex'): number | null {
  if (kind === 'tvl') return p.totalLiquidityUsd ?? null;
  if (kind === 'stables') {
    if (!p.totalCirculating) return null;
    const vals = Object.values(p.totalCirculating);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  return p.totalVolume ?? null;
}

function change7d(series: Point[] | null, kind: 'tvl' | 'stables' | 'dex'): number | null {
  if (!series || series.length < 9) return null;
  const now = series[series.length - 1];
  const past = series[series.length - 2 - 7];
  const vNow = valueAt(now, kind);
  const vPast = valueAt(past, kind);
  if (vNow === null || vPast === null || !vPast) return null;
  return Number((((vNow - vPast) / vPast) * 100).toFixed(2));
}

function changeOi7d(series: OiSeries[] | null): number | null {
  if (!series || series.length < 9) return null;
  const now = series[series.length - 1];
  const past = series[series.length - 2 - 7];
  if (!past.value) return null;
  return Number((((now.value - past.value) / past.value) * 100).toFixed(2));
}

/** تجميع نقي قابل للاختبار — كل التعديلات محدودة ومعمولة بشفافية */
export function aggregateLiquidity(
  tvl7d: number | null,
  stables7d: number | null,
  dex7d: number | null,
  oi7d: number | null = null,
  now = Date.now(),
): LiquidityRegime {
  const components: LiquidityRegime['components'] = [];
  let total = 0;
  let ok = 0;

  const adjTvl = tvl7d === null ? 0 : tvl7d > 2 ? 4 : tvl7d > 0.5 ? 2 : tvl7d > -2 ? 0 : tvl7d > -5 ? -2 : -4;
  if (tvl7d !== null) ok++;
  components.push({
    nameAr: 'إجمالي القيمة المقفلة (TVL)',
    nameEn: 'Total value locked (TVL)',
    change7dPercent: tvl7d,
    adjustment: tvl7d === null ? 0 : adjTvl,
  });
  total += tvl7d === null ? 0 : adjTvl;

  const adjSt = stables7d === null ? 0 : stables7d > 0.5 ? 2 : stables7d < -1 ? -2 : 0;
  if (stables7d !== null) ok++;
  components.push({
    nameAr: 'العملات المستقرة',
    nameEn: 'Stablecoins',
    change7dPercent: stables7d,
    adjustment: stables7d === null ? 0 : adjSt,
  });
  total += stables7d === null ? 0 : adjSt;

  const adjDex = dex7d === null ? 0 : dex7d > 10 ? 2 : dex7d < -20 ? -2 : 0;
  if (dex7d !== null) ok++;
  components.push({
    nameAr: 'حجم تداول DEX',
    nameEn: 'DEX volume',
    change7dPercent: dex7d,
    adjustment: dex7d === null ? 0 : adjDex,
  });
  total += dex7d === null ? 0 : adjDex;

  const adjOi = oi7d === null ? 0 : oi7d > 15 ? 2 : oi7d < -10 ? -2 : 0;
  if (oi7d !== null) ok++;
  components.push({
    nameAr: 'الفائدة المفتوحة (مشتقات)',
    nameEn: 'Open interest (derivatives)',
    change7dPercent: oi7d,
    adjustment: oi7d === null ? 0 : adjOi,
  });
  total += oi7d === null ? 0 : adjOi;

  total = Math.max(-8, Math.min(8, total));
  const verdict: LiquidityRegime['verdict'] = total >= 4 ? 'RISK_ON' : total <= -4 ? 'RISK_OFF' : 'NEUTRAL';

  const parts: string[] = [];
  if (tvl7d !== null) parts.push(`TVL ${tvl7d > 0 ? '+' : ''}${tvl7d}% خلال أسبوع`);
  if (stables7d !== null) parts.push(`العملات المستقرة ${stables7d > 0 ? '+' : ''}${stables7d}%`);
  if (dex7d !== null) parts.push(`حجم DEX ${dex7d > 0 ? '+' : ''}${dex7d}%`);
  if (oi7d !== null) parts.push(`الفائدة المفتوحة ${oi7d > 0 ? '+' : ''}${oi7d}%`);
  const summaryAr =
    ok === 0
      ? 'طبقة السيولة غير متاحة حالياً من DefiLlama — التعديل صفر بصراحة'
      : `${verdict === 'RISK_ON' ? 'سيولة عالمية في تحسن' : verdict === 'RISK_OFF' ? 'سيولة عالمية في انحسار' : 'سيولة عالمية محايدة'} (${parts.join('، ')})`;

  const enParts: string[] = [];
  if (tvl7d !== null) enParts.push(`TVL ${tvl7d > 0 ? '+' : ''}${tvl7d}% weekly`);
  if (stables7d !== null) enParts.push(`stablecoins ${stables7d > 0 ? '+' : ''}${stables7d}%`);
  if (dex7d !== null) enParts.push(`DEX volume ${dex7d > 0 ? '+' : ''}${dex7d}%`);
  if (oi7d !== null) enParts.push(`open interest ${oi7d > 0 ? '+' : ''}${oi7d}%`);
  const summaryEn =
    ok === 0
      ? 'Global liquidity unavailable from DefiLlama right now — zero adjustment, honestly'
      : `${verdict === 'RISK_ON' ? 'Global liquidity improving' : verdict === 'RISK_OFF' ? 'Global liquidity draining' : 'Global liquidity neutral'} (${enParts.join(', ')})`;

  return {
    totalAdjustment: total,
    verdict,
    summaryAr,
    summaryEn,
    components,
    updatedAt: now,
    sourcesOk: ok,
    sourcesTotal: 4,
  };
}

function readDisk(): LiquidityRegime | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as { data: LiquidityRegime; at: number };
    if (Date.now() - raw.at > DISK_TTL) return null;
    return raw.data;
  } catch {
    return null;
  }
}

function writeDisk(data: LiquidityRegime): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ data, at: Date.now() }, null, 2), 'utf-8');
  } catch {
    // الكتابة اختيارية
  }
}

export async function getLiquidityRegime(): Promise<LiquidityRegime> {
  if (memCache && Date.now() - memCache.at < MEMORY_TTL) return memCache.data;

  // Hard guards: a broken DNS host must degrade to null, never hang the scan or the API.
  const [tvlSeries, stablesSeries, dexOverview, oiSeries] = await Promise.all([
    withTimeoutFallback(fetchSeries('https://api.llama.fi/v2/historicalChainTvl'), 8000, null),
    withTimeoutFallback(fetchSeries('https://stablecoins.llama.fi/stablecoincharts/all'), 8000, null),
    withTimeoutFallback(
      fetchJsonWithTimeout<{ totalDataChart?: Point[] }>(
        'https://api.llama.fi/overview/dexs?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true&dataType=dailyVolume',
        7000,
      ).catch(() => null),
      9000,
      null,
    ),
    withTimeoutFallback(fetchOiSeries('https://api.llama.fi/overview/open-interest', 7000), 9000, null),
  ]);

  const regime = aggregateLiquidity(
    change7d(tvlSeries, 'tvl'),
    change7d(stablesSeries, 'stables'),
    change7d((dexOverview && dexOverview.totalDataChart) || null, 'dex'),
    changeOi7d(oiSeries),
  );

  memCache = { data: regime, at: Date.now() };
  writeDisk(regime);
  return regime;
}

/** عند الإقلاع البارد: نبدأ من نسخة القرص لو متاحة (ومن غيرها نرجّع صفر محايد) */
export function bootstrapLiquidityCache(): void {
  const disk = readDisk();
  if (disk) memCache = { data: disk, at: Date.now() - (MEMORY_TTL - 60_000) };
}
