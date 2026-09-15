// طبقة السيولة العالمية من DefiLlama — 3 مصادر + كاش ذاكرة/قرص + تدهور رشيق لكل مصدر
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

async function fetchSeries(url: string, timeoutMs = 6000): Promise<Point[] | null> {
  try {
    const d = await fetchJsonWithTimeout<Point[] | unknown>(url, timeoutMs);
    return Array.isArray(d) ? (d as Point[]) : null;
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

/** تجميع نقي قابل للاختبار — كل التعديلات محدودة ومعمولة بشفافية */
export function aggregateLiquidity(
  tvl7d: number | null,
  stables7d: number | null,
  dex7d: number | null,
  now = Date.now(),
): LiquidityRegime {
  const components: LiquidityRegime['components'] = [];
  let total = 0;
  let ok = 0;

  const adjTvl = tvl7d === null ? 0 : tvl7d > 2 ? 4 : tvl7d > 0.5 ? 2 : tvl7d > -2 ? 0 : tvl7d > -5 ? -2 : -4;
  if (tvl7d !== null) ok++;
  components.push({
    nameAr: 'إجمالي القيمة المقفلة (TVL)',
    change7dPercent: tvl7d,
    adjustment: tvl7d === null ? 0 : adjTvl,
  });
  total += tvl7d === null ? 0 : adjTvl;

  const adjSt = stables7d === null ? 0 : stables7d > 0.5 ? 2 : stables7d < -1 ? -2 : 0;
  if (stables7d !== null) ok++;
  components.push({
    nameAr: 'العملات المستقرة',
    change7dPercent: stables7d,
    adjustment: stables7d === null ? 0 : adjSt,
  });
  total += stables7d === null ? 0 : adjSt;

  const adjDex = dex7d === null ? 0 : dex7d > 10 ? 2 : dex7d < -20 ? -2 : 0;
  if (dex7d !== null) ok++;
  components.push({
    nameAr: 'حجم تداول DEX',
    change7dPercent: dex7d,
    adjustment: dex7d === null ? 0 : adjDex,
  });
  total += dex7d === null ? 0 : adjDex;

  total = Math.max(-8, Math.min(8, total));
  const verdict: LiquidityRegime['verdict'] = total >= 4 ? 'RISK_ON' : total <= -4 ? 'RISK_OFF' : 'NEUTRAL';

  const parts: string[] = [];
  if (tvl7d !== null) parts.push(`TVL ${tvl7d > 0 ? '+' : ''}${tvl7d}% خلال أسبوع`);
  if (stables7d !== null) parts.push(`العملات المستقرة ${stables7d > 0 ? '+' : ''}${stables7d}%`);
  if (dex7d !== null) parts.push(`حجم DEX ${dex7d > 0 ? '+' : ''}${dex7d}%`);
  const summaryAr =
    ok === 0
      ? 'طبقة السيولة غير متاحة حالياً من DefiLlama — التعديل صفر بصراحة'
      : `${verdict === 'RISK_ON' ? 'سيولة عالمية في تحسن' : verdict === 'RISK_OFF' ? 'سيولة عالمية في انحسار' : 'سيولة عالمية محايدة'} (${parts.join('، ')})`;

  return {
    totalAdjustment: total,
    verdict,
    summaryAr,
    components,
    updatedAt: now,
    sourcesOk: ok,
    sourcesTotal: 3,
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
  const [tvlSeries, stablesSeries, dexOverview] = await Promise.all([
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
  ]);

  const regime = aggregateLiquidity(
    change7d(tvlSeries, 'tvl'),
    change7d(stablesSeries, 'stables'),
    change7d((dexOverview && dexOverview.totalDataChart) || null, 'dex'),
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
