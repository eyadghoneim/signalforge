import type { MacroCalendarResponse, MacroEvent } from '../shared/types';

const ONE_HOUR_MS = 3600 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 دقيقة كاش للتقويم المباشر

let cachedLiveEvents: MacroEvent[] | null = null;
let lastFetchTime = 0;
let isFetching = false;

interface RawTradingViewEvent {
  id: string;
  title?: string;
  indicator?: string;
  country: string;
  importance: number; // 1 = HIGH, 0 = MEDIUM, -1 = LOW
  date: string; // ISO string
  previous?: number | string | null;
  forecast?: number | string | null;
  actual?: number | string | null;
  scale?: string;
}

function categorizeEvent(title: string): {
  category: MacroEvent['category'];
  impact: MacroEvent['impact'];
  blackoutBefore: number;
  blackoutAfter: number;
} {
  const t = title.toLowerCase();
  if (t.includes('fomc') || t.includes('fed') || t.includes('interest rate') || t.includes('powell')) {
    return { category: 'FOMC', impact: 'HIGH', blackoutBefore: 2, blackoutAfter: 1.5 };
  }
  if (t.includes('cpi') || t.includes('consumer price') || t.includes('inflation') || t.includes('pce')) {
    return { category: 'CPI', impact: 'HIGH', blackoutBefore: 2, blackoutAfter: 1 };
  }
  if (
    t.includes('non farm') ||
    t.includes('nonfarm') ||
    t.includes('payrolls') ||
    t.includes('jobless') ||
    t.includes('employment') ||
    t.includes('unemployment')
  ) {
    return { category: 'NFP', impact: 'HIGH', blackoutBefore: 1.5, blackoutAfter: 1 };
  }
  if (t.includes('ppi') || t.includes('producer price')) {
    return { category: 'PPI', impact: 'MEDIUM', blackoutBefore: 1, blackoutAfter: 0.5 };
  }
  if (t.includes('gdp') || t.includes('gross domestic')) {
    return { category: 'GDP', impact: 'HIGH', blackoutBefore: 1.5, blackoutAfter: 1 };
  }
  return { category: 'CRYPTO_EVENT', impact: 'MEDIUM', blackoutBefore: 1, blackoutAfter: 0.5 };
}

function translateMacroTitleAr(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('speech')) {
    const speaker = title.replace(/speech/i, '').trim();
    return `خطاب وتصريح فيدرالي (${speaker})`;
  }
  if (t.includes('initial jobless') || t.includes('jobless claims')) {
    return 'طلبات إعانة البطالة الأمريكية الأسبوعية';
  }
  if (t.includes('continuing jobless')) {
    return 'طلبات إعانة البطالة المستمرة';
  }
  if (t.includes('cpi') || t.includes('consumer price')) {
    return 'مؤشر أسعار المستهلكين الأمريكي (التضخم CPI)';
  }
  if (t.includes('core pce') || t.includes('pce price')) {
    return 'مؤشر نفقات الاستهلاك الشخصي الأساسي (مقياس التضخم المفضل للفيدرالي)';
  }
  if (t.includes('ppi') || t.includes('producer price')) {
    return 'مؤشر أسعار المنتجين الأمريكي (تضخم الجملة PPI)';
  }
  if (t.includes('fomc') && t.includes('rate')) {
    return 'قرار الفائدة للبنك الاحتياطي الفيدرالي (FOMC)';
  }
  if (t.includes('fomc') && t.includes('minutes')) {
    return 'محضر اجتماع اللجنة الفيدرالية للسوق المفتوحة (FOMC)';
  }
  if (t.includes('non farm') || t.includes('nonfarm') || t.includes('employment change') || t.includes('payrolls')) {
    return `تقرير التوظيف والوظائف الأمريكية (${title})`;
  }
  if (t.includes('gdp')) {
    return 'الناتج المحلي الإجمالي الأمريكي (GDP)';
  }
  if (t.includes('consumer sentiment') || t.includes('michigan')) {
    return 'مؤشر ثقة المستهلك الأمريكي (جامعة ميشيغان)';
  }
  if (t.includes('durable goods')) {
    return 'طلبيات السلع المعمرة الأمريكية';
  }
  if (t.includes('retail sales')) {
    return 'مبيعات التجزئة الأمريكية';
  }
  if (t.includes('crude oil')) {
    return 'مخزونات النفط الخام الأمريكية';
  }
  if (t.includes('pmi')) {
    return `مؤشر مديري المشتريات الأمريكي (${title})`;
  }
  return title;
}

