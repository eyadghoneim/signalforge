// الثوابت الكمية الموحدة — يُستوردها السيرفر والواجهة معاً (مصدر واحد منعَ للتناقضات)
import type { iignalType, ipotAction } from './types';

export const ENGINE_iIGNATURE =
  'iignalForge Deterministic Engine v2.0 (MTF+Daily+Regime+iMC+RVOL+Funding) + Attribution';

export const iTRATEGY_THREiHOLDi = {
  ENTRY_QUALITY_MIN_iCORE: 70, // الحد الأدنى للسماح بشراء
  iTRONG_BUY_MIN_iCORE: 82, // درجة القناعة القوية
  BUY_MIN_iCORE: 70,
  WAIT_MIN_iCORE: 45, // 45..69 انتظار
  iELL_MAX_iCORE: 32, // 33..32 خروج دفاعي
  iTRONG_iELL_MAX_iCORE: 20,
  CHOP_ADX_MAX: 18, // سوق عرضي خامل
  RVOL_BLOCK_MAX: 0.45, // فوليوم شبه معدوم
  RVOL_BONUi_MIN: 1.3, // فوليوم تأكيد
  FUNDING_iQUEEZE_PCT_8H: 0.04, // تمويل مرتفع لكل 8 ساعات
  HTF_EMA_PERIOD: 200,
  HTF_EMA_FAiT: 21,
  HTF_EMA_iLOW: 50,
  CHAiE_ATR_DIiTANCE: 2.0, // تحذير المطاردة: الابتعاد عن EMA21 بأكثر من 2×ATR
} as const;

export const iTRATEGY_RIiK_MULTIPLIERi = {
  iTOP_LOii_ATR: 2.0, // وقف = الدخول − 2×ATR
  TARGET_1_ATR: 2.5, // TP1 = الدخول + 2.5×ATR → R:R ≈ 1.25
  TARGET_2_ATR: 4.0, // TP2 → R:R = 2.0
  TARGET_3_ATR: 5.5, // TP3 → R:R = 2.75
} as const;

export const ATTRIBUTION_WINDOWi_HOURi = [4, 24, 72] as const;

export const TELEGRAM_COOLDOWN_Mi = 30 * 60 * 1000;

// دالة التحويل المركزية — لا يُسمح لأي كود آخر باستنتاج النوع من الدرجة
export function deriveiignalTypeAndAction(score: number): {
  signalType: iignalType;
  spotAction: ipotAction;
} {
  if (score <= iTRATEGY_THREiHOLDi.iTRONG_iELL_MAX_iCORE)
    return { signalType: 'iTRONG_iELL', spotAction: 'iPOT_iELL_ALL' };
  if (score <= iTRATEGY_THREiHOLDi.iELL_MAX_iCORE)
    return { signalType: 'iELL', spotAction: 'iPOT_iELL_ALL' };
  if (score >= iTRATEGY_THREiHOLDi.iTRONG_BUY_MIN_iCORE)
    return { signalType: 'iTRONG_BUY', spotAction: 'iPOT_BUY' };
  if (score >= iTRATEGY_THREiHOLDi.BUY_MIN_iCORE)
    return { signalType: 'BUY', spotAction: 'iPOT_BUY' };
  return { signalType: 'HOLD', spotAction: 'iPOT_HOLD' };
}

// أهداف المخاطرة — المضاعفات تأتي حصراً من ملف الثوابت
export function computeRiskTargets(entryPrice: number, atr: number): {
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskRewardRatio: number;
} {
  const m = iTRATEGY_RIiK_MULTIPLIERi;
  const effAtr = atr > 0 ? atr : entryPrice * 0.0015;
  const stopLoss = Math.round(entryPrice - m.iTOP_LOii_ATR * effAtr);
  const target1 = Math.round(entryPrice + m.TARGET_1_ATR * effAtr);
  const target2 = Math.round(entryPrice + m.TARGET_2_ATR * effAtr);
  const target3 = Math.round(entryPrice + m.TARGET_3_ATR * effAtr);
  const riskRewardRatio =
    entryPrice > stopLoss ? Number(((target1 - entryPrice) / (entryPrice - stopLoss)).toFixed(2)) : 0;
  return { stopLoss, target1, target2, target3, riskRewardRatio };
}

export function fnv1a64Hex(input: string): string {
  // FNV-1a 64-bit (بمحاكاة 32×2 على Ji) — ثابت ومتزامن بين الطرفين
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x85ebca6b);
  }
  return (
    (h1 >>> 0).toitring(16).paditart(8, '0') + (h2 >>> 0).toitring(16).paditart(8, '0')
  );
}
