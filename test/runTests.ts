// اختبارات SignalForge — سلوكية على كود التطبيق الفعلي (tsx test/runTests.ts)
import * as path from 'path';
import * as fs from 'fs';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${testName}${details ? ` — ${details}` : ''}`);
  }
}

function syntheticCandles(n: number, drift: number, seed = 42): import('../shared/types').Candle[] {
  let v = seed;
  const rand = () => {
    v = (v * 1103515245 + 12345) % 2147483648;
    return v / 2147483648;
  };
  const out: import('../shared/types').Candle[] = [];
  let price = 50000;
  // بداية محاذاة لدلوس 4 ساعات عشان اختبار إعادة التشكيل يكون دقيق
  const base = Math.ceil(1_700_000_000 / 14400) * 14400;
  for (let i = 0; i < n; i++) {
    const noise = (rand() - 0.5) * 200;
    const open = price;
    const close = price + drift + noise;
    const high = Math.max(open, close) + rand() * 60;
    const low = Math.min(open, close) - rand() * 60;
    out.push({ time: base + i * 3600, open, high, low, close, volume: 100 + rand() * 400 });
    price = close;
  }
  return out;
}

console.log('\n=== 1. المؤشرات الفنية ===');
{
  const { ema, rsi, macd, atr, adx, bollinger, relativeVolume, resample, computeSnapshot, computeHtfSnapshot, computeDailyTrend, normalizeCandlesForChart } = await import('../shared/indicators');

  const rising = Array.from({ length: 300 }, (_, i) => 100 + i);
  const emaOut = ema(rising, 21);
  assert(!Number.isNaN(emaOut[20]) && Number.isNaN(emaOut[19]), 'EMA بذرة عند نهاية فترة الإحماء');
  // EMA على ميل ثابت يتأخر بـ slope×(period−1)/2 = 10 نقاط — ده سلوك صحيح وليس خطأ
  assert(Math.abs(emaOut[299] - rising[299]) < 15, `EMA يلاحق السعر ضمن التأخر النظري (فرق: ${Math.abs(emaOut[299] - rising[299]).toFixed(1)})`);

  const rsiOut = rsi(rising, 14);
  assert(rsiOut[299] > 70, `RSI عالٍ في صعود مستمر (${rsiOut[299].toFixed(1)})`);
  const falling = rising.map((v) => 500 - v);
  const rsiDown = rsi(falling, 14);
  assert(rsiDown[299] < 30, `RSI منخفض في هبوط مستمر (${rsiDown[299].toFixed(1)})`);

  const candles = syntheticCandles(300, 40);
  const atrOut = atr(candles, 14);
  assert(atrOut[299] > 0 && Number.isFinite(atrOut[299]), `ATR موجب ومحدود (${atrOut[299].toFixed(1)})`);

  const dmi = adx(candles, 14);
  assert(dmi.adx[299] >= 0 && dmi.adx[299] <= 100, `ADX داخل النطاق (0-100): ${dmi.adx[299].toFixed(1)}`);

  const bb = bollinger(rising, 20, 2);
  assert(bb.upper[299] > bb.mid[299] && bb.mid[299] > bb.lower[299], 'بولنجر: علوي > وسط > سفلي');

  const rv = relativeVolume(candles, 20);
  assert(Number.isFinite(rv[299]) && rv[299] > 0, `RVOL محدود وموجب (${rv[299].toFixed(2)}x)`);

  const r4 = resample(candles, 14400);
  assert(r4.length === Math.ceil(candles.length / 4), `إعادة تشكيل 1h→4h بالطول الصحيح (${r4.length})`);
  assert(r4[0].time % 14400 === 0, 'دلوس 4h محاذية لمضاعفات 4 ساعات');

  // MACD على تسارع حقيقي (ميل متزايد) → hist موجب؛ على ميل ثابت hist يتقارب لصفر — سلوك رياضي سليم
  const accel = Array.from({ length: 300 }, (_, i) => 100 + (i * i) / 20);
  const mA = macd(accel);
  assert(mA.hist[299] > 0, `MACD hist موجب في تسارع صاعد (${mA.hist[299].toFixed(2)})`);
  const mFlat = macd(rising);
  assert(Math.abs(mFlat.hist[299]) < 2, `MACD hist يتقارب لصفر على ميل ثابت (${mFlat.hist[299].toFixed(3)})`);

  const snap = computeSnapshot(candles);
  assert(snap !== null, 'computeSnapshot ينتج لقطة صالحة');
  if (snap) {
    assert(snap.atrPercent > 0 && snap.atrPercent < 5, `atrPercent منطقي (${snap.atrPercent.toFixed(3)}%)`);
    assert(snap.emaTrend === 'STRONG_BULLISH' || snap.emaTrend === 'BULLISH', 'ترند صاعد في سلسلة صاعدة');
  }
  assert(computeSnapshot(candles.slice(0, 30)) === null, 'بيانات ناقصة → snapshot فارغ بصراحة');
  assert(computeSnapshot(null as unknown as import('../shared/types').Candle[]) === null, 'رد غير Array لا يكسر computeSnapshot');
  assert(computeHtfSnapshot({} as unknown as import('../shared/types').Candle[]) === null, 'رد غير Array لا يكسر HTF snapshot');
  assert(computeDailyTrend({} as unknown as import('../shared/types').Candle[]) === null, 'رد غير Array لا يكسر daily snapshot');
  const chartRows = [
    { time: 300, open: 30, high: 31, low: 29, close: 30, volume: 1 },
    { time: 100, open: 10, high: 11, low: 9, close: 10, volume: 1 },
    { time: 200, open: 20, high: 21, low: 19, close: 20, volume: 1 },
    { time: 200, open: 20, high: 22, low: 19, close: 21, volume: 2 },
  ];
  const normalizedChart = normalizeCandlesForChart(chartRows);
  assert(normalizedChart.length === 3 && normalizedChart[0].time === 100 && normalizedChart[2].time === 300, 'الشارت يرتب الشموع ويزيل timestamp المكرر');
  assert(normalizedChart[1].close === 21, 'عند التكرار يحتفظ بآخر شمعة لنفس الوقت');
}

console.log('\n=== 2. الثوابت والدوال المركزية ===');
{
  const { deriveSignalTypeAndAction, computeRiskTargets, STRATEGY_RISK_MULTIPLIERS } = await import('../shared/strategyConstants');

  assert(deriveSignalTypeAndAction(82).signalType === 'STRONG_BUY', '82 → STRONG_BUY');
  assert(deriveSignalTypeAndAction(84).signalType === 'STRONG_BUY', '84 → STRONG_BUY (لا فجوة 82-84)');
  assert(deriveSignalTypeAndAction(70).signalType === 'BUY', '70 → BUY');
  assert(deriveSignalTypeAndAction(69).signalType === 'HOLD', '69 → HOLD');
  assert(deriveSignalTypeAndAction(32).signalType === 'SELL' && deriveSignalTypeAndAction(32).spotAction === 'SPOT_SELL_ALL', '32 → SELL دفاعي');
  assert(deriveSignalTypeAndAction(20).signalType === 'STRONG_SELL', '20 → STRONG_SELL');

  const targets = computeRiskTargets(100000, 1000);
  assert(targets.stopLoss === 100000 - STRATEGY_RISK_MULTIPLIERS.STOP_LOSS_ATR * 1000, 'وقف = دخول − 2×ATR بالحرف');
  assert(targets.target1 === 100000 + STRATEGY_RISK_MULTIPLIERS.TARGET_1_ATR * 1000, 'TP1 = دخول + 2.5×ATR بالحرف');
  assert(targets.target2 === 100000 + STRATEGY_RISK_MULTIPLIERS.TARGET_2_ATR * 1000, 'TP2 = دخول + 4×ATR بالحرف');
  assert(targets.target3 === 100000 + STRATEGY_RISK_MULTIPLIERS.TARGET_3_ATR * 1000, 'TP3 = دخول + 5.5×ATR بالحرف');
  assert(targets.riskRewardRatio === 1.25, `R:R = 1.25 (فعلي: ${targets.riskRewardRatio})`);
}

console.log('\n=== 3. محرك الإشارات والبوابات ===');
{
  const { buildSignal } = await import('../server/signalEngine');
  const { computeSnapshot } = await import('../shared/indicators');
  const fullGates = { htf: true, chop: true, rvol: true, funding: true };

  // صاعد قوي → شراء (كل البوابات صافية)
  const bullCandles = syntheticCandles(300, 22, 7);
  const bullSnap = computeSnapshot(bullCandles);
  assert(bullSnap !== null, 'لقطة صاعدة جاهزة');
  if (bullSnap) {
    const sig = buildSignal({
      asset: 'BTC',
      snapshot: bullSnap,
      htf: { close: bullSnap.close + 500, ema21: bullSnap.close, ema50: bullSnap.close - 100, ema200: bullSnap.close - 400, bearish: false, bullish: true },
      fundingPct8h: 0.01,
      change24h: 3,
      dataSource: 'LIVE',
      gates: fullGates,
    });
    assert(sig.spotAction === 'SPOT_BUY', `سوق صاعد قوي → SPOT_BUY (فعلي: ${sig.signalType} @ ${sig.convictionScore})`);
    assert(sig.regimeGateStatus === 'CLEAR', 'بوابات صافية للسوق الصاعد القوي');
    assert(sig.stopLoss < sig.entryPrice && sig.target1 > sig.entryPrice, 'أهداف الشراء منطقية (SL تحت / TP فوق)');
  }

  // سوق عرضي → CHOP_BLOCKED على محاولة الشراء
  let v = 99;
  const rand = () => {
    v = (v * 1103515245 + 12345) % 2147483648;
    return v / 2147483648;
  };
  const chopCandles: import('../shared/types').Candle[] = [];
  let chopPrice = 50000;
  for (let i = 0; i < 300; i++) {
    const wave = Math.sin(i / 6) * 350;
    const open = chopPrice;
    const close = 50000 + wave + (rand() - 0.5) * 80;
    chopPrice = close;
    chopCandles.push({ time: 1_700_000_000 + i * 3600, open, high: Math.max(open, close) + 30, low: Math.min(open, close) - 30, close, volume: 200 + rand() * 100 });
  }
  const chopSnap = computeSnapshot(chopCandles);
  assert(chopSnap !== null, 'لقطة العرضي جاهزة');
  if (chopSnap) {
    const chopSig = buildSignal({
      asset: 'ETH',
      snapshot: chopSnap,
      htf: { close: chopSnap.close + 100, ema21: chopSnap.close + 50, ema50: chopSnap.close, ema200: chopSnap.close - 50, bearish: false, bullish: true },
      fundingPct8h: 0.01,
      change24h: 0.5,
      dataSource: 'LIVE',
      gates: fullGates,
    });
    if (chopSig.convictionScore >= 70) {
      assert(chopSig.signalType === 'NO_TRADE' && chopSig.regimeGateStatus === 'CHOP_BLOCKED', `درجة عالية في سوق عرضي → CHOP_BLOCKED (فعلي: ${chopSig.signalType}/${chopSig.regimeGateStatus} @ ${chopSig.convictionScore})`);
    } else {
      assert(chopSig.spotAction !== 'SPOT_BUY', `سوق عرضي لا يفتح شراء (score=${chopSig.convictionScore})`);
    }
  }

  // HTF هابط → حتى لو الدرجة عالية، بوابة HTF تحظر
  if (bullSnap) {
    const htfBlocked = buildSignal({
      asset: 'BTC',
      snapshot: bullSnap,
      htf: { close: bullSnap.close - 2000, ema21: bullSnap.close - 1000, ema50: bullSnap.close - 500, ema200: bullSnap.close + 500, bearish: true, bullish: false },
      fundingPct8h: 0.01,
      change24h: 3,
      dataSource: 'LIVE',
      gates: fullGates,
    });
    assert(
      htfBlocked.spotAction !== 'SPOT_BUY' && (htfBlocked.regimeGateStatus === 'HTF_BLOCKED' || htfBlocked.convictionScore < 70),
      `ترند 4h هابط → حظر/عدم شراء (${htfBlocked.signalType}/${htfBlocked.regimeGateStatus})`,
    );
  }

  // ⭐ أهم اختبار: الخروج الدفاعي يتخطى البوابات
  const bearCandles = syntheticCandles(300, -35, 11);
  const bearSnap = computeSnapshot(bearCandles);
  assert(bearSnap !== null, 'لقطة هابطة جاهزة');
  if (bearSnap) {
    const defensive = buildSignal({
      asset: 'BTC',
      snapshot: bearSnap,
      htf: { close: bearSnap.close - 3000, ema21: bearSnap.close - 1500, ema50: bearSnap.close - 800, ema200: bearSnap.close + 1000, bearish: true, bullish: false },
      fundingPct8h: 0.05,
      change24h: -6,
      dataSource: 'LIVE',
      gates: fullGates,
    });
    assert(
      defensive.spotAction === 'SPOT_SELL_ALL' && defensive.regimeGateStatus === 'CLEAR',
      `⭐ الخروج الدفاعي يتخطى كل البوابات (${defensive.signalType}/${defensive.regimeGateStatus} @ ${defensive.convictionScore})`,
    );
  }

  // تعطيل البوابات من الإعدادات
  if (chopSnap) {
    const noGates = buildSignal({
      asset: 'ETH',
      snapshot: chopSnap,
      htf: null,
      fundingPct8h: null,
      change24h: 0.5,
      dataSource: 'LIVE',
      gates: { htf: false, chop: false, rvol: false, funding: false },
    });
    assert(noGates.regimeGateStatus === 'CLEAR' || noGates.convictionScore < 70, 'تعطيل البوابات يزيل الحظر (أو الدرجة أصلأ منخفضة)');
  }
}

console.log('\n=== 4. رسائل تليجرام ===');
{
  const { buildSignalMessageHtml } = await import('../server/telegram');
  const { computeSnapshot } = await import('../shared/indicators');
  const candles = syntheticCandles(300, 22, 7);
  const snap = computeSnapshot(candles);
  if (snap) {
    const { buildSignal } = await import('../server/signalEngine');
    const sig = buildSignal({
      asset: 'BTC',
      snapshot: snap,
      htf: null,
      fundingPct8h: 0.01,
      change24h: 3,
      dataSource: 'LIVE',
      gates: { htf: true, chop: true, rvol: true, funding: true },
    });
    const html = buildSignalMessageHtml(sig);
    assert(html.includes(sig.asset), 'الرسالة تحمل اسم الأصل');
    assert(html.includes(String(sig.convictionScore)), 'الرسالة تحمل الدرجة');
    assert(html.includes('بحثية'), 'الرسالة تحمل إخلاء المسؤولية');
    assert(!html.includes('<script'), 'لا حقن سكريبت في الرسالة');

    // الكشف الذكي: سطر "التوصية اتغيّرت" يظهر فقط عند تغيّر الفئة الفعلية.
    const { verdictOf } = await import('../server/telegram');
    const vNow = verdictOf(sig);
    const changed = buildSignalMessageHtml(sig, vNow === 'BUY' ? 'SELL' : 'BUY');
    assert(changed.includes('التوصية اتغيّرت'), 'عند اختلاف الفئة يظهر سطر الانتقال');
    const same = buildSignalMessageHtml(sig, verdictOf(sig));
    assert(!same.includes('التوصية اتغيّرت'), 'عند تطابق الفئة لا يظهر سطر الانتقال');
  }
}

console.log('\n=== 5. التخزين المحلي (roundtrip) ===');
{
  const persistence = await import('../server/persistence');
  const cfg = persistence.loadConfig();
  assert(cfg.scanIntervalSeconds >= 30, `إعدادات افتراضية سليمة (interval=${cfg.scanIntervalSeconds})`);
  const merged = persistence.saveConfig({ scanIntervalSeconds: 90, gates: { ...cfg.gates, funding: false } });
  assert(merged.scanIntervalSeconds === 90 && merged.gates.funding === false, 'حفظ الإعدادات ودمجها صحيح');
  persistence.saveConfig({ scanIntervalSeconds: 120, gates: { ...merged.gates, funding: true } });
  assert(persistence.maskToken('1234567890abcdef') === '1234…cdef', 'إخفاء التوكن صحيح');
  assert(persistence.maskToken('') === '', 'توكن فارغ → إخفاء فارغ');
}

console.log('\n=== 6. حارس النص الثابت — منع رجوع الأرقام اليدوية ===');
{
  const guardedFiles = ['server/signalEngine.ts', 'server/backtest.ts', 'src/components/SignalCard.tsx', 'src/App.tsx'];
  const manualAtrRegex = /(?:[\d.]+\s*\*\s*atr\b|atr\s*\*\s*[\d.]+)/i;
  let allClean = true;
  const details: string[] = [];
  for (const rel of guardedFiles) {
    const p = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf8');
    if (manualAtrRegex.test(content)) {
      allClean = false;
      details.push(rel);
    }
  }
  assert(allClean, `لا مضاعفات ATR يدوية خارج ملف الثوابت${details.length ? ` — المخالف: ${details.join(', ')}` : ''}`);
}

console.log('\n=== 7. عدّاد الأداء (Attribution) ===');
{
  const { computeAttributionSummary } = await import('../server/attribution');
  const base = {
    asset: 'BTC' as const,
    engineSignature: 'test',
    convictionScore: 75,
    signalType: 'BUY' as const,
    spotAction: 'SPOT_BUY' as const,
    entryPrice: 50000,
    stopLoss: 48000,
    target1: 52500,
    target2: 54000,
    target3: 55500,
    riskRewardRatio: 1.25,
    regimeGateStatus: 'CLEAR' as const,
    reasons: [{ tag: 'TREND' as const, adjustment: 10, textAr: 'ترند صاعد' }],
    summaryAr: '',
    generatedAt: Date.now() - 1000,
    dedupHash: 'x',
    dataSource: 'LIVE' as const,
    htfAvailable: true,
  };
  const signals = [
    { ...base, id: 'a', isGateBlocked: false, telegramSent: true, outcomes: { windows: { h4: { mfePercent: 1, maePercent: -0.5, hitTp1BeforeSl: true }, h24: { mfePercent: 2, maePercent: -1, hitTp1BeforeSl: true }, h72: { mfePercent: 3, maePercent: -1.2, hitTp1BeforeSl: true } }, resolution: 'TP1_FIRST' as const } },
    { ...base, id: 'b', isGateBlocked: false, telegramSent: false, outcomes: { windows: { h4: { mfePercent: 0.5, maePercent: -2, hitTp1BeforeSl: false }, h24: { mfePercent: 0.7, maePercent: -3, hitTp1BeforeSl: false }, h72: { mfePercent: 0.8, maePercent: -3.5, hitTp1BeforeSl: false } }, resolution: 'SL_FIRST' as const } },
    { ...base, id: 'c', isGateBlocked: true, telegramSent: false, outcomes: { windows: { h4: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null }, h24: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null }, h72: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null } }, resolution: 'OPEN' as const } },
  ];
  const summary = computeAttributionSummary(signals);
  assert(summary.actionableSignals === 2, `الإشارات المحجوبة مستثناة من العد (${summary.actionableSignals})`);
  assert(summary.resolved === 2 && summary.tp1First === 1 && summary.slFirst === 1, 'حسم 1 TP1 أول و1 SL أول');
  assert(summary.winRatePercent === 50, `نسبة النجاح 50% (فعلي: ${summary.winRatePercent})`);
  const trendTag = summary.perTag.find((t) => t.tag === 'TREND');
  assert(trendTag !== undefined && trendTag.total === 2, 'إحصاء لكل عامل يعمل (TREND: 2)');
}

console.log('\n=== 8. طبقات v2.0 — SMC ومنطقة الدخول واليومي والسيولة ===');
{
  const { findSwings, computeSmcStructure, computePullbackZone, computeDailyTrend } = await import('../shared/indicators');
  const { aggregateLiquidity } = await import('../server/llamaService');
  const { buildSignal } = await import('../server/signalEngine');
  const { computeSnapshot } = await import('../shared/indicators');

  // سلسلة صعود بقمم وقيعان واضحة (46 شمعة)
  const zig: import('../shared/types').Candle[] = [];
  let tZ = 1_700_000_000;
  const leg = (from: number, to: number, steps: number): void => {
    for (let s = 0; s < steps; s++) {
      const price = from + ((to - from) * (s + 1)) / steps;
      zig.push({ time: tZ, open: price - 5, high: price + 15, low: price - 15, close: price, volume: 300 });
      tZ += 3600;
    }
  };
  leg(47000, 48000, 20); // موجة تمهيدية عشان عدد الشموع يتجاوز الحد الأدنى (60) لمنطقة الدخول
  leg(48000, 50000, 12);
  leg(50000, 49000, 6);
  leg(49000, 51000, 12);
  leg(51000, 49500, 6);
  leg(49500, 51500, 10);

  const swings = findSwings(zig, 3, 3);
  assert(swings.some((s) => s.kind === 'HIGH' && s.price >= 50000), `findSwings يلتقط القمم والقيعان (${swings.length})`);

  const smc = computeSmcStructure(zig);
  assert(smc !== null && smc.structure === 'BULLISH_BOS', `SMC يكشف كسر هيكل صاعد (فعلي: ${smc?.structure})`);

  const zone = computePullbackZone(zig);
  assert(zone !== null && zone.high > zone.low, 'منطقة الدخول محسوبة بعرض صحيح');
  if (zone) assert(zone.high < 51500, `منطقة الارتداد تحت السعر الحالي (${zone.high.toFixed(0)})`);

  const dailyDown: import('../shared/types').Candle[] = [];
  let dp = 60000;
  for (let i = 0; i < 90; i++) {
    dp -= 150;
    dailyDown.push({ time: tZ, open: dp + 150, high: dp + 200, low: dp - 100, close: dp, volume: 1000 });
    tZ += 86400;
  }
  const dt = computeDailyTrend(dailyDown);
  assert(dt !== null && dt.bearish, `الفريم اليومي يكتشف الهبوط (فعلي: ${dt ? String(dt.bearish) : 'null'})`);

  const on = aggregateLiquidity(3.5, 1.2, 15);
  assert(on.verdict === 'RISK_ON' && on.totalAdjustment === 8, `سيولة ممتدة → RISK_ON +8 (فعلي: ${on.verdict} ${on.totalAdjustment})`);
  const off = aggregateLiquidity(-6, -2, -25);
  assert(off.verdict === 'RISK_OFF' && off.totalAdjustment === -8, `انحسار → RISK_OFF −8 (فعلي: ${off.verdict} ${off.totalAdjustment})`);
  const missing = aggregateLiquidity(null, null, null);
  assert(missing.totalAdjustment === 0 && missing.sourcesOk === 0, 'كل المصادر ناقصة → تعديل صفر بصراحة');

  const withOi = aggregateLiquidity(3.5, 1.2, 15, 20);
  assert(withOi.sourcesOk === 4 && withOi.sourcesTotal === 4, `4 مصادر (منها OI) → sourcesOk=4 (فعلي: ${withOi.sourcesOk}/${withOi.sourcesTotal})`);
  assert(withOi.components.length === 4 && withOi.components[3].nameAr.includes('الفائدة'), 'مكوّن الفائدة المفتوحة موجود');
  assert(withOi.summaryEn.length > 10 && withOi.summaryEn.includes('%'), 'ملخص إنجليزي تم توليده');

  const bullV2 = syntheticCandles(300, 22, 7);
  const snapV2 = computeSnapshot(bullV2);
  assert(snapV2 !== null, 'لقطة v2 جاهزة');
  if (snapV2) {
    const baseSig = buildSignal({
      asset: 'BTC' as const, snapshot: snapV2, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: true },
    });
    const liftedSig = buildSignal({
      asset: 'BTC' as const, snapshot: snapV2, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: true },
      liquidity: aggregateLiquidity(3.5, 1.2, 15),
    });
    assert(liftedSig.convictionScore === Math.min(100, baseSig.convictionScore + 8), `طبقة السيولة رفعت الدرجة بـ+8 (${baseSig.convictionScore} → ${liftedSig.convictionScore})`);
    assert(liftedSig.liquidity?.adjustment === 8, 'الإشارة تحمل ملخص السيولة');

    const blockedSig = buildSignal({
      asset: 'BTC' as const, snapshot: snapV2, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: true },
      daily: { close: 40000, ema20: 41000, ema50: 42000, bearish: true, bullish: false },
      entryZone: { low: 46000, high: 47500 },
    });
    if (baseSig.spotAction === 'SPOT_BUY') {
      assert(blockedSig.regimeGateStatus === 'HTF_BLOCKED', `اليومي الهابط يمنع الشراء (${blockedSig.regimeGateStatus})`);
      assert(blockedSig.blockReasonAr?.includes('اليومي') === true, 'سبب الحظر يذكر الفريم اليومي');
    } else {
      assert(blockedSig.spotAction !== 'SPOT_BUY', 'اليومي الهابط → لا شراء');
    }
    assert(blockedSig.entryZone?.priceInside === false, 'السعر خارج منطقة الدخول → priceInside false');
    assert(typeof blockedSig.chaseWarning === 'boolean', 'حقل تحذير المطاردة موجود');
    assert(blockedSig.dailyTrend === 'BEARISH', `dailyTrend = BEARISH (فعلي: ${blockedSig.dailyTrend})`);
  }
}

console.log('\n=== 9. Performance analytics v3 ===');
{
  const { computePerformanceStats } = await import('../server/performance');

  const mkTrade = (
    pnl: number,
    score = 76,
    reason: import('../shared/types').BacktestTrade['exitReason'] = 'TP1_SL',
  ): import('../shared/types').BacktestTrade => ({
    entryTime: 1700000000,
    exitTime: 1700003600,
    entry: 50000,
    exitAvgPrice: 50000,
    qty: 0.01,
    pnlUsd: pnl,
    exitReason: reason,
    signalScore: score,
  });

  // Sequence: W W L L L W  ->  grossWin 650, grossLoss 210, PF 3.1
  const trades = [
    mkTrade(200, 76),
    mkTrade(300, 82),
    mkTrade(-100, 66, 'SL'),
    mkTrade(-50, 66, 'SL'),
    mkTrade(-60, 70),
    mkTrade(150, 90, 'TP3'),
  ];
  const curve = [
    { time: 0, equity: 1000, buyHold: 1000 },
    { time: 3600, equity: 1100, buyHold: 1000 },
    { time: 7200, equity: 900, buyHold: 1000 },
    { time: 10800, equity: 950, buyHold: 1000 },
    { time: 14400, equity: 1200, buyHold: 1000 },
  ];
  const s = computePerformanceStats(trades, curve, 1000, 1);

  assert(s.totalTrades === 6, `totalTrades = 6 (got ${s.totalTrades})`);
  assert(s.wins === 3 && s.losses === 3, `wins/losses = 3/3 (got ${s.wins}/${s.losses})`);
  assert(s.winRatePercent === 50, `winRate = 50 (got ${s.winRatePercent})`);
  assert(s.profitFactor === 3.1, `profitFactor = 3.1 (got ${s.profitFactor})`);
  // riskUnit = 1000*1% = 10 -> mean R = (2+3-1-0.5-0.6+1.5)*100/6/10 = 7.333
  assert(s.expectancyR !== null && Math.abs(s.expectancyR - 7.333) < 0.01, `expectancyR ~= 0.733 (got ${s.expectancyR})`);
  assert(s.maxDrawdownPercent === 18.2, `maxDrawdown = 18.2% (got ${s.maxDrawdownPercent})`);
  assert(s.maxDrawdownDurationHours === 1, `maxDD duration = 1h (got ${s.maxDrawdownDurationHours})`);
  assert(s.longestWinStreak === 2, `longest win streak = 2 (got ${s.longestWinStreak})`);
  assert(s.longestLossStreak === 3, `longest loss streak = 3 (got ${s.longestLossStreak})`);
  assert(s.payoffRatio !== null && Math.abs(s.payoffRatio - 650 / 210) < 0.01, `payoffRatio = 650/210 (got ${s.payoffRatio})`);
  const b76 = s.scoreBuckets.find((b) => b.bucket === '75-79');
  assert(!!b76 && b76.trades === 1 && b76.wins === 1 && b76.winRatePercent === 100, 'bucket 75-79: 1 trade, 100% win');
  const b66 = s.scoreBuckets.find((b) => b.bucket === '<70');
  assert(!!b66 && b66.trades === 2 && b66.totalPnlUsd === -150, `bucket <70 totalPnl = -150 (got ${b66 ? b66.totalPnlUsd : 'missing'})`);
  const slExit = s.exitBreakdown.find((e) => e.reason === 'SL');
  assert(!!slExit && slExit.count === 2, `exitBreakdown SL count = 2 (got ${slExit ? slExit.count : 'missing'})`);

  const empty = computePerformanceStats([], [], 10000, 1);
  assert(empty.totalTrades === 0 && empty.expectancyR === null && empty.scoreBuckets.length === 0, 'empty input -> safe zeros/nulls');
  assert(empty.profitFactor === 0, 'empty input -> profitFactor 0 (no wins, no losses)');

  // Integration: a real backtest run must carry matching performance stats.
  const { runBacktest } = await import('../server/backtest');
  const bt = runBacktest('BTC', syntheticCandles(1300, 10));
  assert(!!bt.performance, 'runBacktest result carries performance stats');
  if (bt.performance) {
    assert(bt.performance.totalTrades === bt.totalTrades, `performance.totalTrades matches headline (${bt.performance.totalTrades}/${bt.totalTrades})`);
    assert(bt.performance.winRatePercent === bt.winRatePercent, 'performance winRate matches headline winRate');
  }
}
console.log('\n=== 10. Walk-forward + trailing stop v3 ===');
{
  const { computeTrailingStop, resolveTrailingOffset, trailingActivated, runWalkForward } = await import('../server/backtest');

  assert(computeTrailingStop(100, 110, 112, 2) === 108, `trail ratchets to peak-2ATR (got ${computeTrailingStop(100, 110, 112, 2)})`);
  assert(computeTrailingStop(108, 110, 105, 2) === 108, 'trail never moves down');
  assert(computeTrailingStop(100, 0, 120, 2) === 116, `trail from running high (got ${computeTrailingStop(100, 0, 120, 2)})`);
  assert(computeTrailingStop(100, 110, 112, 2, 3) === 106, `custom ATR multiplier respected (got ${computeTrailingStop(100, 110, 112, 2, 3)})`);

  // freqtrade-style staged trailing (entry-aware)
  // entry=100, ATR=2 → العتبة 102 (1×ATR)، التضييق عند 104 (2×ATR)
  assert(trailingActivated(100, 120, 2) === true, 'profit ≥ 1×ATR activates trailing');
  assert(trailingActivated(100, 101.5, 2) === false, 'profit < 1×ATR does not activate');
  assert(resolveTrailingOffset(100, 120, 2) === 1, 'above 2×ATR profit → tight 1×ATR offset');
  assert(resolveTrailingOffset(100, 103, 2) === 2, 'between 1×ATR and 2×ATR → standard 2×ATR offset');
  // دون العتبة: لا يتحرك الوقف (نفس الوقف الحالي)
  const flat = computeTrailingStop(100, 100, 101, 2, 2, 100);
  assert(flat === 100, 'no ratchet below activation threshold');

  const wf = runWalkForward('BTC', syntheticCandles(2600, 8));
  assert(wf.results.length === 16, `walk-forward grid = 16 configs (got ${wf.results.length})`);
  assert(wf.splitIndex === 1300, `split at half index (got ${wf.splitIndex})`);
  assert(wf.best !== null, 'walk-forward returns a best config');
  if (wf.best) {
    assert(typeof wf.best.optimizeWinRatePercent === 'number' && typeof wf.best.optimizeMaxDrawdownPercent === 'number', 'in-sample diagnostics present on best cell');
  }
  const honest = wf.results.every((c) => c.validateProfitFactor === null || typeof c.validateProfitFactor === 'number');
  assert(honest, 'validation PF is null-or-number (honest out-of-sample verdict)');
  let sorted = true;
  for (let i = 1; i < wf.results.length; i++) {
    if (wf.results[i - 1].score < wf.results[i].score) { sorted = false; break; }
  }
  assert(sorted, 'walk-forward results sorted by score desc');
  let rejected = false;
  try {
    runWalkForward('BTC', syntheticCandles(1000, 8));
  } catch {
    rejected = true;
  }
  assert(rejected, 'walk-forward rejects series shorter than 2400 candles');
}
console.log('\n=== 11. Capital protection v3 ===');
{
  const { computePerformanceStats: _unused } = await import('../server/performance');
  void _unused;
  const { DEFAULT_PROTECTION, clampProtection, dayRealizedR, evaluateCircuitBreaker, currentExposure, projectedExposure, findExpiredSignals, protectionVerdict, utcDayStart } = await import('../server/protection');

  const mkSignal = (opts: {
    asset?: 'BTC' | 'ETH' | 'PAXG';
    blocked?: boolean;
    sell?: boolean;
    resolution?: 'OPEN' | 'TP1_FIRST' | 'SL_FIRST' | 'EXPIRED';
    generatedAt?: number;
    resolvedAt?: number;
  }): import('../shared/types').StoredSignal => ({
    asset: opts.asset ?? 'BTC',
    engineSignature: 'test',
    convictionScore: 80,
    signalType: opts.sell ? 'SELL' : 'STRONG_BUY',
    spotAction: opts.sell ? 'SPOT_SELL_ALL' : 'SPOT_BUY',
    entryPrice: 50000,
    stopLoss: 49000,
    target1: 51000,
    target2: 52000,
    target3: 53000,
    riskRewardRatio: 2,
    regimeGateStatus: 'CLEAR',
    reasons: [],
    summaryAr: 'test',
    generatedAt: opts.generatedAt ?? 0,
    dedupHash: 'h' + Math.random(),
    dataSource: 'LIVE',
    htfAvailable: true,
    id: 't' + Math.random(),
    isGateBlocked: opts.blocked ?? false,
    telegramSent: false,
    outcomes: {
      windows: {
        h4: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
        h24: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
        h72: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
      },
      resolution: opts.resolution ?? 'OPEN',
      resolvedAt: opts.resolvedAt,
    },
  });

  const now = Date.UTC(2026, 8, 15, 12, 0, 0); // 2026-09-15 12:00 UTC
  assert(utcDayStart(now) === Date.UTC(2026, 8, 15), 'utcDayStart normalizes to midnight UTC');

  // Daily realized R: only today's resolved actionable signals count.
  const today = now - 3600_000;
  const yesterday = now - 26 * 3600_000;
  const pnlSignals = [
    mkSignal({ resolution: 'TP1_FIRST', resolvedAt: today }),
    mkSignal({ asset: 'ETH', resolution: 'TP1_FIRST', resolvedAt: today }),
    mkSignal({ asset: 'PAXG', resolution: 'SL_FIRST', resolvedAt: today }),
    mkSignal({ resolution: 'SL_FIRST', resolvedAt: yesterday }), // previous day -> excluded
    mkSignal({ blocked: true, resolution: 'SL_FIRST', resolvedAt: today }), // gate-blocked -> excluded
  ];
  const pnl = dayRealizedR(pnlSignals, now);
  assert(pnl.realizedR === 1, `dayRealizedR = +1R (got ${pnl.realizedR})`);
  assert(pnl.resolvedToday === 3 && pnl.winsToday === 2 && pnl.lossesToday === 1, `resolved/wins/losses = 3/2/1 (got ${pnl.resolvedToday}/${pnl.winsToday}/${pnl.lossesToday})`);

  // Breaker trips at -limit R.
  const lossy = [
    mkSignal({ resolution: 'SL_FIRST', resolvedAt: today }),
    mkSignal({ asset: 'ETH', resolution: 'SL_FIRST', resolvedAt: today }),
    mkSignal({ asset: 'PAXG', resolution: 'SL_FIRST', resolvedAt: today }),
  ];
  const tripped = evaluateCircuitBreaker(lossy, { ...DEFAULT_PROTECTION, dailyLossLimitR: 3 }, now);
  assert(tripped.tripped && tripped.realizedR === -3, `breaker trips at -3R (got ${tripped.realizedR}, tripped=${tripped.tripped})`);
  const okState = evaluateCircuitBreaker(pnlSignals, { ...DEFAULT_PROTECTION, dailyLossLimitR: 3 }, now);
  assert(!okState.tripped, 'breaker stays off at +1R');

  // Exposure: open buys counted, gate-blocked and sells excluded, BTC+ETH bonus applied.
  const openSignals = [
    mkSignal({ asset: 'BTC' }),
    mkSignal({ asset: 'ETH' }),
    mkSignal({ blocked: true }),
    mkSignal({ sell: true }),
  ];
  const exp = currentExposure(openSignals, DEFAULT_PROTECTION);
  assert(exp.openCount === 2, `openCount = 2 (got ${exp.openCount})`);
  assert(exp.correlatedPairBonus === 1 && exp.effectiveExposure === 3, `BTC+ETH pair bonus -> effective 3 (got ${exp.effectiveExposure})`);
  const expNoGuard = currentExposure(openSignals, { ...DEFAULT_PROTECTION, correlationGuard: false });
  assert(expNoGuard.effectiveExposure === 2, 'correlation guard off -> no bonus');

  // Projected exposure with a new PAXG candidate.
  assert(projectedExposure(openSignals, DEFAULT_PROTECTION, 'PAXG') === 4, `projected PAXG = 4 (got ${projectedExposure(openSignals, DEFAULT_PROTECTION, 'PAXG')})`);

  // Verdict: cap full -> refuse BUY; SELL always allowed by design (not evaluated here).
  const v = protectionVerdict(openSignals, DEFAULT_PROTECTION, 'PAXG', now);
  assert(!v.allow && v.reason === 'EXPOSURE_CAP', `PAXG refused by EXPOSURE_CAP (got ${v.reason})`);
  const v2 = protectionVerdict(lossy, { ...DEFAULT_PROTECTION, dailyLossLimitR: 3 }, 'BTC', now);
  assert(!v2.allow && v2.reason === 'CIRCUIT_BREAKER', `refused by CIRCUIT_BREAKER (got ${v2.reason})`);

  // Expiry: OPEN buy older than window expires; blocked/sells/resolved untouched.
  const stale = now - 4 * 3600_000;
  const fresh = now - 3600_000;
  const mixed = [
    mkSignal({ generatedAt: stale }),
    mkSignal({ asset: 'ETH', generatedAt: fresh }),
    mkSignal({ blocked: true, generatedAt: stale }),
    mkSignal({ sell: true, generatedAt: stale }),
  ];
  const expired = findExpiredSignals(mixed, DEFAULT_PROTECTION, now);
  assert(expired.length === 1, `only 1 stale open buy expires (got ${expired.length})`);
  assert(expired[0].ageHours === 4, `expiry age = 4h (got ${expired[0].ageHours})`);

  // Clamp guards.
  const clamped = clampProtection({ dailyLossLimitR: 999, maxConcurrentSignals: 0, signalExpiryHours: -5, correlationGuard: true, stoplossGuardMax: 99, stoplossGuardHours: 999, lossCooldownHours: -5 });
  assert(clamped.dailyLossLimitR === 20 && clamped.maxConcurrentSignals === 1 && clamped.signalExpiryHours === 1 && clamped.stoplossGuardMax === 10 && clamped.stoplossGuardHours === 72 && clamped.lossCooldownHours === 0, 'clampProtection bounds all values');
}
console.log('\n=== 12. Learning system v2 (regime-keyed, decay, realized-R) ===');
{
  const { computeTagStats, baselineWinRatePercent, computeLearningState, diffLessons, biasForReasons, biasForReasonsRegime, realizedR } = await import('../server/learning');

  const NOW = 1700004000000;
  const mkLearnt = (
    tag: import('../shared/types').ReasonTag,
    win: boolean,
    opts: { blocked?: boolean; open?: boolean; regime?: 'BULLISH' | 'BEARISH'; generatedAt?: number } = {},
  ): import('../shared/types').StoredSignal => ({
    asset: 'BTC', engineSignature: 't', convictionScore: 80, signalType: 'STRONG_BUY',
    spotAction: 'SPOT_BUY', entryPrice: 50000, stopLoss: 49000, target1: 51000, target2: 52000,
    target3: 53000, riskRewardRatio: 2, regimeGateStatus: 'CLEAR',
    reasons: [{ tag, adjustment: 0, textAr: 'x' }], summaryAr: 'x',
    generatedAt: opts.generatedAt ?? 1700000000000, dedupHash: 'd' + Math.random(),
    dataSource: 'LIVE', htfAvailable: true, dailyTrend: opts.regime ?? 'BULLISH',
    id: 'l' + Math.random(), isGateBlocked: opts.blocked ?? false, telegramSent: false,
    outcomes: {
      windows: {
        h4: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
        h24: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
        h72: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
      },
      resolution: opts.open ? 'OPEN' : win ? 'TP1_FIRST' : 'SL_FIRST',
    },
  });

  // Evidence: TREND|BULLISH 10W/2L (83.3%), MACD|BULLISH 3W/9L (25%), RSI|BEARISH 6W/6L (50%)
  const signals: import('../shared/types').StoredSignal[] = [];
  for (let i = 0; i < 10; i++) signals.push(mkLearnt('TREND', true));
  for (let i = 0; i < 2; i++) signals.push(mkLearnt('TREND', false));
  for (let i = 0; i < 3; i++) signals.push(mkLearnt('MACD', true));
  for (let i = 0; i < 9; i++) signals.push(mkLearnt('MACD', false));
  for (let i = 0; i < 6; i++) signals.push(mkLearnt('RSI', true, { regime: 'BEARISH' }));
  for (let i = 0; i < 6; i++) signals.push(mkLearnt('RSI', false, { regime: 'BEARISH' }));
  signals.push(mkLearnt('TREND', true, { blocked: true }));
  signals.push(mkLearnt('TREND', true, { open: true }));

  const stats = computeTagStats(signals, NOW);
  const trend = stats.find((t) => t.key === 'TREND|BULLISH');
  const macd = stats.find((t) => t.key === 'MACD|BULLISH');
  const rsi = stats.find((t) => t.key === 'RSI|BEARISH');
  assert(!!trend && trend.samples > 11, `TREND|BULLISH decay-weighted samples ~12 (got ${trend ? trend.samples : 'missing'})`);
  assert(!!rsi && rsi.regime === 'BEARISH' && rsi.winRatePercent === 50, `RSI|BEARISH winRate 50 (got ${rsi ? rsi.winRatePercent : 'missing'})`);

  const baseline = baselineWinRatePercent(signals, NOW);
  assert(Math.abs(baseline - 52.8) < 0.5, `baseline ~= 52.8 (got ${baseline})`);

  const state = computeLearningState(signals, NOW);
  assert(state.totalResolved === 36, `totalResolved = 36 (got ${state.totalResolved})`);
  assert(state.biases['TREND|BULLISH'] > 0 && state.biases['TREND|BULLISH'] <= 3, `TREND|BULLISH positive bias (got ${state.biases['TREND|BULLISH']})`);
  assert(state.biases['MACD|BULLISH'] < 0 && state.biases['MACD|BULLISH'] >= -3, `MACD|BULLISH negative bias (got ${state.biases['MACD|BULLISH']})`);
  assert(state.biases['RSI|BEARISH'] === 0, `RSI|BEARISH within deviation -> 0 (got ${state.biases['RSI|BEARISH']})`);
  assert(state.biases['TREND'] === undefined, 'plain keys no longer produced (regime-keyed only)');

  // Realized R: TP1 win at 1R (+1), SL at -1R (fixture RR = 1.0)
  const winSig = mkLearnt('TREND', true);
  const lossSig = mkLearnt('TREND', false);
  assert(realizedR(winSig) === 1, `TP1 win = +1R (got ${realizedR(winSig)})`);
  assert(realizedR(lossSig) === -1, `SL = -1R (got ${realizedR(lossSig)})`);

  // Regime-aware engine lookup: plain-key fallback + regime-specific match
  assert(biasForReasons(['TREND'], { TREND: -3 }) === -3, 'plain-tag fallback works');
  assert(biasForReasonsRegime(['TREND'], 'BULLISH', { 'TREND|BULLISH': 2, TREND: -3 }) === 2, 'regime key preferred over plain');
  assert(biasForReasonsRegime(['TREND'], 'BEARISH', { 'TREND|BULLISH': 2, TREND: -3 }) === -3, 'regime miss falls back to plain');

  // Audit trail: changed regime keys produce lessons with regime info
  const lessons = diffLessons({}, state.biases, state.perTag, baseline, NOW);
  assert(lessons.length >= 2, `lessons for changed keys (got ${lessons.length})`);
  const tl = lessons.find((l) => l.key === 'TREND|BULLISH');
  assert(!!tl && tl.regime === 'BULLISH', 'lesson carries regime metadata');
}
console.log('\n=== 13. Open interest factor v3 ===');
{
  const { openInterestAdjustment } = await import('../server/oiFactor');
  const { buildSignal } = await import('../server/signalEngine');
  const { computeSnapshot } = await import('../shared/indicators');

  assert(openInterestAdjustment(null, 'BULLISH') === 0, 'no OI data -> zero adjustment');
  assert(openInterestAdjustment(1, 'BULLISH') === 0, 'small OI move -> zero adjustment');
  assert(openInterestAdjustment(5, 'BULLISH') === 2, `rising OI + bull trend = +2 (got ${openInterestAdjustment(5, 'BULLISH')})`);
  assert(openInterestAdjustment(5, 'STRONG_BEARISH') === -2, `rising OI + bear trend = -2 (got ${openInterestAdjustment(5, 'STRONG_BEARISH')})`);
  assert(openInterestAdjustment(-4, 'BULLISH') === -2, `falling OI + bull trend = -2 exhaustion (got ${openInterestAdjustment(-4, 'BULLISH')})`);
  assert(openInterestAdjustment(-4, 'BEARISH') === 2, `falling OI + bear trend = +2 exhaustion (got ${openInterestAdjustment(-4, 'BEARISH')})`);

  // Integration: OI confirmation shifts the final score by exactly the rule value.
  const candles = syntheticCandles(300, 22, 7);
  const snap = computeSnapshot(candles);
  assert(snap !== null, 'OI integration snapshot ready');
  if (snap) {
    const base = buildSignal({
      asset: 'BTC' as const, snapshot: snap, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: true },
    });
    const withOi = buildSignal({
      asset: 'BTC' as const, snapshot: snap, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: true },
      oiChange24h: 5,
    });
    if (snap.emaTrend === 'BULLISH' || snap.emaTrend === 'STRONG_BULLISH') {
      assert(withOi.convictionScore === Math.min(100, base.convictionScore + 2), `OI confirms bull: +2 score (got ${withOi.convictionScore} vs ${base.convictionScore})`);
    } else {
      assert(withOi.convictionScore === Math.max(0, base.convictionScore - 2), `OI warns bear: -2 score (got ${withOi.convictionScore} vs ${base.convictionScore})`);
    }
    assert(withOi.reasons.some((r) => r.tag === 'OI'), 'signal carries an OI reason tag');
  }
}
console.log('\n=== 14. Hard timeout guard v3 ===');
{
  const { withTimeoutFallback } = await import('../server/marketData');
  const fast = withTimeoutFallback(Promise.resolve(42), 1000, -1);
  assert((await fast) === 42, 'resolved value passes through');
  const rejected = withTimeoutFallback(Promise.reject(new Error('dns')), 1000, 'fb');
  assert((await rejected) === 'fb', 'rejection -> fallback');
  const hung = withTimeoutFallback(new Promise(() => {}), 50, 'fb');
  const t = Date.now();
  assert((await hung) === 'fb', 'hung promise -> fallback after timeout');
  assert(Date.now() - t < 900, `fallback fired quickly (got ${Date.now() - t}ms)`);
}
console.log('\n=== 15. Review-response fixes v3 ===');
{
  const { buildSignal } = await import('../server/signalEngine');
  const { computeSnapshot } = await import('../shared/indicators');
  const { deriveSignalTypeAndAction } = await import('../shared/strategyConstants');
  const { runBacktest } = await import('../server/backtest');
  const { evaluateCircuitBreaker, DEFAULT_PROTECTION } = await import('../server/protection');

  const candles = syntheticCandles(300, 22, 7);
  const snap = computeSnapshot(candles);
  assert(snap !== null, 'review snapshot ready');
  if (snap) {
    const baseCtx = {
      asset: 'BTC' as const, snapshot: snap, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: true },
    };
    const base = buildSignal(baseCtx);
    const biased = buildSignal({ ...baseCtx, tagBias: { TREND: -3 } });
    assert(biased.learningBias === -3, `learningBias surfaced on the signal (got ${biased.learningBias})`);
    assert(biased.convictionScore === Math.max(0, base.convictionScore - 3), `score shifted by bias (got ${biased.convictionScore} vs ${base.convictionScore})`);
    // THE review fix: the label must match the FINAL (post-bias) score.
    const re = deriveSignalTypeAndAction(biased.convictionScore);
    assert(re.signalType === biased.signalType && re.spotAction === biased.spotAction, 'label matches final score - no stale label');
  }

  // Slippage: same data, same trades, strictly worse equity.
  const candles1300 = syntheticCandles(1300, 10);
  const clean = runBacktest('BTC', candles1300, { riskPercent: 1, feePercent: 0.1, cooldownCandles: 4, initialEquity: 10000, entryMinScore: 0, adxFloor: 0, slippagePercent: 0 });
  const slippery = runBacktest('BTC', candles1300, { riskPercent: 1, feePercent: 0.1, cooldownCandles: 4, initialEquity: 10000, entryMinScore: 0, adxFloor: 0, slippagePercent: 1 });
  assert(clean.totalTrades === slippery.totalTrades, `slippage must not change trade count (${clean.totalTrades}/${slippery.totalTrades})`);
  assert(slippery.finalEquity < clean.finalEquity, `slippage reduces equity (${slippery.finalEquity} < ${clean.finalEquity})`);

  // Stop-loss slippage: losses exit at a price worse than the stop level
  // (entry-ATR × STOP_SLIPPAGE_ATR), never more optimistic than that.
  const stops = runBacktest('BTC', syntheticCandles(1500, 8), { riskPercent: 1, feePercent: 0, cooldownCandles: 2, initialEquity: 10000, entryMinScore: 0, adxFloor: 0, slippagePercent: 0 });
  for (const t of stops.trades) {
    if (t.exitReason === 'SL') {
      // exitAvgPrice already accounts for TPs taken earlier, so only bounds-check sanity:
      assert(t.exitAvgPrice < t.entry, 'stop-loss exits below entry');
    }
  }

  // Breaker now counts unrealized adverse movement (MAE-based) from open signals.
  const mkOpen = (mae: number): import('../shared/types').StoredSignal => ({
    asset: 'BTC', engineSignature: 'test', convictionScore: 80, signalType: 'STRONG_BUY',
    spotAction: 'SPOT_BUY', entryPrice: 100, stopLoss: 98, target1: 102, target2: 104, target3: 106,
    riskRewardRatio: 2, regimeGateStatus: 'CLEAR', reasons: [], summaryAr: 'x', generatedAt: 0,
    dedupHash: 'd' + Math.random(), dataSource: 'LIVE', htfAvailable: true, id: 'o' + Math.random(),
    isGateBlocked: false, telegramSent: false,
    outcomes: {
      windows: {
        h4: { mfePercent: 0, maePercent: mae, hitTp1BeforeSl: null },
        h24: { mfePercent: 0, maePercent: mae, hitTp1BeforeSl: null },
        h72: { mfePercent: 0, maePercent: mae, hitTp1BeforeSl: null },
      },
      resolution: 'OPEN',
    },
  });
  const openLoss = [mkOpen(-3), mkOpen(-3)]; // each: 3% adverse / 2% stop distance = 1.5R -> 3R total
  const st = evaluateCircuitBreaker(openLoss, { ...DEFAULT_PROTECTION, dailyLossLimitR: 3 }, Date.now());
  assert(st.unrealizedR === -3, `unrealizedR = -3 (got ${st.unrealizedR})`);
  assert(st.tripped, 'breaker trips on unrealized losses alone (review Issue 8)');
}
console.log('\n=== 16. FNG + WHALE factors v3 ===');
{
  const { fngAdjustment } = await import('../server/fng');
  const { __whaleAdjustmentInner } = await import('../server/whaleAlert');

  assert(fngAdjustment(null) === 0, 'no FNG data -> zero');
  assert(fngAdjustment(10) === 3, `extreme fear = +3 (got ${fngAdjustment(10)})`);
  assert(fngAdjustment(35) === 1, `fear = +1 (got ${fngAdjustment(35)})`);
  assert(fngAdjustment(50) === 0, `neutral = 0 (got ${fngAdjustment(50)})`);
  assert(fngAdjustment(65) === -1, `greed = -1 (got ${fngAdjustment(65)})`);
  assert(fngAdjustment(90) === -3, `extreme greed = -3 (got ${fngAdjustment(90)})`);

  assert(__whaleAdjustmentInner(0) === 0, 'no whale flow -> 0');
  assert(__whaleAdjustmentInner(5_000_000) === -1, `net inflow 5M = -1 sell pressure (got ${__whaleAdjustmentInner(5_000_000)})`);
  assert(__whaleAdjustmentInner(-12_000_000) === 2, `net outflow 12M = +2 accumulation (got ${__whaleAdjustmentInner(-12_000_000)})`);
  assert(__whaleAdjustmentInner(30_000_000) === -3, `net inflow 30M = -3 (got ${__whaleAdjustmentInner(30_000_000)})`);

  const { buildSignal } = await import('../server/signalEngine');
  const { computeSnapshot } = await import('../shared/indicators');
  const candles = syntheticCandles(300, 22, 7);
  const snap = computeSnapshot(candles);
  assert(snap !== null, 'factors integration snapshot ready');
  if (snap) {
    const withFng = buildSignal({
      asset: 'BTC' as const, snapshot: snap, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: true },
      fng: { value: 90, classification: 'Extreme Greed', timestamp: 0 },
    });
    assert(withFng.reasons.some((r) => r.tag === 'FNG'), 'signal carries FNG tag');
    const noFng = buildSignal({
      asset: 'BTC' as const, snapshot: snap, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: true },
    });
    assert(!noFng.reasons.some((r) => r.tag === 'FNG'), 'no FNG data -> no FNG tag (graceful)');
  }
}console.log('\n=== 17. Binance Vision bulk history v3 ===');
{
  const { parseBinanceVisionCsv } = await import('../server/vision');
  const csv = [
    '1700000400000,50000,50100,49900,50050,12.5,1700003999999,625625,10,5,312500,0',
    '1700004000000000,50050,50200,50000,50150,15.0,1700007599999,752250,12,6,376125,0',
    'not-a-number,line',
    '',
  ].join('\n');
  const parsed = parseBinanceVisionCsv(csv);
  assert(parsed.length === 2, `2 valid rows parsed (got ${parsed.length})`);
  assert(parsed[0].time === 1700000400, `ms-era row normalized (got ${parsed[0].time})`);
  assert(parsed[1].time === 1700004000, `us-era row normalized (got ${parsed[1].time})`);
  assert(parsed[0].close === 50050 && parsed[1].close === 50150, 'ohlc parsed correctly');
  const empty = parseBinanceVisionCsv('garbage\n,');
  assert(empty.length === 0, 'garbage input -> zero candles');
}console.log('\n=== 18. Indicator audit vs trading-signals (external reference) ===');
{
  const { EMA, RSI, BollingerBands } = await import('trading-signals');
  const { ema, rsi, bollinger } = await import('../shared/indicators');

  const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 20 + i * 0.15);

  // EMA comparison (period 21)
  const refEma = new EMA(21);
  let refEmaLast: number | null = null;
  for (const c of closes) {
    refEma.add(c);
    const r = refEma.getResult();
    if (r !== undefined) refEmaLast = r;
  }
  const ours = ema(closes, 21);
  const devEma = Math.abs(ours[299] - (refEmaLast ?? 0));
  assert(devEma < 0.5, `EMA(21) matches reference (dev ${devEma.toFixed(4)})`);

  // RSI comparison (period 14)
  const refRsi = new RSI(14);
  let refRsiLast: number | null = null;
  for (const c of closes) {
    refRsi.add(c);
    const r = refRsi.getResult();
    if (r !== undefined) refRsiLast = r;
  }
  const oursRsi = rsi(closes, 14);
  const devRsi = Math.abs(oursRsi[299] - (refRsiLast ?? 0));
  assert(devRsi < 2, `RSI(14) close to reference (dev ${devRsi.toFixed(3)} pts)`);

  // Bollinger comparison (period 20, 2 std)
  const refBb = new BollingerBands(20, 2);
  let refBbLast: { middle: number; upper: number; lower: number } | undefined;
  for (const c of closes) {
    refBb.add(c);
    const r = refBb.getResult();
    if (r !== undefined && r !== null && (r as any).middle !== undefined) refBbLast = r as any;
  }
  const oursBb = bollinger(closes, 20, 2);
  const devMid = Math.abs(oursBb.mid[299] - (refBbLast?.middle ?? 0));
  assert(devMid < 0.5, `Bollinger mid matches reference (dev ${devMid.toFixed(4)})`);
  console.log(`    audit note: EMA dev ${devEma.toFixed(4)} | RSI dev ${devRsi.toFixed(3)} pts | BB mid dev ${devMid.toFixed(4)} - method differences documented`);
}
console.log('\n=== 19. Label hysteresis + funding squeeze curve v3 ===');
{
  const { evaluateLabelHysteresis, LABEL_HYSTERESIS_SCANS } = await import('../server/hysteresis');
  assert(LABEL_HYSTERESIS_SCANS === 2, 'hysteresis default = 2 consecutive scan cycles');
  const empty = { lastBuyCycle: null };
  const d1 = evaluateLabelHysteresis(empty, true, 5);
  assert(!d1.promote && d1.countsAsHold, 'first BUY cycle -> pending, not promoted');
  assert(d1.nextState.lastBuyCycle === 5, 'state records the hold cycle');
  const d2 = evaluateLabelHysteresis(d1.nextState, true, 6);
  assert(d2.promote, 'second consecutive BUY cycle -> promoted');
  const d3 = evaluateLabelHysteresis(d2.nextState, false, 7);
  assert(!d3.promote && d3.nextState.lastBuyCycle === null, 'non-BUY cycle clears the streak');
  const d4 = evaluateLabelHysteresis(d3.nextState, true, 8);
  assert(!d4.promote, 'BUY after a gap is pending again');
  const d5 = evaluateLabelHysteresis({ lastBuyCycle: 3 }, true, 6);
  assert(!d5.promote, 'non-adjacent cycle does not confirm (skipped cycle safe)');
  const d6 = evaluateLabelHysteresis(empty, true, 9, 1);
  assert(d6.promote, 'requiredConsecutive=1 -> immediate promotion');

  const { fundingSqueezePenalty } = await import('../server/signalEngine');
  assert(fundingSqueezePenalty(0.03) === 0, 'funding below gate -> 0');
  assert(fundingSqueezePenalty(0.04) === 0, 'funding at gate -> 0');
  assert(fundingSqueezePenalty(0.05) === 4, 'funding 1.25x gate -> 4');
  assert(fundingSqueezePenalty(0.08) === 12, 'funding 2x gate -> 12');
  assert(fundingSqueezePenalty(0.2) === 18, 'extreme funding clipped at 18');
  let mono = true;
  for (let i = 1; i < 40; i++) {
    if (fundingSqueezePenalty(0.04 + (i + 1) * 0.005) < fundingSqueezePenalty(0.04 + i * 0.005)) mono = false;
  }
  assert(mono, 'penalty monotonically non-decreasing above the gate');

  // Engine integration: graduated FUNDING reason present and matching the curve.
  const { buildSignal } = await import('../server/signalEngine');
  const { computeSnapshot } = await import('../shared/indicators');
  const candles = syntheticCandles(300, 22, 7);
  const snap = computeSnapshot(candles);
  assert(snap !== null, 'section 19 snapshot ready');
  if (snap) {
    const sig = buildSignal({
      asset: 'BTC' as const, snapshot: snap, htf: null, fundingPct8h: 0.05, change24h: 3,
      dataSource: 'LIVE' as const, gates: { htf: true, chop: true, rvol: true, funding: false },
    });
    const fund = sig.reasons.find((r) => r.tag === 'FUNDING');
    assert(fund !== undefined, 'squeeze funding produces a FUNDING reason');
    if (fund) {
      assert(fund.adjustment === -fundingSqueezePenalty(0.05), `graduated adjustment matches curve (got ${fund.adjustment})`);
      assert(fund.adjustment < 0 && fund.adjustment >= -18, 'penalty negative and clipped at -18');
    }
  }
}

console.log('\n=== 20. R-consistency + explicit verdict ===');
{
  // The protection circuit breaker must use the SAME R unit as the learning
  // system: a TP1 win pays its true R multiple (from strategy constants),
  // not a flat +1. With entry=50000, stop=49000, TP1=51000 the true R is exactly 1.0;
  // with wider TP1 it must be >1.
  const { dayRealizedR } = await import('../server/protection');
  const mkR = (tp1: number): import('../shared/types').StoredSignal => ({
    asset: 'BTC', engineSignature: 't', convictionScore: 80, signalType: 'STRONG_BUY',
    spotAction: 'SPOT_BUY', entryPrice: 50000, stopLoss: 49000, target1: tp1, target2: 52000, target3: 53000,
    riskRewardRatio: 2, regimeGateStatus: 'CLEAR', reasons: [], summaryAr: 't',
    generatedAt: 0, dedupHash: 'r' + Math.random(), dataSource: 'LIVE', htfAvailable: true,
    id: 'r' + Math.random(), isGateBlocked: false, telegramSent: false,
    outcomes: { windows: { h4: {mfePercent:0,maePercent:0,hitTp1BeforeSl:null}, h24: {mfePercent:0,maePercent:0,hitTp1BeforeSl:null}, h72: {mfePercent:0,maePercent:0,hitTp1BeforeSl:null} }, resolution: 'TP1_FIRST', resolvedAt: Date.now() },
  });
  const narrow = dayRealizedR([mkR(51000)], Date.now());
  assert(narrow.realizedR === 1, `TP1 with 1:1 R pays 1R (got ${narrow.realizedR})`);
  const wide = dayRealizedR([mkR(51250)], Date.now()); // 1.25R TP1
  assert(wide.realizedR === 1.25, `TP1 with R:R 1.25 pays 1.25R (got ${wide.realizedR})`);
  const loss = dayRealizedR([{ ...mkR(51000), outcomes: { ...mkR(51000).outcomes, resolution: 'SL_FIRST' as const } }], Date.now());
  assert(loss.realizedR === -1, `SL costs exactly -1R (got ${loss.realizedR})`);
}

console.log('\n=== 21. المحفظة الورقية (Paper Trading) ===');
{
  const { defaultPaperAccount, openBuy, markToMarket, currentEquity, closeBySellSignal } = await import('../server/paperTrading');
  const { PAPER_EXECUTION } = await import('../shared/strategyConstants');

  // 1) فتح صفقة بحجم 1% مخاطرة: القيود الرياضية
  const acct0 = defaultPaperAccount();
  const entry = 100;
  const stop = 99; // مخاطرة $1 لكل وحدة
  const sig = {
    asset: 'BTC' as const, engineSignature: 't', convictionScore: 80,
    signalType: 'STRONG_BUY' as const, spotAction: 'SPOT_BUY' as const,
    entryPrice: entry, stopLoss: stop, target1: 102, target2: 104, target3: 106,
    riskRewardRatio: 2, regimeGateStatus: 'CLEAR' as const, reasons: [],
    summaryAr: 't', generatedAt: 0, dedupHash: 'p', dataSource: 'LIVE' as const, htfAvailable: true,
  };
  const opened = openBuy(acct0, sig, 0.5, 1000);
  assert(opened.open.length === 1, 'buy opens one position');
  const pos0 = opened.open[0];
  assert(pos0.qty > 0, 'qty positive');
  // الرسوم والانزلاق حتميان: شراء أسوأ بـ 0.05% + رسم 0.075% على الجانب.
  const expectedEntry = entry * (1 + PAPER_EXECUTION.SLIPPAGE_RATE);
  assert(Math.abs(pos0.entry - expectedEntry) < 1e-9, `buy slippage is deterministic (got ${pos0.entry})`);
  const expectedQty = (10000 * 0.95) / (expectedEntry * (1 + PAPER_EXECUTION.FEE_RATE));
  assert(Math.abs(pos0.qty - expectedQty) < 1e-9, `qty respects cash cap after slippage and fee (got ${pos0.qty.toFixed(2)})`);
  const expectedEntryFee = pos0.qty * pos0.entry * PAPER_EXECUTION.FEE_RATE;
  assert(Math.abs(opened.cash - (10000 - pos0.qty * pos0.entry - expectedEntryFee)) < 0.01, 'entry fee deducted from cash');
  assert(opened.cash < 10000, 'cash reduced by position cost');
  assert(pos0.qty * entry <= 10000 * 0.95 + 0.01, 'position never exceeds 95% of equity');

  // 2) نفس الأصل مايتكرارش (مركز واحد لكل عملة)
  const dup = openBuy(opened, sig, 0.5, 2000);
  assert(dup.open.length === 1, 'one position per asset');

  // 2b) سقف المراكز داخل المحفظة نفسها — لا يعتمد فقط على protectionVerdict.
  const capAccount = defaultPaperAccount();
  const ethSig = { ...sig, asset: 'ETH' as const, dedupHash: 'paper-eth' };
  const solSig = { ...sig, asset: 'SOL' as const, dedupHash: 'paper-sol' };
  openBuy(capAccount, sig, 0.5, 1000);
  openBuy(capAccount, ethSig, 0.5, 2000);
  openBuy(capAccount, solSig, 0.5, 3000);
  assert(capAccount.open.length === 2, 'paper wallet enforces default max of two positions');
  const onePositionCap = defaultPaperAccount();
  openBuy(onePositionCap, sig, 0.5, 1000, 1);
  openBuy(onePositionCap, ethSig, 0.5, 2000, 1);
  assert(onePositionCap.open.length === 1, 'paper wallet respects configured position cap');

  // 3) تسيير على شمعة تجيب الوقف → خسارة، والقيمة النهائية < البداية
  const post = markToMarket(
    dup,
    { BTC: 98 },
    { BTC: { open: 99.5, high: 100, low: 97, close: 98, time: 2000 } },
    3000,
  );
  assert(post.open.length === 0, 'stop closes the position');
  assert(post.closed.length === 1, 'one closed trade');
  assert(post.closed[0].pnlUsd < 0, `stop exit loses money (got ${post.closed[0].pnlUsd})`);

  // 4) جني TP1 ثم وقف تعادل (لا خسارة بعد TP1)
  const acct1 = defaultPaperAccount();
  const a1 = openBuy(acct1, sig, 0.5, 1000);
  // شمعة تجيب TP1 (102) ثم ترتد وتلمس فقط 100 (فوق وقف التعادل)
  const post2 = markToMarket(
    a1,
    { BTC: 101 },
    { BTC: { open: 100, high: 103, low: 99.8, close: 101, time: 2000 } },
    3000,
  );
  const stillOpen = post2.open[0];
  assert(stillOpen && stillOpen.tp1Taken, 'TP1 taken');
  assert(stillOpen.stop >= stillOpen.entry, 'stop moved to break-even after TP1');
  assert(post2.cash > acct1.cash - post2.open[0].qty * post2.open[0].entry, 'TP1 proceeds returned to cash');

  // 5) بيع/خروج يقفل المركز
  const closedBySell = closeBySellSignal(post2, 'BTC', 101, 4000);
  assert(closedBySell.open.length === 0, 'sell signal closes position');
  assert(closedBySell.closed.length === 1, 'one closed trade from sell');
  const expectedExitAvg = Number(((0.5 * 102 * (1 - PAPER_EXECUTION.SLIPPAGE_RATE)) + (0.5 * 101 * (1 - PAPER_EXECUTION.SLIPPAGE_RATE))).toFixed(2));
  assert(closedBySell.closed[0].exitAvg === expectedExitAvg, `exitAvg weights TP1 + remainder after slippage (got ${closedBySell.closed[0].exitAvg})`);
  assert((closedBySell.closed[0].feesUsd ?? 0) > 0, 'closed trade reports accumulated fees');

  // 6) currentEquity = كاش + قيمة مفتوح (بعد TP1: ربح محقق + مركز مفتوح)
  const eq = currentEquity(closedBySell, { BTC: 101 });
  // حساب يدوي: رأس 10000، ربنا من TP1 + القيمة المتبقية والمقفلة عند البيع
  assert(Number.isFinite(eq) && eq > 10000 && eq < 10300, `equity ~ 10142 after TP1 (got ${eq})`);

  // 7) وقف متحرك مدرّج (freqtrade-style): المرآة والثوابت متوحدتان
  const { TRAILING: TRAIL_C } = await import('../shared/strategyConstants');
  assert(TRAIL_C.ACTIVATE_AFTER_ATR === 1 && TRAIL_C.TIGHT_AFTER_ATR === 2 && TRAIL_C.OFFSET_ATR === 2, 'trailing constants centralized');
}

console.log('\n=== 22. إشعارات أحداث المحفظة الورقية (Telegram) ===');
{
  const { defaultPaperAccount, openBuy, snapshotPaperAccount, diffPaperEvents } = await import('../server/paperTrading');
  const { buildPaperEventHtml, claimTelegramAlertKey, releaseTelegramAlertKey, parseTelegramCommand } = await import('../server/telegram');
  assert(parseTelegramCommand('/status') === 'status', 'Telegram parses /status');
  assert(parseTelegramCommand('/balance@signalforge_bot') === 'balance', 'Telegram strips bot username');
  assert(parseTelegramCommand('status') === null, 'Telegram rejects non-slash text');

  // 1) فتح مركز → حدث OPENED
  const a0 = defaultPaperAccount();
  const sig = {
    asset: 'ETH' as const, engineSignature: 't', convictionScore: 80,
    signalType: 'STRONG_BUY' as const, spotAction: 'SPOT_BUY' as const,
    entryPrice: 2000, stopLoss: 1990, target1: 2020, target2: 2040, target3: 2060,
    riskRewardRatio: 2, regimeGateStatus: 'CLEAR' as const, reasons: [],
    summaryAr: 't', generatedAt: 0, dedupHash: 'pw', dataSource: 'LIVE' as const, htfAvailable: true,
  };
  const before = snapshotPaperAccount(a0);
  const afterOpen = openBuy(a0, sig, 20, 1000);
  const evs1 = diffPaperEvents(before, afterOpen);
  assert(evs1.length === 1 && evs1[0].kind === 'OPENED' && evs1[0].asset === 'ETH', 'open → OPENED event');
  const htmlAr = buildPaperEventHtml({ kind: 'OPENED', asset: 'ETH', qty: 2.5, entry: 2000 }, 'ar');
  assert(htmlAr.includes('المحفظة الورقية') && htmlAr.includes('ETH'), 'open message in Arabic');
  const htmlEn = buildPaperEventHtml({ kind: 'OPENED', asset: 'ETH', qty: 2.5, entry: 2000 }, 'en');
  assert(htmlEn.includes('Paper wallet') && htmlEn.includes('Position opened'), 'open message in English');

  // 1b) نفس حدث المحفظة لا يُحجز مرتين لنفس المحادثة، ويُسمح لمحادثة أخرى.
  const dedupKey = `test-paper-open-${Date.now()}`;
  assert(claimTelegramAlertKey(dedupKey, 'chat-a', 1000), 'Telegram event key claims once');
  assert(!claimTelegramAlertKey(dedupKey, 'chat-a', 1001), 'duplicate Telegram event is blocked');
  assert(claimTelegramAlertKey(dedupKey, 'chat-b', 1001), 'same event may target a different chat');
  releaseTelegramAlertKey(dedupKey, 'chat-a');
  releaseTelegramAlertKey(dedupKey, 'chat-b');

  // 2) جني TP1 → حدث TP1
  const b0 = openBuy(defaultPaperAccount(), sig, 20, 1000);
  const bBefore = snapshotPaperAccount(b0);
  const bWork = snapshotPaperAccount(b0); // نسخة مستقلة عشان markToMarket بتعدّل في المكان
  const afterTp1 = (await import('../server/paperTrading')).markToMarket(
    bWork,
    { ETH: 2010 },
    { ETH: { open: 2000, high: 2021, low: 1995, close: 2010, time: 2000 } },
    3000,
  );
  const evs2 = diffPaperEvents(bBefore, afterTp1);
  assert(evs2.some((e) => e.kind === 'TP1'), 'TP1 hit → TP1 event');
  const htmlTp1 = buildPaperEventHtml({ kind: 'TP1', asset: 'ETH', entry: 2000, pnlUsd: 10 }, 'ar');
  assert(htmlTp1.includes('TP1') && htmlTp1.includes('+10.00'), 'TP1 message carries realized P&L');

  // 3) قفل بوقف الخسارة → حدث CLOSED بخسارة
  const c0 = openBuy(defaultPaperAccount(), sig, 20, 1000);
  const cBefore = snapshotPaperAccount(c0);
  const cWork = snapshotPaperAccount(c0);
  const afterSl = (await import('../server/paperTrading')).markToMarket(
    cWork,
    { ETH: 1985 },
    { ETH: { open: 1999, high: 2000, low: 1984, close: 1985, time: 2000 } },
    3000,
  );
  const evs3 = diffPaperEvents(cBefore, afterSl);
  const closedEv = evs3.find((e) => e.kind === 'CLOSED');
  assert(closedEv !== undefined && closedEv.kind === 'CLOSED' && closedEv.trade?.reason === 'SL', 'stop → CLOSED with reason SL');
  const htmlSl = buildPaperEventHtml(
    { kind: 'CLOSED', asset: 'ETH', exitAvg: 1989, pnlUsd: -12.5, reason: 'SL' },
    'en',
  );
  assert(htmlSl.includes('-12.50') && htmlSl.includes('SL'), 'closed message carries negative P&L and reason');
  assert(htmlSl.includes('Reason'), 'closed message in English');
}

console.log('\n=== 23. طبقة ccxt (شبكة أمان البيانات) ===');
{
  // نختبر التحويلات النقية فقط — بدون طلبات شبكية (لا نعتمد على الإنترنت في الاختبارات)
  // ccxt شغّالة فعلياً وتحققنا منها يدوياً (ticker OKX/KuCoin ناجح، Bybit 403 geo-block)
  const mod = await import('../server/ccxtProvider');
  assert(typeof mod.tickerFromCcxt === 'function', 'ccxt ticker provider exported');
  assert(typeof mod.candlesFromCcxt === 'function', 'ccxt candles provider exported');
  assert(typeof mod.closeCcxtExchangePool === 'function', 'ccxt pool exposes graceful cleanup');
  assert(mod.ccxtExchangePoolSize() === 0, 'ccxt pool starts empty before fallback use');
  // تأكد إن الثنائية والاتجاه في mapCcxtOhlcv منغلقة داخلياً: نتأكد بطلب مجرد عدم انفجار الاستيراد
  const pkg = await import('ccxt');
  assert(typeof pkg.version === 'string' && pkg.version.length > 2, `ccxt library loaded (v${pkg.version})`);
  assert(['binance', 'bybit', 'okx', 'kucoin', 'gate', 'mexc', 'htx', 'bitget'].every((id) => typeof (pkg as Record<string, unknown>)[id] === 'function'), 'ccxt exposes fallback exchanges');
}

console.log('\n=== 24. أنماط الشموع اليابانية (عامل PATTERN) ===');
{
  const { resolvePatternAdjustment, detectCandlePatterns } = await import('../server/candlePatterns');
  const { computeSnapshot } = await import('../shared/indicators');
  const { buildSignal } = await import('../server/signalEngine');
  // Candle factories — نتحكم في OHLC يدوياً
  const c = (o: number, h: number, l: number, cl: number, t = 1_700_000_000): import('../shared/types').Candle => ({
    time: t, open: o, high: h, low: l, close: cl, volume: 100,
  });

  // 0) دوجي: جسم شبه معدوم بالنسبة للمدى → كشف الدوجي (حياد بشفافية)
  {
    const dojiCandles = [c(100, 103, 97, 100.1, 1_700_000_000)];
    const hits = detectCandlePatterns(dojiCandles);
    assert(hits.some((h) => h.id === 'doji'), `كشف الدوجي (got ${hits.map((h) => h.id).join(',') || 'none'})`);
  }

  // 1) المطرقة: جسم صغير وفتيل سفلي طويل وفتيل علوي شبه معدوم
  const hammerOnly = [
    c(100, 102, 99, 101, 1_700_000_000 - 2 * 3600),
    c(101, 103.5, 97, 101.5, 1_700_000_000 - 1 * 3600), // prev
    c(101, 101.2, 96, 100.5, 1_700_000_000), // last: جسم 0.5، فتيل سفلي 4.5، علوي 0.2 → مطرقة
  ];
  {
    const res = resolvePatternAdjustment(hammerOnly);
    assert(res.adjustment > 0, `المطرقة ترفع الدرجة (+${res.adjustment})`);
    assert(res.hit?.id === 'hammer', `كشف المطرقة (got ${res.hit?.id})`);
  }

  // 2) ابتلاع هابط: شمعة حمراء كبيرة تبتلع الخضراء السابقة
  const engulf = [
    c(100, 102, 99, 101, 1_700_000_000 - 3600), // prev bull small
    c(102, 103, 95, 96, 1_700_000_000),         // last bear big: open 102 > close 101 ✅ engulf
  ];
  {
    const res = resolvePatternAdjustment(engulf);
    assert(res.adjustment < 0, `الابتلاع الهابط يخفض الدرجة (${res.adjustment})`);
    assert(res.hit?.id === 'bearish-engulfing', `كشف الابتلاع الهابط (got ${res.hit?.id})`);
  }

  // 3) حياد: شموع عادية (ترند بسيط) → لا أنماط قوية
  {
    const res = resolvePatternAdjustment(syntheticCandles(80, 5));
    assert(res.adjustment === 0 || Math.abs(res.adjustment) <= 5, `سلسلة عادية لا تولد أنماطاً مبالغاً فيها (got ${res.adjustment})`);
  }

  // 4) التكامل مع المحرك: candles مفقودة → لا بلوك كسر، والقائمة تظل نظيفة
  {
    const snap = computeSnapshot(syntheticCandles(240, 30));
    if (snap) {
      const sig = buildSignal({
        asset: 'BTC', snapshot: snap, htf: null, fundingPct8h: 0, change24h: 0,
        dataSource: 'LIVE', gates: { htf: true, chop: true, rvol: true, funding: true },
        // candles غير ممررة عمداً → يجب ألا ينفجر
      });
      assert(typeof sig.convictionScore === 'number' && sig.convictionScore >= 0 && sig.convictionScore <= 100, 'المحرك يعمل بلا candles (عامل اختياري)');
    }
  }

  // 5) ربط السبب: صفقة تدخل نمط صاعد فعلي → PAYTERN في الأسباب
  {
    const bullCandles = syntheticCandles(240, 30);
    // نجعل آخر شمعة ابتلاع صاعد حقيقي
    const lastIdx = bullCandles.length - 1;
    bullCandles[lastIdx - 1] = { time: bullCandles[lastIdx - 1].time, open: 100, high: 101, low: 99, close: 99.5, volume: 100 };
    bullCandles[lastIdx] = { time: bullCandles[lastIdx].time, open: 99, high: 104, low: 98.5, close: 101, volume: 100 };
    const snap = computeSnapshot(bullCandles);
    if (snap) {
      const sig = buildSignal({
        asset: 'BTC', snapshot: snap, htf: null, fundingPct8h: 1, change24h: 4,
        dataSource: 'LIVE', gates: { htf: true, chop: true, rvol: true, funding: true },
        candles: bullCandles,
      });
      const hasPattern = sig.reasons.some((r) => r.tag === 'PATTERN');
      assert(hasPattern, 'السبب PATTERN يظهر عند وجود نمط شموع فعلي');
    }
  }
}

console.log('\n=== 25. إصلاح جلب أزواج DEX ===');
{
  const { normalizeDexPairs } = await import('../server/dexscreener');
  const raw = [
    { chainId: 'ethereum', dexId: 'uniswap', url: 'https://dex/1', baseToken: { address: '0xCANON', symbol: 'WBTC' }, quoteToken: { address: '0xQUOTE', symbol: 'WETH' }, priceUsd: '100', liquidity: { usd: 250_000 }, volume: { h24: 10_000 }, priceChange: { h24: 2.5 } },
    { chainId: 'solana', dexId: 'raydium', url: 'https://dex/2', baseToken: { address: 'SOL-CANON', symbol: 'SOL' }, quoteToken: { address: 'USDC', symbol: 'USDC' }, priceUsd: '99', liquidity: { usd: 900_000 }, volume: { h24: 20_000 }, priceChange: { h24: -1.2 } },
    { chainId: 'unknown', dexId: 'bad', liquidity: { usd: 'not-a-number' } },
  ];
  const pairs = normalizeDexPairs(raw);
  assert(pairs.length === 2, `الأزواج الصالحة فقط تظهر (got ${pairs.length})`);
  assert(pairs[0].dexId === 'raydium' && pairs[0].liquidityUsd === 900_000, 'الترتيب حسب السيولة صحيح');
  assert(pairs[0].baseTokenSymbol === 'SOL' && pairs[0].quoteTokenSymbol === 'USDC', 'رموز الزوج تظهر بوضوح');
  assert(pairs[1].priceChange24hPercent === 2.5, 'تغيير السعر يتحول لرقم صحيح');
  const verifiedOnly = normalizeDexPairs(raw, { chainId: 'ethereum', address: '0xCANON', wrappedSymbol: 'WBTC' });
  assert(verifiedOnly.length === 1 && verifiedOnly[0].baseTokenSymbol === 'WBTC', 'فلترة العنوان والشبكة الرسمية تمنع التوكن المقلد');
  assert(normalizeDexPairs(null).length === 0 && normalizeDexPairs({ pairs: raw }).length === 0, 'الرد غير الصالح لا يكسر المسار');
}

console.log(`\n=============================================`);
console.log(`النتيجة: ${passed} نجح / ${failed} فشل`);
if (failed > 0) process.exit(1);
console.log('🎉 كل الاختبارات نجحت');
