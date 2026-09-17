// قاموس الواجهة (عربي / إنجليزي) — مصدر واحد للنصوص المكتوبة يدويًا.
// ملاحظة: التحليل اللي المحرك بيولده (الأسباب وsummary) لسه عربي حصرًا —
// هنضيف له نسخة إنجليزية من المحرك نفسه في جولة قادمة.
export type Lang = 'ar' | 'en';

const DICT = {
  ar: {
    // شريط علوي
    tagline: 'منصة الإشارات الكمية — أداة بحثية',
    settings: 'الإعدادات',
    close: 'إغلاق',
    retry: 'إعادة المحاولة',
    signalError: 'تعذر جلب الإشارة',
    // بطاقة حالة المحرك
    engineStatus: 'حالة المحرك',
    version: 'النسخة',
    lastScan: 'آخر مسح آلي',
    activeAsset: 'الأصل النشط',
    dataSource: 'مصدر البيانات',
    live: 'حيّة',
    stale: 'متأخرة',
    waiting: 'قيد الانتظار…',
    engineNote: 'كل إشارة (الممنوعة كذلك) تُحفظ وتُتابع تلقائياً: هل TP1 يضرب قبل وقف الخسارة؟ — عشان نعرف مين من المؤشرات بيكسب فعلاً.',
    // تبويبات
    tabHistory: 'سجل الإشارات',
    tabBacktest: 'الباك تست',
    tabSettings: 'الإعدادات',
    tabDex: 'سيولة DEX',
    tabLearning: 'التعلّم الذاتي',
    // إخلاء مسؤولية
    disclaimer: 'هذه منظومة بحثية ومحاكاة فقط — ليست نصيحة استثمارية. نتائج الباك تست التاريخية لا تضمن أي أداء مستقبلي. التنفيذ الحي معطل بالتصميم.',
    // بطاقة الإشارة — التوصية
    verdictGated: 'ممنوع الدخول حاليًا',
    verdictGatedSub: 'بوابة حماية منعت الإشارة',
    verdictBuy: 'ادخل — شراء',
    verdictBuySub: 'الظروف الفنية معاك',
    verdictSell: 'اخرج — بيع / تخفيف',
    verdictSellSub: 'البنية الفنية بتقول خروج دفاعي',
    verdictHold: 'خليك برا — انتظار',
    verdictHoldSub: 'مفيش ظروف جيدة للدخول دلوقتي',
    // أنواع الإشارة
    typeStrongBuy: '🚀 شراء قوي',
    typeBuy: '📈 شراء',
    typeHold: '⏳ انتظار',
    typeNoTrade: '🛡️ ممنوع الدخول',
    typeSell: '📉 بيع',
    typeStrongSell: '🛑 بيع قوي',
    // بوابات
    gateHtf: 'بوابة الفريم الأكبر (4h)',
    gateChop: 'بوابة السوق العرضي (ADX)',
    gateRvol: 'بوابة الفوليوم الضعيف',
    gateSqueeze: 'بوابة تمويل العقود',
    gateUnknown: 'بوابة مخاطر',
    gateNote: 'الإشارة محفوظة للتدقيق — هنعرف بعدين لو البوابة منعت خسارة أو منعت ربح.',
    // أرقام المخاطرة
    riskReward: 'مخاطرة/عائد',
    stopLoss: 'وقف الخسارة',
    target: 'الأهداف',
    why: 'ليه الإشارة دي؟',
    factors: 'عامل',
    htfActive: 'بوابة 4h نشطة',
    htfMissing: 'بيانات 4h غير متاحة — البوابة معطلة بصراحة',
    // سيولة
    liquidityTitle: 'سيولة السوق العالمية',
    defillama: 'DefiLlama',
    riskOn: 'خطر صعودي — سيولة ممتدة',
    neutral: 'محايد',
    riskOff: 'انحسار سيولة — احتراس',
    unavailable: 'غير متاح',
    liquidityFooter: 'تعديل الدرجة الكلي',
    sourcesOf: 'مصادر متاحة',
    // حالة المزودين
    providerSources: 'مصادر البيانات:',
    collecting: 'لسه بتتجمع',
    works: 'يعمل',
    lastError: 'آخر خطأ:',
    engineNoteTitle: 'ملاحظة',
    // لوحة الأداء Attribution
    attrTitle: 'من مؤشراتك بيكسب فعلاً؟',
    attrResolved: 'محسومة',
    attrTp1: 'TP1 قبل الوقف',
    attrSl: 'الوقف أولاً',
    attrWinRate: 'نسبة نجاح الإشارات المحسومة:',
    attrCollecting: 'بتتجمع البيانات — أول ما تتحسم إشارات هيظهر تقييم كل عامل هنا',
    attrLegend: 'الأخضر = العامل حاضر غالباً في الإشارات الرابحة، الأحمر = حاضر في الخاسرة. بعد 20+ إشارة محسومة تبقى الدلالة إحصائية حقيقية.',
    tagTrend: 'الترند (EMA)',
    tagMacd: 'زخم MACD',
    tagRsi: 'تشبع RSI',
    tagAdx: 'قوة الاتجاه',
    tagRvol: 'الفوليوم النسبي',
    tagMomentum: 'زخم 24 ساعة',
    tagFunding: 'تمويل العقود',
    tagBollinger: 'بولنجر',
    tagHtf: 'فريم 4 ساعات/يومي',
    tagSmc: 'بنية السوق (SMC)',
    tagLiquidity: 'السيولة العالمية',
    tagWhale: 'تدفق الحيتان',
    tagFng: 'الخوف والجشع',
    tagOi: 'الفائدة المفتوحة',
  },
  en: {
    // شريط علوي
    tagline: 'Quant signal platform — research tool',
    settings: 'Settings',
    close: 'Close',
    retry: 'Retry',
    signalError: 'Could not load signal',
    // بطاقة حالة المحرك
    engineStatus: 'Engine status',
    version: 'Version',
    lastScan: 'Last scan',
    activeAsset: 'Active asset',
    dataSource: 'Data source',
    live: 'Live',
    stale: 'Stale',
    waiting: 'waiting…',
    engineNote: 'Every signal (blocked ones too) is stored and tracked automatically: does TP1 hit before stop-loss? — so we learn which indicators actually win.',
    // تبويبات
    tabHistory: 'Signal history',
    tabBacktest: 'Backtest',
    tabSettings: 'Settings',
    tabDex: 'DEX liquidity',
    tabLearning: 'Self-learning',
    // إخلاء مسؤولية
    disclaimer: 'This is a research & simulation system only — not investment advice. Past backtest results do not guarantee any future performance. Live execution is disabled by design.',
    // بطاقة الإشارة — التوصية
    verdictGated: 'No entry right now',
    verdictGatedSub: 'A risk gate blocked the signal',
    verdictBuy: 'Enter — Buy',
    verdictBuySub: 'Technical conditions are with you',
    verdictSell: 'Exit — Sell / trim',
    verdictSellSub: 'Market structure says defensive exit',
    verdictHold: 'Stay out — Wait',
    verdictHoldSub: 'No good entry conditions right now',
    // أنواع الإشارة
    typeStrongBuy: '🚀 Strong buy',
    typeBuy: '📈 Buy',
    typeHold: '⏳ Wait',
    typeNoTrade: '🛡️ No trade',
    typeSell: '📉 Sell',
    typeStrongSell: '🛑 Strong sell',
    // بوابات
    gateHtf: 'Higher-timeframe gate (4h)',
    gateChop: 'Choppy-market gate (ADX)',
    gateRvol: 'Weak-volume gate',
    gateSqueeze: 'Funding squeeze gate',
    gateUnknown: 'Risk gate',
    gateNote: 'Signal kept for audit — we will learn later whether the gate blocked a loss or a profit.',
    // أرقام المخاطرة
    riskReward: 'Risk/Reward',
    stopLoss: 'Stop-loss',
    target: 'Targets',
    why: 'Why this signal?',
    factors: 'factors',
    htfActive: '4h gate active',
    htfMissing: '4h data unavailable — gate honestly disabled',
    // سيولة
    liquidityTitle: 'Global market liquidity',
    defillama: 'DefiLlama',
    riskOn: 'Risk-on — liquidity expanding',
    neutral: 'Neutral',
    riskOff: 'Liquidity draining — caution',
    unavailable: 'n/a',
    liquidityFooter: 'Total score adjustment',
    sourcesOf: 'sources OK',
    // حالة المزودين
    providerSources: 'Data sources:',
    collecting: 'gathering…',
    works: 'OK',
    lastError: 'Last error:',
    engineNoteTitle: 'Note',
    // لوحة الأداء Attribution
    attrTitle: 'Which of your indicators actually win?',
    attrResolved: 'Resolved',
    attrTp1: 'TP1 before SL',
    attrSl: 'SL first',
    attrWinRate: 'Win rate of resolved signals: ',
    attrCollecting: 'Collecting data — once signals resolve, each factor rating shows here',
    attrLegend: 'Green = factor usually present in winners, red = present in losers. After 20+ resolved signals the signal becomes statistically meaningful.',
    tagTrend: 'Trend (EMA)',
    tagMacd: 'MACD momentum',
    tagRsi: 'RSI saturation',
    tagAdx: 'Trend strength',
    tagRvol: 'Relative volume',
    tagMomentum: '24h momentum',
    tagFunding: 'Funding',
    tagBollinger: 'Bollinger',
    tagHtf: '4h/Daily timeframe',
    tagSmc: 'Market structure (SMC)',
    tagLiquidity: 'Global liquidity',
    tagWhale: 'Whale flow',
    tagFng: 'Fear & Greed',
    tagOi: 'Open interest',
  },
} as const;

export type TKey = keyof (typeof DICT)['ar'];

export function t(lang: Lang, key: TKey): string {
  const row = DICT[lang];
  return (row[key] as string | undefined) ?? DICT.ar[key];
}

export function applyDocumentDir(lang: Lang): void {
  const html = document.documentElement;
  html.lang = lang === 'ar' ? 'ar' : 'en';
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
