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
  const { ema, rsi, macd, atr, adx, bollinger, relativeVolume, resample, computeSnapshot } = await import('../shared/indicators');

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

  const bullV2 = syntheticCandles(300, 22, 7);
  const snapV2 = computeSnapshot(bullV2);
  assert(snapV2 !== null, 'لقطة v2 جاهزة');
  if (snapV2) {
    const baseSig = buildSignal({
      asset: 'BTC', snapshot: snapV2, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE', gates: { htf: true, chop: true, rvol: true, funding: true },
    });
    const liftedSig = buildSignal({
      asset: 'BTC', snapshot: snapV2, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE', gates: { htf: true, chop: true, rvol: true, funding: true },
      liquidity: aggregateLiquidity(3.5, 1.2, 15),
    });
    assert(liftedSig.convictionScore === Math.min(100, baseSig.convictionScore + 8), `طبقة السيولة رفعت الدرجة بـ+8 (${baseSig.convictionScore} → ${liftedSig.convictionScore})`);
    assert(liftedSig.liquidity?.adjustment === 8, 'الإشارة تحمل ملخص السيولة');

    const blockedSig = buildSignal({
      asset: 'BTC', snapshot: snapV2, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE', gates: { htf: true, chop: true, rvol: true, funding: true },
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
  const { computeTrailingStop, runWalkForward } = await import('../server/backtest');

  assert(computeTrailingStop(100, 110, 112, 2) === 108, `trail ratchets to peak-2ATR (got ${computeTrailingStop(100, 110, 112, 2)})`);
  assert(computeTrailingStop(108, 110, 105, 2) === 108, 'trail never moves down');
  assert(computeTrailingStop(100, 0, 120, 2) === 116, `trail from running high (got ${computeTrailingStop(100, 0, 120, 2)})`);
  assert(computeTrailingStop(100, 110, 112, 2, 3) === 106, `custom ATR multiplier respected (got ${computeTrailingStop(100, 110, 112, 2, 3)})`);

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
  const clamped = clampProtection({ dailyLossLimitR: 999, maxConcurrentSignals: 0, signalExpiryHours: -5, correlationGuard: true });
  assert(clamped.dailyLossLimitR === 20 && clamped.maxConcurrentSignals === 1 && clamped.signalExpiryHours === 1, 'clampProtection bounds values');
}
console.log('\n=== 12. Learning system v3 ===');
{
  const { computeTagStats, baselineWinRatePercent, computeLearningState, diffLessons, biasForReasons } = await import('../server/learning');

  const mkLearnt = (tag: import('../shared/types').ReasonTag, win: boolean, opts: { blocked?: boolean; open?: boolean } = {}): import('../shared/types').StoredSignal => ({
    asset: 'BTC',
    engineSignature: 'test',
    convictionScore: 80,
    signalType: 'STRONG_BUY',
    spotAction: 'SPOT_BUY',
    entryPrice: 50000,
    stopLoss: 49000,
    target1: 51000,
    target2: 52000,
    target3: 53000,
    riskRewardRatio: 2,
    regimeGateStatus: 'CLEAR',
    reasons: [{ tag, adjustment: 0, textAr: 'x' }],
    summaryAr: 'x',
    generatedAt: 0,
    dedupHash: 'd' + Math.random(),
    dataSource: 'LIVE',
    htfAvailable: true,
    id: 'l' + Math.random(),
    isGateBlocked: opts.blocked ?? false,
    telegramSent: false,
    outcomes: {
      windows: {
        h4: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
        h24: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
        h72: { mfePercent: 0, maePercent: 0, hitTp1BeforeSl: null },
      },
      resolution: opts.open ? 'OPEN' : win ? 'TP1_FIRST' : 'SL_FIRST',
    },
  });

  // Evidence: TREND 10W/2L (83.3%), MACD 3W/9L (25%), RSI 6W/6L (50%) -> baseline 52.8%
  const signals: import('../shared/types').StoredSignal[] = [];
  for (let i = 0; i < 10; i++) signals.push(mkLearnt('TREND', true));
  for (let i = 0; i < 2; i++) signals.push(mkLearnt('TREND', false));
  for (let i = 0; i < 3; i++) signals.push(mkLearnt('MACD', true));
  for (let i = 0; i < 9; i++) signals.push(mkLearnt('MACD', false));
  for (let i = 0; i < 6; i++) signals.push(mkLearnt('RSI', true));
  for (let i = 0; i < 6; i++) signals.push(mkLearnt('RSI', false));
  // noise that must NOT affect stats: blocked + open signals
  signals.push(mkLearnt('TREND', true, { blocked: true }));
  signals.push(mkLearnt('TREND', true, { open: true }));

  const stats = computeTagStats(signals);
  const trend = stats.find((t) => t.tag === 'TREND');
  const macd = stats.find((t) => t.tag === 'MACD');
  const rsi = stats.find((t) => t.tag === 'RSI');
  assert(!!trend && trend.samples === 12, `TREND samples = 12 (got ${trend ? trend.samples : 'missing'})`);
  assert(!!macd && macd.samples === 12, `MACD samples = 12 (got ${macd ? macd.samples : 'missing'})`);
  assert(!!rsi && rsi.winRatePercent === 50, `RSI winRate = 50 (got ${rsi ? rsi.winRatePercent : 'missing'})`);

  const baseline = baselineWinRatePercent(signals);
  assert(Math.abs(baseline - 52.8) < 0.1, `baseline ~= 52.8 (got ${baseline})`);

  const state = computeLearningState(signals);
  assert(state.totalResolved === 36, `totalResolved = 36 (got ${state.totalResolved})`);
  assert(state.biases['TREND'] === 3, `TREND bias = +3 (got ${state.biases['TREND']})`);
  assert(state.biases['MACD'] === -3, `MACD bias = -3 (got ${state.biases['MACD']})`);
  assert(state.biases['RSI'] === 0, `RSI bias = 0, deviation under threshold (got ${state.biases['RSI']})`);

  // Bias application: sum over distinct tags, clamped to +/-5.
  assert(biasForReasons(['TREND', 'MACD'], state.biases) === 0, 'TREND+MACD biases cancel out');
  assert(biasForReasons(['TREND'], state.biases) === 3, `TREND alone = +3 (got ${biasForReasons(['TREND'], state.biases)})`);
  assert(biasForReasons(['TREND', 'RSI'], { TREND: 3, RSI: 3 }) === 5, `sum clamped to +5 (got ${biasForReasons(['TREND', 'RSI'], { TREND: 3, RSI: 3 })})`);
  assert(biasForReasons(['UNKNOWN'], {}) === 0, 'unknown tag -> zero bias');

  // Audit trail: only changed tags produce lessons.
  const lessons = diffLessons({ TREND: 0, MACD: 0, RSI: 0 }, state.biases, state.perTag, baseline, 1000);
  assert(lessons.length === 2, `2 lessons for 2 changed biases (got ${lessons.length})`);
  const trendLesson = lessons.find((l) => l.tag === 'TREND');
  assert(!!trendLesson && trendLesson.from === 0 && trendLesson.to === 3 && trendLesson.samples === 12, 'TREND lesson carries from/to/evidence');
  const none = diffLessons(state.biases, state.biases, state.perTag, baseline, 1000);
  assert(none.length === 0, 'no changes -> no lessons');
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
      asset: 'BTC', snapshot: snap, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE', gates: { htf: true, chop: true, rvol: true, funding: true },
    });
    const withOi = buildSignal({
      asset: 'BTC', snapshot: snap, htf: null, fundingPct8h: 0.01, change24h: 3,
      dataSource: 'LIVE', gates: { htf: true, chop: true, rvol: true, funding: true },
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
console.log(`\n=============================================`);
console.log(`النتيجة: ${passed} نجح / ${failed} فشل`);
if (failed > 0) process.exit(1);
console.log('🎉 كل الاختبارات نجحت');
