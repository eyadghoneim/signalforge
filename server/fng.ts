// Fear & Greed Index factor - alternative.me public API, no key required.
// Contrarian interpretation: extreme fear = opportunity, extreme greed = caution.
// Comments are English-only on purpose (codepage safety under shell tooling).

import type { FngPoint } from '../shared/types';

const FNG_CACHE = new Map<string, { value: FngPoint | null; at: number }>();
const FNG_TTL_MS = 60 * 60_000; // the index updates hourly

/** Latest Fear & Greed value, or null when unavailable (never throws). */
export async function getFearGreedIndex(): Promise<FngPoint | null> {
  const cached = FNG_CACHE.get('global');
  if (cached && Date.now() - cached.at < FNG_TTL_MS) return cached.value;
  let value: FngPoint | null = null;
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: { value: string; value_classification: string; timestamp: string }[] };
      const row = body?.data?.[0];
      const v = Number(row?.value);
      if (row && Number.isFinite(v) && v >= 0 && v <= 100) {
        value = { value: v, classification: String(row.value_classification || ''), timestamp: Number(row.timestamp) || 0 };
      }
    }
  } catch {
    value = null;
  }
  FNG_CACHE.set('global', { value, at: Date.now() });
  return value;
}

/**
 * Pure scoring rule (contrarian): extreme fear favors accumulation (+3), extreme
 * greed warns of euphoria (-3), the middle band stays neutral.
 */
export function fngAdjustment(fngValue: number | null): number {
  if (fngValue === null || !Number.isFinite(fngValue)) return 0;
  if (fngValue <= 25) return 3;  // extreme fear
  if (fngValue <= 45) return 1;  // fear
  if (fngValue >= 76) return -3; // extreme greed
  if (fngValue >= 56) return -1; // greed
  return 0;                      // neutral band
}