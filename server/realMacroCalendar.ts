import type { MacroCalendarResponse, MacroEvent } from '../shared/types';
import { getMacroCalendar } from './macroEvents';

const ONE_HOUR_MS = 3600 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Free weekly economic calendar feed (no API key required).
// Always fetched server-side with a short timeout and cached; any failure
// silently degrades to the built-in reference template calendar.
const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes on success
const FAILURE_TTL_MS = 60 * 1000; // retry failures after 1 minute
const FETCH_TIMEOUT_MS = 4000;
const MAX_EVENTS = 12;

interface FfEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

export interface RawMacroRelease {
  title: string;
  /** UTC epoch milliseconds of the scheduled release. */
  timestamp: number;
  impact: 'HIGH' | 'MEDIUM';
  forecast: string;
  previous: string;
}

/** Pure classifier: map an external release title into a MacroEvent category. */
export function classifyMacroTitle(title: string): MacroEvent['category'] {
  const t = title.toUpperCase();
  if (t.includes('FOMC') || t.includes('FEDERAL FUNDS RATE')) return 'FOMC';
  if (t.includes('CPI')) return 'CPI';
  if (t.includes('NFP') || t.includes('NON-FARM') || t.includes('NONFARM')) return 'NFP';
  if (t.includes('PPI')) return 'PPI';
  if (t.includes('GDP')) return 'GDP';
  return 'OTHER';
}

/** Pure builder: build a live MacroCalendarResponse from verified external US releases. */
export function buildRealMacroCalendar(releases: RawMacroRelease[], now: number): MacroCalendarResponse {
  const events: MacroEvent[] = releases
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((r, i) => {
      const blackoutHoursBefore = r.impact === 'HIGH' ? 2 : 1;
      const blackoutHoursAfter = r.impact === 'HIGH' ? 1 : 0.5;
      const startBlackout = r.timestamp - blackoutHoursBefore * ONE_HOUR_MS;
      const endBlackout = r.timestamp + blackoutHoursAfter * ONE_HOUR_MS;

      let status: MacroEvent['status'] = 'UPCOMING';
      if (now >= startBlackout && now <= endBlackout) {
        status = 'ACTIVE_BLACKOUT';
      } else if (now > endBlackout) {
        status = 'PASSED';
      }

      const timeFormatted =
        new Date(r.timestamp).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

      return {
        id: `evt_real_${r.timestamp}_${i}`,
        name: r.title,
        nameAr: r.title, // external feed titles are English-only; description below stays Arabic
        category: classifyMacroTitle(r.title),
        impact: r.impact,
        timestamp: r.timestamp,
        timeFormatted,
        previousValue: r.previous || '—',
        forecastValue: r.forecast || '—',
        blackoutHoursBefore,
        blackoutHoursAfter,
        descriptionAr: 'حدث حقيقي مجدول من المفكرة الاقتصادية الأسبوعية (مصدر خارجي) — قد تتغير المواعيد؛ تحقق من المصدر الرسمي قبل التداول',
        status,
      };
    });

  const activeEvent = events.find((e) => e.status === 'ACTIVE_BLACKOUT') || null;
  const isBlackoutActive = activeEvent !== null;

  const lockReasonAr = isBlackoutActive
    ? `⚠️ تداخل مع نافذة صدور "${activeEvent?.name}" من المفكرة الاقتصادية الحقيقية — تنبيه عرضي فقط، لا يوجد أي حظر فعلي للصفقات.`
    : null;

  const lockReasonEn = isBlackoutActive
    ? `⚠️ Overlap with the real release window of "${activeEvent?.name}" — display-only notice, no trading is actually blocked.`
    : null;

  return {
    isBlackoutActive,
    activeEvent,
    lockReasonAr,
    lockReasonEn,
    isReferenceSchedule: false,
    calendarSource: 'REAL_EXTERNAL',
    noteAr: 'مفكرة اقتصادية حقيقية للإصدارات الأمريكية عالية ومتوسطة التأثير لهذا الأسبوع (مصدر خارجي مجاني) — المواعيد بتوقيت UTC وقد تُعاد جدولتها؛ تحقق دائمًا من المصدر الرسمي. لا يحظر هذا التنبيه أي صفقات تلقائيًا.',
    noteEn: 'Real weekly calendar of high/medium-impact US releases from a free external feed — times are UTC and can shift; always verify with official sources. Does NOT block any trading automatically.',
    upcomingEvents: events,
    lastUpdated: now,
  };
}

let cache: { at: number; ok: boolean; releases: RawMacroRelease[] } | null = null;
let inFlight: Promise<RawMacroRelease[] | null> | null = null;

/** Test hook: clear the in-memory feed cache. */
export function resetMacroCalendarCache(): void {
  cache = null;
  inFlight = null;
}

async function fetchFeed(): Promise<RawMacroRelease[] | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FEED_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'signalforge-terminal/3.2' },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as FfEvent[];
    if (!Array.isArray(raw)) return null;

    const now = Date.now();
    const horizonStart = now - ONE_DAY_MS; // keep yesterday for PASSED context
    const horizonEnd = now + 7 * ONE_DAY_MS;
    const seen = new Set<string>();
    const releases: RawMacroRelease[] = [];

    for (const ev of raw) {
      if (!ev || ev.country !== 'USD' || !ev.title || !ev.date) continue;
      const impact = String(ev.impact || '').toLowerCase();
      if (impact !== 'high' && impact !== 'medium') continue;
      const ts = new Date(ev.date).getTime();
      if (!Number.isFinite(ts) || ts < horizonStart || ts > horizonEnd) continue;
      const key = `${ev.title}|${ts}`;
      if (seen.has(key)) continue;
      seen.add(key);
      releases.push({
        title: ev.title,
        timestamp: ts,
        impact: impact === 'high' ? 'HIGH' : 'MEDIUM',
        forecast: String(ev.forecast || '').trim(),
        previous: String(ev.previous || '').trim(),
      });
    }

    if (!releases.length) return null;
    releases.sort((a, b) => a.timestamp - b.timestamp);
    return releases.slice(0, MAX_EVENTS);
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

/** Fetch external releases with in-memory caching (success 30 min, failure 1 min). */
export async function getRealMacroReleases(): Promise<RawMacroRelease[] | null> {
  const now = Date.now();
  const ttl = cache?.ok ? CACHE_TTL_MS : FAILURE_TTL_MS;
  if (cache && now - cache.at < ttl) {
    return cache.ok && cache.releases.length ? cache.releases : null;
  }
  if (!inFlight) {
    inFlight = fetchFeed().finally(() => {
      inFlight = null;
    });
  }
  const result = await inFlight;
  cache = { at: now, ok: result !== null, releases: result ?? [] };
  return result;
}

/**
 * Live calendar: real external feed first (MACRO_CALENDAR_MODE=real, default),
 * graceful fallback to the built-in reference template on any failure or when
 * MACRO_CALENDAR_MODE=reference.
 */
export async function getMacroCalendarLive(now: number = Date.now()): Promise<MacroCalendarResponse> {
  if (String(process.env.MACRO_CALENDAR_MODE || 'real').trim().toLowerCase() === 'reference') {
    return getMacroCalendar(now);
  }
  const releases = await getRealMacroReleases();
  if (releases && releases.length) {
    return buildRealMacroCalendar(releases, now);
  }
  return getMacroCalendar(now); // calendarSource: 'REFERENCE_TEMPLATE' set by the builder
}
