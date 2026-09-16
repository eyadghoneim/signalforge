// محرك الإشارات الحتمي — نفس الدوال للسيرفر والباك تست (صفر انحراف بين الحي والمحاكى)
import type {
  Signal,
  SignalReason,
  SupportedAsset,
  RegimeGateStatus,
  SmcSnapshot,
  FngPoint,
  LiquidityRegime,
  DailyTrend,
} from '../shared/types';
import {
  ENGINE_SIGNATURE,
  STRATEGY_THRESHOLDS,
  deriveSignalTypeAndAction,
  computeRiskTargets,
  fnv1a64Hex,
} from '../shared/strategyConstants';
import type { IndicatorSnapshot, HtfSnapshot } from '../shared/indicators';
import { openInterestAdjustment } from './oiFactor';
import { biasForReasonsRegime } from './learning';
import { fngAdjustment } from './fng';

export { openInterestAdjustment };

export interface GateToggles {
  htf: boolean;
  chop: boolean;
  rvol: boolean;
  funding: boolean;
}

export interface BuildSignalContext {
  asset: SupportedAsset;
  snapshot: IndicatorSnapshot;
  htf: HtfSnapshot | null;
  fundingPct8h: number | null;
  change24h: number;
  dataSource: 'LIVE' | 'STALE';
  gates: GateToggles;
  // ─── طبقات v2.0 ───
  smc?: SmcSnapshot | null;
  liquidity?: LiquidityRegime | null;
  daily?: DailyTrend | null;
  entryZone?: { low: number; high: number } | null;
  oiChange24h?: number | null;
  tagBias?: Record<string, number>;
  fng?: FngPoint | null;
  whale?: { netInflowUsd: number; txCount: number } | null;
}

