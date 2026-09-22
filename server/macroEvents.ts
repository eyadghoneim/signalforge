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
      dayOffsetHours: 12.5, // النمط المرجعي المعتاد: 12:30 UTC
      previousValue: '—',
      forecastValue: '—',
      blackoutHoursBefore: 2,
      blackoutHoursAfter: 1,
      descriptionAr: 'بيانات التضخم الأمريكي الرئيسية تحدد مسار الفيدرالي — نموذج مرجعي للموعد المتكرر، وليس إعلاناً مجدولاً فعلياً',
    },
    {
      id: 'evt_fomc',
      name: 'FOMC Federal Reserve Interest Rate Decision',
      nameAr: 'قرار الفائدة للبنك الاحتياطي الفيدرالي الأمريكي (FOMC)',
      category: 'FOMC' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 42, // النمط المرجعي: 18:00 UTC في اليوم التالي
      previousValue: '—',
      forecastValue: '—',
      blackoutHoursBefore: 2,
      blackoutHoursAfter: 1.5,
      descriptionAr: 'الحدث المالي الأضخم عالمياً — نموذج مرجعي للموعد المتكرر، وليس إعلاناً مجدولاً فعلياً',
    },
    {
      id: 'evt_nfp',
      name: 'US Non-Farm Payrolls (NFP Employment)',
      nameAr: 'تقرير الوظائف غير الزراعية الأمريكي (NFP)',
      category: 'NFP' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 60.5, // النمط المرجعي: 12:30 UTC بعد يومين
      previousValue: '—',
      forecastValue: '—',
      blackoutHoursBefore: 1.5,
      blackoutHoursAfter: 1,
      descriptionAr: 'مؤشر صحة سوق العمل الأمريكي — نموذج مرجعي للموعد المتكرر، وليس إعلاناً مجدولاً فعلياً',
    },
    {
      id: 'evt_ppi',
      name: 'US Producer Price Index (PPI MoM)',
      nameAr: 'مؤشر أسعار المنتجين الأمريكي (PPI الشهري)',
      category: 'PPI' as const,
      impact: 'MEDIUM' as const,
      dayOffsetHours: 84.5,
      previousValue: '—',
      forecastValue: '—',
      blackoutHoursBefore: 1,
      blackoutHoursAfter: 0.5,
      descriptionAr: 'مؤشر تضخم أسعار الجملة — نموذج مرجعي للموعد المتكرر، وليس إعلاناً مجدولاً فعلياً',
    },
    {
      id: 'evt_gdp',
      name: 'US Gross Domestic Product (GDP Annualized)',
      nameAr: 'الناتج المحلي الإجمالي الأمريكي السنوي (GDP)',
      category: 'GDP' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 108.5,
      previousValue: '—',
      forecastValue: '—',
      blackoutHoursBefore: 1.5,
      blackoutHoursAfter: 1,
      descriptionAr: 'مقياس وتيرة النمو الاقتصادي الأمريكي — نموذج مرجعي للموعد المتكرر، وليس إعلاناً مجدولاً فعلياً',
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

  // Honest framing: this is a REFERENCE rhythm of typical release times, not a real
  // economic calendar, and it does NOT block any trading by itself. The previous
  // wording claimed new BUY entries were automatically locked - that was false:
  // no engine, gate, or paper-trading code consumes this value.
  const lockReasonAr = isBlackoutActive
    ? `⚠️ تنبيه استرشادي: تداخل مع النمط المرجعي لصدور "${activeEvent?.nameAr}". هذا تنبيه عرضي فقط — لا يوجد أي حظر فعلي للصفقات (المحرك لا يستهلك هذه القيمة).`
    : null;

  const lockReasonEn = isBlackoutActive
    ? `⚠️ Reference notice: overlaps the typical release window for ${activeEvent?.name}. Display-only warning — no trading is actually blocked by this calendar.`
    : null;

  return {
    isBlackoutActive,
    activeEvent,
    lockReasonAr,
    lockReasonEn,
    isReferenceSchedule: true,
    noteAr: 'جدول استرشادي بنمط المواعيد المتكررة المعتادة للمؤشرات الأمريكية — ليس جدولاً حقيقياً؛ المواعيد تتكرر يومياً كنموذج مرجعي، والقيم الفعلية تُنشر من مصادر رسمية. لا يحظر هذا الجدول أي صفقات تلقائياً.',
    noteEn: 'Reference schedule of typical recurring release times for US indicators — not a real calendar; times repeat daily as a template. It does NOT block any trading automatically.',
    upcomingEvents: events,
    lastUpdated: now,
  };
}
