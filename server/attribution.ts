// عدّاد الأداء: يتابع كل إشارة محفوظة — MFE/MAE ومن ضرب أولاً TP1 أم SL
import type { Candle, StoredSignal, AttributionWindow, AttributionSummary, TagStat } from '../shared/types';
import { ATTRIBUTION_WINDOWS_HOURS } from '../shared/strategyConstants';
import { updateSignalOutcomes } from './persistence';

const WINDOW_HOURS: Record<AttributionWindow, number> = { h4: 4, h24: 24, h72: 72 };

interface CandleProvider {
  (asset: StoredSignal['asset'], interval: '1h', limit: number): Promise<Candle[]>;
}

/**
 * يحدّث نتائج كل إشارة مفتوحة من شموع 1h الحقيقية.
 * يُرجع عدد الإشارات التي تغيّرت نتائجها.
 */
export async function updateOutcomes(signals: StoredSignal[], getCandles: CandleProvider): Promise<number> {
  let changed = 0;
  const candlesCache = new Map<string, Candle[]>();

  for (const sig of signals) {
    if (sig.outcomes && sig.outcomes.resolution !== 'OPEN') continue;
    if (!sig.outcomes) continue;
    const ageHours = (Date.now() - sig.generatedAt) / 3_600_000;
    if (ageHours > ATTRIBUTION_WINDOWS_HOURS[ATTRIBUTION_WINDOWS_HOURS.length - 1] + 2) {
      // انتهت النافذة القصوى دون حسم — نحسمها EXPIRED بعد قراءة الشموع الأخيرة
      try {
        const candles = await ensureCandles(candlesCache, sig, getCandles);
        const computed = computeWindows(sig, candles);
        if (computed) {
          const h72 = computed.windows.h72;
          const resolution = h72.hitTp1BeforeSl === true ? 'TP1_FIRST' : h72.hitTp1BeforeSl === false ? 'SL_FIRST' : 'EXPIRED';
          sig.outcomes = { windows: computed.windows, resolution, resolvedAt: Date.now() };
          updateSignalOutcomes(sig.id, sig.outcomes);
          changed++;
        }
      } catch {
        // تعذر جلب البيانات — نتركها مفتوحة للمحاولة لاحقاً
      }
      continue;
    }

    try {
      const candles = await ensureCandles(candlesCache, sig, getCandles);
      const computed = computeWindows(sig, candles);
      if (!computed) continue;
      const h72 = computed.windows.h72;
      const resolution: StoredSignal['outcomes']['resolution'] =
        h72.hitTp1BeforeSl === true ? 'TP1_FIRST' : h72.hitTp1BeforeSl === false ? 'SL_FIRST' : 'OPEN';
      const resolvedAt = resolution !== 'OPEN' ? Date.now() : undefined;
      sig.outcomes = resolvedAt ? { windows: computed.windows, resolution, resolvedAt } : { windows: computed.windows, resolution };
      updateSignalOutcomes(sig.id, sig.outcomes);
      changed++;
    } catch {
      // تجاهل — المحاولة القادمة
    }
  }
  return changed;
}

async function ensureCandles(
  cache: Map<string, Candle[]>,
  sig: StoredSignal,
  getCandles: CandleProvider,
): Promise<Candle[]> {
  const key = sig.asset;
  if (!cache.has(key)) {
    // نحتاج شموعاً تغطي آخر 72+ ساعة بعد لحظة الإشارة
    cache.set(key, await getCandles(sig.asset, '1h', 120));
  }
  return cache.get(key) as Candle[];
}