export function buildSignal(ctx: BuildSignalContext): Signal {
  const { asset, snapshot: s, htf, fundingPct8h, change24h } = ctx;
  const reasons: SignalReason[] = [];
  let score = 50;
  let learningBiasValue = 0;

  const add = (tag: SignalReason['tag'], adjustment: number, textAr: string): void => {
    if (adjustment === 0) return;
    score += adjustment;
    reasons.push({ tag, adjustment, textAr });
  };

  // 1. الترند (EMA 21/50)
  const bullTrend = s.close > s.ema21 && s.ema21 > s.ema50;
  const bearTrend = s.close < s.ema21 && s.ema21 < s.ema50;
  if (bullTrend) {
    add('TREND', s.emaTrend === 'STRONG_BULLISH' ? 14 : 10, 'الترند صاعد (السعر فوق EMA21 وEMA50)');
  } else if (bearTrend) {
    add('TREND', s.emaTrend === 'STRONG_BEARISH' ? -16 : -12, 'الترند هابط (السعر تحت EMA21 وEMA50)');
  }

  // 2. MACD
  if (s.macdHist > 0) {
    add('MACD', s.macdHist > s.macdHistPrev ? 8 : 3, s.macdHist > s.macdHistPrev ? 'زخم MACD موجب ومتسارع' : 'زخم MACD موجب لكن يتباطأ');
  } else if (s.macdHist < 0) {
    add('MACD', s.macdHist < s.macdHistPrev ? -8 : -3, s.macdHist < s.macdHistPrev ? 'زخم MACD سالب ومتسارع نزولاً' : 'زخم MACD سالب لكنه يتحسن');
  }

  // 3. RSI
  if (s.rsi14 < 30) add('RSI', 8, `RSI في تشبع بيعي (${s.rsi14.toFixed(0)})`);
  else if (s.rsi14 <= 45) add('RSI', 3, `RSI منخفض (${s.rsi14.toFixed(0)})`);
  else if (s.rsi14 > 70) add('RSI', -8, `RSI في تشبع شرائي (${s.rsi14.toFixed(0)})`);
  else if (s.rsi14 >= 55) add('RSI', 3, `RSI يدعم الصعود (${s.rsi14.toFixed(0)})`);

  // 4. ADX — قوة الاتجاه
  if (s.adx14 >= 25 && s.plusDI > s.minusDI) add('ADX', 8, `اتجاه صاعد قوي (ADX ${s.adx14.toFixed(0)})`);
  else if (s.adx14 >= 25 && s.minusDI > s.plusDI) add('ADX', -8, `اتجاه هابط قوي (ADX ${s.adx14.toFixed(0)})`);
  else if (s.adx14 < STRATEGY_THRESHOLDS.CHOP_ADX_MAX) add('ADX', -4, `سوق بلا اتجاه (ADX ${s.adx14.toFixed(0)} < 18)`);

  // 5. الفوليوم النسبي
  if (s.rvol >= STRATEGY_THRESHOLDS.RVOL_BONUS_MIN) add('RVOL', 8, `فوليوم مرتفع مؤكد (${s.rvol.toFixed(1)}x المتوسط)`);
  else if (s.rvol <= 0.6) add('RVOL', -6, `فوليوم ضعيف (${s.rvol.toFixed(1)}x المتوسط)`);

  // 6. زخم 24 ساعة
  if (change24h >= 2.5) add('MOMENTUM', 5, `زخم 24h موجب (+${change24h.toFixed(1)}%)`);
  else if (change24h <= -2.5) add('MOMENTUM', -5, `زخم 24h سالب (${change24h.toFixed(1)}%)`);

  // 7. تمويل العقود
  if (fundingPct8h !== null) {
    if (fundingPct8h > STRATEGY_THRESHOLDS.FUNDING_SQUEEZE_PCT_8H)
      add('FUNDING', -12, `تمويل مرتفع (${fundingPct8h.toFixed(3)}%/8h) — خطر تصفية المشترين`);
    else if (fundingPct8h <= 0) add('FUNDING', 2, 'تمويل صفر أو سالب — لا ضغط شراء مفرط');
  }

  // 8. بولنجر
  if (s.bbPercentB < 0.15) add('BOLLINGER', 5, 'السعر ملاصق للحد السفلي لبولنجر');
  else if (s.bbPercentB > 0.9) add('BOLLINGER', -5, 'السعر ملاصق للحد العلوي لبولنجر');

  // 9. بنية السوق (SMC) — كسر الهيكل ومناطق الطلب/العرض
  if (ctx.smc) {
    if (ctx.smc.structure === 'BULLISH_BOS')
      add('SMC', 8, `كسر هيكل صاعد (BOS) فوق القمة ${ctx.smc.lastSwingHigh?.toLocaleString('en-US')}`);
    else if (ctx.smc.structure === 'BEARISH_BOS')
      add('SMC', -8, `كسر هيكل هابط (BOS) تحت القاع ${ctx.smc.lastSwingLow?.toLocaleString('en-US')}`);
    if (ctx.smc.orderBlock?.kind === 'BULLISH' && ctx.smc.nearOrderBlock && ctx.smc.structure !== 'BEARISH_BOS')
      add('SMC', 4, 'السعر يرتد من منطقة طلب صاعدة (Bullish Order Block)');
    else if (ctx.smc.orderBlock?.kind === 'BEARISH' && ctx.smc.nearOrderBlock && ctx.smc.structure !== 'BULLISH_BOS')
      add('SMC', -4, 'السعر يصطدم بمنطقة عرض هابطة (Bearish Order Block)');
  }

  // 10. طبقة السيولة العالمية (DefiLlama) — ±8 كحد أقصى
  if (ctx.liquidity && ctx.liquidity.sourcesOk > 0) {
    add('LIQUIDITY', ctx.liquidity.totalAdjustment, ctx.liquidity.summaryAr);
  }

  // 11. تأكيد الفريم اليومي
  if (ctx.daily) {
    if (htf && htf.bullish && ctx.daily.bullish) add('HTF', 4, 'تأكيد مزدوج: فريم 4 ساعات واليومي صاعدين معاً');
    else if (ctx.daily.bearish && !(htf && htf.bullish)) add('HTF', -4, 'الفريم اليومي هابط — الصعود الحالي مضاربي قصير المدى');
  }

  // Open interest: rising OI confirms the prevailing move, falling OI warns of exhaustion.
  const oiAdj = openInterestAdjustment(ctx.oiChange24h ?? null, s.emaTrend);
  if (oiAdj !== 0) {
    const oiVal = ctx.oiChange24h ?? 0;
    add('OI', oiAdj, `Open interest 24h: ${(oiVal > 0 ? '+' : '') + oiVal.toFixed(1)}% (${oiAdj > 0 ? 'confirms trend' : 'warns exhaustion'})`);
  }

  // Fear & Greed (contrarian): extreme fear = accumulation, extreme greed = euphoria warning.
  const fngAdj = fngAdjustment(ctx.fng ? ctx.fng.value : null);
  if (fngAdj !== 0) {
    const fv = ctx.fng ? ctx.fng.value : 0;
    add('FNG', fngAdj, `Fear & Greed: ${fv} (${ctx.fng ? ctx.fng.classification : 'n/a'})`);
  }
  // Whale netflow: net exchange deposits = potential sell pressure; net withdrawals = accumulation.
  if (ctx.whale && ctx.whale.txCount > 0) {
    const wn = ctx.whale.netInflowUsd;
    const absWn = Math.abs(wn);
    const signWn = wn > 0 ? -1 : 1;
    const wAdj = absWn >= 25_000_000 ? 3 * signWn : absWn >= 10_000_000 ? 2 * signWn : absWn >= 3_000_000 ? 1 * signWn : 0;
    if (wAdj !== 0) {
      add('WHALE', wAdj, `Whale netflow 1h: ${(wn > 0 ? '+' : '')}${(wn / 1_000_000).toFixed(1)}M USD`);
    }
  }
  score = Math.min(100, Math.max(0, Math.round(score)));

  // ─── بنية هابطة صلبة → خروج دفاعي (يتخطى كل البوابات دائماً) ───
  const hardBearish =
    (s.emaTrend === 'BEARISH' || s.emaTrend === 'STRONG_BEARISH') && s.macdHist < 0 && s.close < s.ema50;
  if (hardBearish) {
    reasons.push({ tag: 'TREND', adjustment: 0, textAr: 'بنية هابطة صلبة — الخروج الدفاعي مُقدَّم على أي بوابة' });
  }

  // Learning bias v2 (bounded, regime-aware): applied BEFORE type derivation so
  // signalType/spotAction always match the final score. Keys are TAG|REGIME with a
  // plain-TAG fallback for simple configurations.
  if (ctx.tagBias) {
    const regime = ctx.daily ? (ctx.daily.bearish ? 'BEARISH' : ctx.daily.bullish ? 'BULLISH' : 'UNKNOWN') : 'UNKNOWN';
    const bias = biasForReasonsRegime(Array.from(new Set(reasons.map((r) => r.tag))), regime, ctx.tagBias);
    if (bias !== 0) {
      score = Math.max(0, Math.min(100, score + bias));
      learningBiasValue = bias;
    }
  }
  let { signalType, spotAction } = deriveSignalTypeAndAction(score);
  if (hardBearish && spotAction !== 'SPOT_SELL_ALL') {
    signalType = score <= STRATEGY_THRESHOLDS.STRONG_SELL_MAX_SCORE ? 'STRONG_SELL' : 'SELL';
    spotAction = 'SPOT_SELL_ALL';
  }

  // ─── بوابات المخاطر: تُطبق على محاولات الشراء فقط ───
  let regimeGateStatus: RegimeGateStatus = 'CLEAR';
  let blockReasonAr: string | undefined;

  if (spotAction === 'SPOT_BUY') {
    const buyScore = score;
    // 1) بوابة الفريم الأكبر (4 ساعات + اليومي)
    const htf4hBearish = ctx.gates.htf && htf && htf.bearish;
    const dailyBearish = ctx.gates.htf && ctx.daily && ctx.daily.bearish;
    if (htf4hBearish || dailyBearish) {
      regimeGateStatus = 'HTF_BLOCKED';
      blockReasonAr = htf4hBearish
        ? 'الترند الأكبر (4 ساعات) هابط — الصعود الحالي ارتداد مضاربي محتمل'
        : 'الفريم اليومي هابط (تحت EMA50) — الدخول ضد الماكرو ممنوع';
      reasons.push({ tag: 'HTF', adjustment: 0, textAr: blockReasonAr });
    }
    // 2) بوابة السوق العرضي
    else if (ctx.gates.chop && s.adx14 < STRATEGY_THRESHOLDS.CHOP_ADX_MAX) {
      regimeGateStatus = 'CHOP_BLOCKED';
      blockReasonAr = 'سوق عرضي خامل (ADX<18) — الدخول هنا يأكل العمولات في ذبذبة بلا اتجاه';
      reasons.push({ tag: 'ADX', adjustment: 0, textAr: blockReasonAr });
    }
    // 3) بوابة الفوليوم
    else if (ctx.gates.rvol && s.rvol < STRATEGY_THRESHOLDS.RVOL_BLOCK_MAX) {
      regimeGateStatus = 'RVOL_BLOCKED';
      blockReasonAr = `كسر بفوليوم شبه معدوم (RVOL ${s.rvol.toFixed(2)}x) — فخ سيولة كاذب محتمل`;
      reasons.push({ tag: 'RVOL', adjustment: 0, textAr: blockReasonAr });
    }
    // 4) بوابة التمويل
    else if (ctx.gates.funding && fundingPct8h !== null && fundingPct8h > STRATEGY_THRESHOLDS.FUNDING_SQUEEZE_PCT_8H) {
      regimeGateStatus = 'SQUEEZE_BLOCKED';
      blockReasonAr = `تمويل العقود مرتفع (${fundingPct8h.toFixed(3)}%/8h) — خطر تصفية عقود الشراء`;
      reasons.push({ tag: 'FUNDING', adjustment: 0, textAr: blockReasonAr });
    }

    if (regimeGateStatus !== 'CLEAR') {
      signalType = 'NO_TRADE';
      spotAction = 'SPOT_HOLD';
      if (buyScore >= STRATEGY_THRESHOLDS.ENTRY_QUALITY_MIN_SCORE) {
        reasons.push({
          tag: 'TREND',
          adjustment: 0,
          textAr: `الدرجة كانت ${buyScore} كافية للشراء لكن بوابة المخاطر منعت الدخول — الإشارة محفوظة للتدقيق`,
        });
      }
    }
  }

  // ─── أهداف المخاطرة من ملف الثوابت حصراً ───
  const entryPrice = s.close;
  const targets = computeRiskTargets(entryPrice, s.atr14);

  const summaryAr =
    signalType === 'STRONG_BUY' ? 'قناعة شرائية قوية — كل الشروط الفنية متوافقة'
    : signalType === 'BUY' ? 'إشارة شراء بدرجة كافية لتجاوز بوابة الجودة'
    : signalType === 'SELL' ? 'ضعف فني واضح — تخفيف أو خروج'
    : signalType === 'STRONG_SELL' ? 'انهيار فني — خروج دفاعي فوري'
    : signalType === 'NO_TRADE' ? (blockReasonAr || 'بوابة مخاطر منعت الدخول')
    : 'لا إشارة — الانتظار أفضل';

  return {
    asset,
    engineSignature: ENGINE_SIGNATURE,
    learningBias: learningBiasValue !== 0 ? learningBiasValue : undefined,
    convictionScore: score,
    signalType,
    spotAction,
    entryPrice,
    stopLoss: targets.stopLoss,
    target1: targets.target1,
    target2: targets.target2,
    target3: targets.target3,
    riskRewardRatio: targets.riskRewardRatio,
    regimeGateStatus,
    blockReasonAr,
    reasons,
    summaryAr,
    generatedAt: Date.now(),
    dedupHash: fnv1a64Hex(`${asset}|${signalType}|${regimeGateStatus}|${Math.round(entryPrice)}`),
    dataSource: ctx.dataSource,
    htfAvailable: htf !== null,
    // ─── حقول v2.0 ───
    entryZone: ctx.entryZone
      ? {
          low: Math.round(ctx.entryZone.low),
          high: Math.round(ctx.entryZone.high),
          basisAr: 'منطقة ارتداد: بين EMA21 وتصحيح 38.2-50% لآخر موجة',
          priceInside:
            ctx.entryZone.low <= s.close && s.close <= ctx.entryZone.high,
        }
      : null,
    chaseWarning: s.close - s.ema21 > STRATEGY_THRESHOLDS.CHASE_ATR_DISTANCE * s.atr14,
    smc: ctx.smc ?? null,
    liquidity: ctx.liquidity
      ? { adjustment: ctx.liquidity.totalAdjustment, verdict: ctx.liquidity.verdict, summaryAr: ctx.liquidity.summaryAr }
      : null,
    dailyTrend: ctx.daily
      ? ctx.daily.bullish && !ctx.daily.bearish
        ? 'BULLISH'
        : ctx.daily.bearish && !ctx.daily.bullish
          ? 'BEARISH'
          : 'UNKNOWN'
      : 'UNKNOWN',
  };
}
