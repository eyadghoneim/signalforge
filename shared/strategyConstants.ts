// الثوابت الكمية الموحدة — يُستوردها السيرفر والواجهة معاً (مصدر واحد منعَ للتناقضات)
import type { SignalType, SpotAction } from './types';

export const ENGINE_SIGNATURE =
  'SignalForge Deterministic Engine v3.1 (MTF+Daily+Regime+SMC+RVOL+Funding+FNG+Whale+OI+Pattern) + Attribution + Learning';

export const STRATEGY_THRESHOLDS = {
  ENTRY_QUALITY_MIN_SCORE: 70, // الحد الأدنى للسماح بشراء
  STRONG_BUY_MIN_SCORE: 82, // درجة القناعة القوية
  BUY_MIN_SCORE: 70,
  WAIT_MIN_SCORE: 45, // 45..69 انتظار
  SELL_MAX_SCORE: 32, // 33..32 خروج دفاعي
  STRONG_SELL_MAX_SCORE: 20,
  CHOP_ADX_MAX: 18, // سوق عرضي خامل
  RVOL_BLOCK_MAX: 0.45, // فوليوم شبه معدوم
  RVOL_BONUS_MIN: 1.3, // فوليوم تأكيد
  FUNDING_SQUEEZE_PCT_8H: 0.04, // تمويل مرتفع لكل 8 ساعات
  HTF_EMA_PERIOD: 200,
  HTF_EMA_FAST: 21,
  HTF_EMA_SLOW: 50,
  CHASE_ATR_DISTANCE: 2.0, // تحذير المطاردة: الابتعاد عن EMA21 بأكثر من 2×ATR
} as const;

export const STRATEGY_RISK_MULTIPLIERS = {
  STOP_LOSS_ATR: 2.0, // وقف = الدخول − 2×ATR
  TARGET_1_ATR: 2.5, // TP1 = الدخول + 2.5×ATR → R:R ≈ 1.25
  TARGET_2_ATR: 4.0, // TP2 → R:R = 2.0
  TARGET_3_ATR: 5.5, // TP3 → R:R = 2.75
  STOP_SLIPPAGE_ATR: 0.15, // انزلاق تنفيذي واقعي لأوامر Stop-Market عند ضرب الوقف (كنسبة من ATR)
} as const;

// ─── وقف متحرك مدرّج (freqtrade-style: trailing_only_offset_is_reached) ───
// لا يتحرك الإيقاف قبل أن يتجاوز الربح العتبة؛ بعدها يتبع القمة بهامش،
// ويضيق الهامش تلقائياً عند مستويات ربح أعلى لقفل المزيد من الأرباح.
export const TRAILING = {
  ACTIVATE_AFTER_ATR: 1.0, // الربح (من الدخول) اللازم لتفعيل الرحل — يمنع الطرد المبكر
  OFFSET_ATR: 2.0, // هامش الرحل الافتراضي: القمة − 2×ATR
  TIGHT_OFFSET_ATR: 1.0, // هامش مضيق لقفل الأرباح أعلى
  TIGHT_AFTER_ATR: 2.0, // يعمل الهامش المضيق عندما يبلغ ربح القمة 2×ATR+
} as const;

export const ATTRIBUTION_WINDOWS_HOURS = [4, 24, 72] as const;

export const TELEGRAM_COOLDOWN_MS = 30 * 60 * 1000;

// Paper execution model: deterministic costs, never random, so tests and live
// paper results remain reproducible while approximating real taker execution.
export const PAPER_EXECUTION = {
  FEE_RATE: 0.00075, // 0.075% per filled side
  SLIPPAGE_RATE: 0.0005, // 0.05% adverse price movement per fill
} as const;

// دالة التحويل المركزية — لا يُسمح لأي كود آخر باستنتاج النوع من الدرجة
export function deriveSignalTypeAndAction(score: number): {
  signalType: SignalType;
  spotAction: SpotAction;
} {
  if (score <= STRATEGY_THRESHOLDS.STRONG_SELL_MAX_SCORE)
    return { signalType: 'STRONG_SELL', spotAction: 'SPOT_SELL_ALL' };
  if (score <= STRATEGY_THRESHOLDS.SELL_MAX_SCORE)
    return { signalType: 'SELL', spotAction: 'SPOT_SELL_ALL' };
  if (score >= STRATEGY_THRESHOLDS.STRONG_BUY_MIN_SCORE)
    return { signalType: 'STRONG_BUY', spotAction: 'SPOT_BUY' };
  if (score >= STRATEGY_THRESHOLDS.BUY_MIN_SCORE)
    return { signalType: 'BUY', spotAction: 'SPOT_BUY' };
  return { signalType: 'HOLD', spotAction: 'SPOT_HOLD' };
}

// أهداف المخاطرة — المضاعفات تأتي حصراً من ملف الثوابت
export function computeRiskTargets(entryPrice: number, atr: number): {
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskRewardRatio: number;
} {
  const m = STRATEGY_RISK_MULTIPLIERS;
  const effAtr = atr > 0 ? atr : entryPrice * 0.0015;
  const stopLoss = Math.round(entryPrice - m.STOP_LOSS_ATR * effAtr);
  const target1 = Math.round(entryPrice + m.TARGET_1_ATR * effAtr);
  const target2 = Math.round(entryPrice + m.TARGET_2_ATR * effAtr);
  const target3 = Math.round(entryPrice + m.TARGET_3_ATR * effAtr);
  const riskRewardRatio =
    entryPrice > stopLoss ? Number(((target1 - entryPrice) / (entryPrice - stopLoss)).toFixed(2)) : 0;
  return { stopLoss, target1, target2, target3, riskRewardRatio };
}

export function fnv1a64Hex(input: string): string {
  // FNV-1a 64-bit (بمحاكاة 32×2 على JS) — ثابت ومتزامن بين الطرفين
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x85ebca6b);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
  );
}