function computeWindows(
  sig: StoredSignal,
  candles: Candle[],
): { windows: StoredSignal['outcomes']['windows'] } | null {
  const genSec = Math.floor(sig.generatedAt / 1000);
  const after = candles.filter((c) => c.time >= genSec);
  if (after.length === 0) return null;
  const entry = sig.entryPrice;
  if (!Number.isFinite(entry) || entry <= 0) return null;

  const windows = {} as StoredSignal['outcomes']['windows'];
  (Object.keys(WINDOW_HOURS) as AttributionWindow[]).forEach((w) => {
    const windowSeconds = WINDOW_HOURS[w] * 3600;
    const slice = after.filter((c) => c.time < genSec + windowSeconds);
    if (slice.length === 0) {
      windows[w] = { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null };
      return;
    }
    let mfe = -Infinity;
    let mae = Infinity;
    let hitTp1BeforeSl: boolean | null = null;
    for (const c of slice) {
      mfe = Math.max(mfe, ((c.high - entry) / entry) * 100);
      mae = Math.min(mae, ((c.low - entry) / entry) * 100);
      if (hitTp1BeforeSl === null) {
        const slHit = c.low <= sig.stopLoss;
        const tpHit = c.high >= sig.target1;
        if (slHit && tpHit) hitTp1BeforeSl = null; // غامض داخل نفس الشمعة — نحسمه في نافذة أوسع
        else if (slHit) hitTp1BeforeSl = false;
        else if (tpHit) hitTp1BeforeSl = true;
      }
    }
    windows[w] = {
      mfePercent: Number(mfe.toFixed(2)),
      maePercent: Number(mae.toFixed(2)),
      hitTp1BeforeSl,
    };
  });
  return { windows };
}

// ─── ملخص الأداء لكل عامل (الأنواع معرّفة في shared/types وتُصدَّر من هنا) ───
export type { AttributionSummary, TagStat } from '../shared/types';

export function computeAttributionSummary(signals: StoredSignal[]): AttributionSummary {
  const actionable = signals.filter((s) => !s.isGateBlocked);
  const resolvedSignals = actionable.filter((s) => s.outcomes?.resolution === 'TP1_FIRST' || s.outcomes?.resolution === 'SL_FIRST');
  const tp1First = resolvedSignals.filter((s) => s.outcomes.resolution === 'TP1_FIRST').length;
  const slFirst = resolvedSignals.filter((s) => s.outcomes.resolution === 'SL_FIRST').length;
  const expired = actionable.filter((s) => s.outcomes?.resolution === 'EXPIRED').length;

  const withH72 = actionable.filter((s) => s.outcomes?.windows?.h72);
  const avgMfe = withH72.length
    ? Number((withH72.reduce((a, s) => a + s.outcomes.windows.h72.mfePercent, 0) / withH72.length).toFixed(2))
    : null;
  const avgMae = withH72.length
    ? Number((withH72.reduce((a, s) => a + s.outcomes.windows.h72.maePercent, 0) / withH72.length).toFixed(2))
    : null;

  const tagMap = new Map<string, { wins: number; losses: number }>();
  for (const s of resolvedSignals) {
    const win = s.outcomes.resolution === 'TP1_FIRST';
    const tags = new Set(s.reasons.map((r) => r.tag));
    for (const tag of tags) {
      const cur = tagMap.get(tag) || { wins: 0, losses: 0 };
      if (win) cur.wins++;
      else cur.losses++;
      tagMap.set(tag, cur);
    }
  }
  const perTag: TagStat[] = [...tagMap.entries()]
    .map(([tag, v]) => ({
      tag,
      wins: v.wins,
      losses: v.losses,
      total: v.wins + v.losses,
      winRatePercent: v.wins + v.losses > 0 ? Number(((v.wins / (v.wins + v.losses)) * 100).toFixed(1)) : null,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    actionableSignals: actionable.length,
    resolved: resolvedSignals.length,
    tp1First,
    slFirst,
    expired,
    winRatePercent: tp1First + slFirst > 0 ? Number(((tp1First / (tp1First + slFirst)) * 100).toFixed(1)) : null,
    avgMfePercent: avgMfe,
    avgMaePercent: avgMae,
    perTag,
    noteAr:
      resolvedSignals.length < 20
        ? 'البيانات لسه بتتجمع — التحليل الإحصائي يوثق بعد 20+ إشارة محسومة'
        : 'قِس كل عامل: نسبة النجاح لما كان العامل حاضراً في الإشارة',
  };
}
