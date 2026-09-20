import type { MacroCalendarResponse, MacroEvent } from '../shared/types';

const ONE_HOUR_MS = 3600 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Returns a calendar of key high-impact US macroeconomic releases
 * anchored to the UTC day cycle so timestamps remain consistent across scans and checks.
 */
export function getMacroCalendar(now: number = Date.now(), explicitAnchor?: number): MacroCalendarResponse {
  const dayStart = explicitAnchor ?? Math.floor(now / ONE_DAY_MS) * ONE_DAY_MS;

  // Recurring high-impact economic calendar releases anchored to standard release times (UTC)
  const baseTemplates = [
    {
      id: 'evt_cpi',
      name: 'US Consumer Price Index (CPI YoY)',
      nameAr: 'مؤشر أسعار المستهلكين الأمريكي (التضخم السنوي CPI)',
      category: 'CPI' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 12.5, // 12:30 UTC today
      previousValue: '2.9%',
      forecastValue: '2.8%',
      blackoutHoursBefore: 2,
      blackoutHoursAfter: 1,
      descriptionAr: 'بيانات التضخم الأمريكي الرئيسية تحدد مسار الفيدرالي في خفض أو تثبيت الفائدة',
    },
    {
      id: 'evt_fomc',
      name: 'FOMC Federal Reserve Interest Rate Decision',
      nameAr: 'قرار الفائدة للبنك الاحتياطي الفيدرالي الأمريكي (FOMC)',
      category: 'FOMC' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 42, // Tomorrow 18:00 UTC
      previousValue: '5.25%',
      forecastValue: '5.00%',
      blackoutHoursBefore: 2,
      blackoutHoursAfter: 1.5,
      descriptionAr: 'الحدث المالي الأضخم عالمياً الذي يحرك مؤشر الدولار والسيولة في الأسواق الرقمية',
    },
    {
      id: 'evt_nfp',
      name: 'US Non-Farm Payrolls (NFP Employment)',
      nameAr: 'تقرير الوظائف غير الزراعية الأمريكي (NFP)',
      category: 'NFP' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 60.5, // Day after tomorrow 12:30 UTC
      previousValue: '142K',
      forecastValue: '165K',
      blackoutHoursBefore: 1.5,
      blackoutHoursAfter: 1,
      descriptionAr: 'مؤشر صحة سوق العمل الأمريكي وسرعة نمو الأجور، محرك قوي للتقلبات اللحظية',
    },
    {
      id: 'evt_ppi',
      name: 'US Producer Price Index (PPI MoM)',
      nameAr: 'مؤشر أسعار المنتجين الأمريكي (PPI الشهري)',
      category: 'PPI' as const,
      impact: 'MEDIUM' as const,
      dayOffsetHours: 84.5,
      previousValue: '0.2%',
      forecastValue: '0.1%',
      blackoutHoursBefore: 1,
      blackoutHoursAfter: 0.5,
      descriptionAr: 'مؤشر تضخم أسعار الجملة الذي يسبق مؤشر المستهلكين بشهر واحد',
    },
    {
      id: 'evt_gdp',
      name: 'US Gross Domestic Product (GDP Annualized)',
      nameAr: 'الناتج المحلي الإجمالي الأمريكي السنوي (GDP)',
      category: 'GDP' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 108.5,
      previousValue: '3.0%',
      forecastValue: '2.9%',
      blackoutHoursBefore: 1.5,
      blackoutHoursAfter: 1,
      descriptionAr: 'مقياس وتيرة النمو الاقتصادي للولايات المتحدة واحتمالات الركود',
    },
  ];

  const events: MacroEvent[] = baseTemplates.map((t) => {
    const timestamp = dayStart + t.dayOffsetHours * ONE_HOUR_MS;
    const startBlackout = timestamp - t.blackoutHoursBefore * ONE_HOUR_MS;
    const endBlackout = timestamp + t.blackoutHoursAfter * ONE_HOUR_MS;

    let status: MacroEvent['status'] = 'UPCOMING';
    if (now >= startBlackout && now <= endBlackout) {
      status = 'ACTIVE_BLACKOUT';
    } else if (now > endBlackout) {
      status = 'PASSED';
    }

    const timeFormatted =
      new Date(timestamp).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

    return {
      id: t.id,
      name: t.name,
      nameAr: t.nameAr,
      category: t.category,
      impact: t.impact,
      timestamp,
      timeFormatted,
      previousValue: t.previousValue,
      forecastValue: t.forecastValue,
      blackoutHoursBefore: t.blackoutHoursBefore,
      blackoutHoursAfter: t.blackoutHoursAfter,
      descriptionAr: t.descriptionAr,
      status,
    };
  });

  const activeEvent = events.find((e) => e.status === 'ACTIVE_BLACKOUT') || null;
  const isBlackoutActive = activeEvent !== null;

  const lockReasonAr = isBlackoutActive
    ? `⚠️ نافذة حظر نشطة بسبب صدور: ${activeEvent?.nameAr}. يتم حظر الصفقات الجديدة تلقائياً قبل الحدث بـ ${activeEvent?.blackoutHoursBefore} س وبعده بـ ${activeEvent?.blackoutHoursAfter} س لتجنب صيد الوقف.`
    : null;

  const lockReasonEn = isBlackoutActive
    ? `⚠️ Active blackout window due to ${activeEvent?.name}. New entries are temporarily paused to avoid stop-hunt whipsaws.`
    : null;

  return {
    isBlackoutActive,
    activeEvent,
    lockReasonAr,
    lockReasonEn,
    upcomingEvents: events,
    lastUpdated: now,
  };
}