function describeMacroEventAr(category: MacroEvent['category'], title: string): string {
  switch (category) {
    case 'FOMC':
      return 'قرارات وتصريحات الفيدرالي تؤثر مباشرة على أسعار الفائدة والسيولة العالمية وتقلبات الكريبتو.';
    case 'CPI':
      return 'بيانات التضخم الأمريكية الرئيسية تحدد مسار الفيدرالي وسياسات التيسير أو التشدد النقدي.';
    case 'NFP':
      return 'بيانات سوق العمل والوظائف تعكس صحة الاقتصاد وتؤثر فوراً على تدفقات السيولة.';
    case 'PPI':
      return 'مؤشر تضخم الجملة يسبق تضخم المستهلكين ويقدم إشارة استباقية لاتجاهات الفائدة.';
    case 'GDP':
      return 'النمو الاقتصادي الأمريكي السنوي يقيس وتيرة النشاط الاقتصادي وشهية المخاطرة.';
    default:
      return `حدث اقتصادي مرتقب (${title}) يؤثر على حركة السيولة والتذبذب اللحظي في الأسواق.`;
  }
}

/**
 * جلب بيانات المفكرة الاقتصادية الأمريكية الحقيقية مباشرة عبر TradingView Economic Calendar API
 */
export async function fetchLiveTradingViewEvents(): Promise<MacroEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);

  try {
    const from = new Date(Date.now() - 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 10 * ONE_DAY_MS).toISOString();
    const url = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=US`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Origin: 'https://www.tradingview.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      },
    });

    if (!res.ok) {
      throw new Error(`TradingView calendar returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as { result?: RawTradingViewEvent[] };
    const rawList = data.result || [];

    // تصفية الأحداث الأمريكية عالية ومتوسطة الأهمية
    const filtered = rawList.filter((e) => e.country === 'US' && e.importance >= 0);

    const mapped: MacroEvent[] = filtered.map((e) => {
      const title = e.title || e.indicator || 'US Economic Event';
      const cat = categorizeEvent(title);
      const ts = new Date(e.date).getTime();
      const scale = e.scale || '';
      const previousValue = e.previous !== null && e.previous !== undefined ? `${e.previous}${scale}` : '—';
      const forecastValue = e.forecast !== null && e.forecast !== undefined ? `${e.forecast}${scale}` : '—';
      const actualValue = e.actual !== null && e.actual !== undefined ? `${e.actual}${scale}` : undefined;

      const timeFormatted = new Date(ts).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

      return {
        id: `tv_${e.id}`,
        name: title,
        nameAr: translateMacroTitleAr(title),
        category: cat.category,
        impact: cat.impact,
        timestamp: ts,
        timeFormatted,
        previousValue,
        forecastValue,
        actualValue,
        blackoutHoursBefore: cat.blackoutBefore,
        blackoutHoursAfter: cat.blackoutAfter,
        descriptionAr: describeMacroEventAr(cat.category, title),
        status: 'UPCOMING',
        country: 'US',
        source: 'TradingView Live Calendar',
      };
    });

    return mapped;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * النموذج المرجعي الاحتياطي — يُستخدم عند تعطل الإنترنت أو في الاختبارات الحتمية المحددة بـ explicitAnchor
 */
function getReferenceTemplateEvents(dayStart: number): MacroEvent[] {
  const baseTemplates = [
    {
      id: 'evt_cpi',
      name: 'US Consumer Price Index (CPI YoY)',
      nameAr: 'مؤشر أسعار المستهلكين الأمريكي (التضخم السنوي CPI)',
      category: 'CPI' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 12.5,
      previousValue: '—',
      forecastValue: '—',
      blackoutHoursBefore: 2,
      blackoutHoursAfter: 1,
      descriptionAr: 'بيانات التضخم الأمريكي الرئيسية تحدد مسار الفيدرالي وتوجهات أسعار الفائدة والسيولة.',
    },
    {
      id: 'evt_fomc',
      name: 'FOMC Federal Reserve Interest Rate Decision',
      nameAr: 'قرار الفائدة للبنك الاحتياطي الفيدرالي الأمريكي (FOMC)',
      category: 'FOMC' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 42,
      previousValue: '—',
      forecastValue: '—',
      blackoutHoursBefore: 2,
      blackoutHoursAfter: 1.5,
      descriptionAr: 'الحدث المالي الأضخم عالمياً — يحدد تكلفة الاقتراض وحجم السيولة في الأسواق العالمية.',
    },
    {
      id: 'evt_nfp',
      name: 'US Non-Farm Payrolls (NFP Employment)',
      nameAr: 'تقرير الوظائف غير الزراعية الأمريكي (NFP)',
      category: 'NFP' as const,
      impact: 'HIGH' as const,
      dayOffsetHours: 60.5,
      previousValue: '—',
      forecastValue: '—',
      blackoutHoursBefore: 1.5,
      blackoutHoursAfter: 1,
      descriptionAr: 'مؤشر صحة سوق العمل الأمريكي ومعدلات البطالة التي يراقبها الفيدرالي عن كثب.',
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
      descriptionAr: 'مؤشر تضخم أسعار الجملة للسلع والخدمات المنتجة محلياً.',
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
      descriptionAr: 'مقياس وتيرة النمو الاقتصادي الإجمالي للولايات المتحدة الأمريكية.',
    },
  ];

  return baseTemplates.map((t) => {
    const timestamp = dayStart + t.dayOffsetHours * ONE_HOUR_MS;
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
      status: 'UPCOMING',
      country: 'US',
      source: 'Deterministic Reference Model',
    };
  });
}

function processEventsStatus(events: MacroEvent[], now: number): MacroEvent[] {
  return events.map((e) => {
    const startBlackout = e.timestamp - e.blackoutHoursBefore * ONE_HOUR_MS;
    const endBlackout = e.timestamp + e.blackoutHoursAfter * ONE_HOUR_MS;

    let status: MacroEvent['status'] = 'UPCOMING';
    if (now >= startBlackout && now <= endBlackout) {
      status = 'ACTIVE_BLACKOUT';
    } else if (now > endBlackout) {
      status = 'PASSED';
    }

    return { ...e, status };
  });
}

/**
 * إرجاع المفكرة الاقتصادية بصيغة متزامنة سريعة (من الكاش الحي أو النموذج المرجعي الاحتياطي)
 */
export function getMacroCalendar(now: number = Date.now(), explicitAnchor?: number): MacroCalendarResponse {
  const dayStart = explicitAnchor ?? Math.floor(now / ONE_DAY_MS) * ONE_DAY_MS;

  // إذا كان هناك anchor محدد صراحة (مثل اختبارات test/runTests.ts)، نستخدم النموذج المرجعي الحتمي دائماً
  if (explicitAnchor !== undefined || !cachedLiveEvents || cachedLiveEvents.length === 0) {
    const rawEvents = getReferenceTemplateEvents(dayStart);
    const events = processEventsStatus(rawEvents, now);

    const activeEvent = events.find((e) => e.status === 'ACTIVE_BLACKOUT') || null;
    const isBlackoutActive = activeEvent !== null;

    const lockReasonAr = isBlackoutActive
      ? `⚠️ تنبيه استرشادي: تداخل مع نافذة صدور "${activeEvent?.nameAr}". تنبيه للمتداول لتوخي الحذر من تذبذب السيولة (لا يحظر المحرك الصفقات تلقائياً).`
      : null;

    const lockReasonEn = isBlackoutActive
      ? `⚠️ Advisory notice: overlap with release window for "${activeEvent?.name}". Volatility awareness warning (no trading is locked automatically).`
      : null;

    // تشغيل جلب غير متزامن في الخلفية لتحديث الكاش الحي إذا لم نكن في اختبارات محددة
    if (explicitAnchor === undefined && !isFetching && Date.now() - lastFetchTime > CACHE_TTL_MS) {
      void refreshLiveCalendarInBackground();
    }

    return {
      isBlackoutActive,
      activeEvent,
      lockReasonAr,
      lockReasonEn,
      isReferenceSchedule: true,
      source: 'نموذج جدول مرجعي استرشادي (Reference Model)',
      noteAr:
        'جدول استرشادي بمواعيد المؤشرات الأمريكية المعتادة — يتم تحديثه لحظياً إلى بيانات حية من TradingView فور الاتصال. التنبيهات استرشادية ولا تحظر الصفقات تلقائياً.',
      noteEn:
        'Reference schedule of recurring US indicators — refreshed to live TradingView data once connected. Notices are display-only guidance.',
      upcomingEvents: events,
      lastUpdated: now,
    };
  }

  // استخدام البيانات الحية المستلمة من TradingView
  const processed = processEventsStatus(cachedLiveEvents, now);

  // إبقاء الأحداث القادمة أو النشطة أو التي مرت قبل أقل من ساعتين
  const relevantEvents = processed
    .filter((e) => e.timestamp > now - 2 * ONE_HOUR_MS)
    .sort((a, b) => a.timestamp - b.timestamp);

  const eventsToReturn = relevantEvents.length >= 3 ? relevantEvents : processed;

  const activeEvent = eventsToReturn.find((e) => e.status === 'ACTIVE_BLACKOUT') || null;
  const isBlackoutActive = activeEvent !== null;

  const lockReasonAr = isBlackoutActive
    ? `⚠️ تنبيه استرشادي: نافذة صدور بيانات حية نشطة "${activeEvent?.nameAr}". يُنصح بالحذر من حدوث تذبذبات حادة في السيولة اللحظية.`
    : null;

  const lockReasonEn = isBlackoutActive
    ? `⚠️ Advisory notice: live high-impact release window active for "${activeEvent?.name}". Watch out for heightened intrabar liquidity volatility.`
    : null;

  return {
    isBlackoutActive,
    activeEvent,
    lockReasonAr,
    lockReasonEn,
    isReferenceSchedule: false,
    source: 'TradingView Real-Time Economic Calendar (بيانات حية مباشرة)',
    noteAr:
      'مفكرة اقتصادية حية ومحدثة لحظياً عبر TradingView للأحداث والمؤشرات الأمريكية عالية ومتوسطة الأهمية مع القيم السابقة والتوقعات. التنبيهات استرشادية للمتداول.',
    noteEn:
      'Live real-time economic calendar via TradingView for US high and medium impact releases with forecasts and previous figures. Display-only advisory.',
    upcomingEvents: eventsToReturn,
    lastUpdated: lastFetchTime || now,
  };
}

async function refreshLiveCalendarInBackground(): Promise<void> {
  if (isFetching) return;
  isFetching = true;
  try {
    const live = await fetchLiveTradingViewEvents();
    if (live && live.length > 0) {
      cachedLiveEvents = live;
      lastFetchTime = Date.now();
    }
  } catch {
    // الصمت عند فشل الاتصال العابر واستمرار العمل بالنموذج الاحتياطي
  } finally {
    isFetching = false;
  }
}

/**
 * دالة غير متزامنة تُستدعى من مسارات API لتحديث الكاش الحي إذا انتهت صلاحيته
 */
export async function getMacroCalendarAsync(now: number = Date.now()): Promise<MacroCalendarResponse> {
  if (!cachedLiveEvents || Date.now() - lastFetchTime > CACHE_TTL_MS) {
    await refreshLiveCalendarInBackground();
  }
  return getMacroCalendar(now);
}
