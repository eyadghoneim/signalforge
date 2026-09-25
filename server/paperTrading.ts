// محفظة تداول ورقية (Paper Trading) — حساب افتراضي يبدأ بـ $10,000.
// مرآة حية للمحرك: تفتح صفقة شراء عندما يقول المحرك BUY (بعد البوابات والحماية)،
// وتسيرها على نفس سلم الأهداف (50/30/20) ووقف الخسارة بنفس انزلاق الثوابت — فتفضل
// النتيجة مرآة صادقة للباك تست في الزمن الحي. لا أوامر حقيقية أبداً.
//
// التزامن: الكتابة على القرص ذرية (tmp + rename) — نفس نمط الـ persistence.
import * as fs from 'fs';
import * as path from 'path';
import type { PaperTradeOutcome, Signal, SupportedAsset } from '../shared/types';
import { PAPER_EXECUTION, STRATEGY_RISK_MULTIPLIERS, TARGET_RATIOS, TRAILING } from '../shared/strategyConstants';
import { DEFAULT_PROTECTION } from './protection';
import { getDurablePersistence } from './persistence';

export const PAPER_INITIAL_EQUITY = 10_000;
export const PAPER_RISK_PERCENT = 1; // مخاطرة لكل صفقة: 1% من إجمالي Equity المتاح
const TP1_RATIO = TARGET_RATIOS.TP1; // أول جني: نصف الكمية
const TP2_RATIO = TARGET_RATIOS.TP2; // ثاني جني: 30% من الكمية الأصلية
// (تم توحيد ثوابت الرحل في shared/strategyConstants.ts → TRAILING)

const DATA_DIR = path.join(process.cwd(), 'data');
const PAPER_FILE = path.join(DATA_DIR, 'paper.json');
const MAX_CLOSED = 100;
const MAX_EQUITY_POINTS = 2000;

export interface PaperCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number; // epoch seconds
}

export interface PaperPosition {
  id: string;
  asset: SupportedAsset;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  qty: number; // الكمية المتبقية حالياً
  qtyOpen: number; // الكمية الأصلية
  feesPaid?: number; // entry + partial exit fees; optional for legacy JSON positions
  pnlAccum: number; // الربح المحصَّل من الجني الجزئي (TP1/TP2)
  openedAtSec: number;
  tp1Taken: boolean;
  tp2Taken: boolean;
  atrEntry: number;
  trailPeak: number;
}

export interface PaperTrade {
  id: string;
  asset: SupportedAsset;
  openedAt: number;
  closedAt: number;
  entry: number;
  exitAvg: number;
  qty: number;
  pnlUsd: number;
  feesUsd?: number;
  reason: 'TP3' | 'SL' | 'SELL_SIGNAL' | 'TIME';
  /** First decisive paper outcome, used by the deterministic protection streak. */
  outcome?: PaperTradeOutcome;
}

export interface PaperAccount {
  startingEquity: number;
  cash: number;
  realizedPnl: number;
  open: PaperPosition[];
  closed: PaperTrade[];
  equityCurve: { time: number; equity: number }[];
  updatedAt: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

function feeFor(notional: number): number {
  return Math.max(0, notional) * PAPER_EXECUTION.FEE_RATE;
}

function buyFillPrice(markPrice: number): number {
  return markPrice * (1 + PAPER_EXECUTION.SLIPPAGE_RATE);
}

function sellFillPrice(markPrice: number): number {
  return Math.max(0, markPrice * (1 - PAPER_EXECUTION.SLIPPAGE_RATE));
}

export function defaultPaperAccount(): PaperAccount {
  return {
    startingEquity: PAPER_INITIAL_EQUITY,
    cash: PAPER_INITIAL_EQUITY,
    realizedPnl: 0,
    open: [],
    closed: [],
    equityCurve: [{ time: Date.now(), equity: PAPER_INITIAL_EQUITY }],
    updatedAt: Date.now(),
  };
}

/** الرصيد الحالي = كاش + قيمة المراكز المفتوحة بالسعر الحالي. */
export function currentEquity(acct: PaperAccount, prices: Partial<Record<SupportedAsset, number>>): number {
  let openValue = 0;
  for (const p of acct.open) {
    const price = sellFillPrice(prices[p.asset] ?? p.entry);
    openValue += p.qty * price - feeFor(p.qty * price);
  }
  return round2(acct.cash + openValue);
}

/** يفتح صفقة شراء ورقية من إشارة حقيقية — حجم محسوب بـ 1% مخاطرة من إجمالي Equity، مع قيد الكاش. */
export function openBuy(
  acct: PaperAccount,
  signal: Signal,
  atrEntry: number,
  nowMs: number,
  maxOpenPositions = DEFAULT_PROTECTION.maxConcurrentSignals,
  markPrices: Partial<Record<SupportedAsset, number>> = {},
): PaperAccount {
  const markEntry = signal.entryPrice;
  const entry = buyFillPrice(markEntry);
  const stop = signal.stopLoss;
  const riskDistance = entry - stop;
  if (!Number.isFinite(markEntry) || markEntry <= 0 || !Number.isFinite(entry) || !(riskDistance > 0)) return acct;
  const positionCap = Math.max(1, Math.floor(Number(maxOpenPositions) || DEFAULT_PROTECTION.maxConcurrentSignals));
  if (acct.open.length >= positionCap) return acct;
  if (acct.open.some((p) => p.asset === signal.asset)) return acct; // مركز واحد لكل أصل

  const sizingEquity = currentEquity(acct, markPrices);
  const riskAmount = sizingEquity * (PAPER_RISK_PERCENT / 100);
  let qty = riskAmount / riskDistance;
  // Keep the whole entry outlay (notional + entry fee) within the 95% cash cap.
  const maxEntryOutlay = acct.cash * 0.95;
  const maxEntryNotional = maxEntryOutlay / (1 + PAPER_EXECUTION.FEE_RATE);
  const notional = qty * entry;
  if (notional > maxEntryNotional) qty = maxEntryNotional / entry;
  if (!(qty > 0)) return acct;

  const entryNotional = qty * entry;
  const entryFee = feeFor(entryNotional);
  acct.cash = round2(acct.cash - entryNotional - entryFee);
  acct.open.push({
    id: `${signal.asset}-${nowMs}`,
    asset: signal.asset,
    entry,
    stop,
    tp1: signal.target1,
    tp2: signal.target2,
    tp3: signal.target3,
    qty,
    qtyOpen: qty,
    feesPaid: entryFee,
    pnlAccum: -entryFee,
    openedAtSec: Math.floor(nowMs / 1000),
    tp1Taken: false,
    tp2Taken: false,
    atrEntry: Number.isFinite(atrEntry) && atrEntry > 0 ? atrEntry : entry * 0.001,
    trailPeak: entry,
  });
  acct.updatedAt = nowMs;
  return acct;
}

/** تقفل كامل كمية متبقية وتدفع الكاش — متوسط الخروج موزون بنسب الجني السابقة. */
function closeRemainder(
  acct: PaperAccount,
  p: PaperPosition,
  exitPrice: number,
  reason: PaperTrade['reason'],
  nowMs: number,
): void {
  const fillPrice = sellFillPrice(exitPrice);
  const proceeds = fillPrice * p.qty;
  const exitFee = feeFor(proceeds);
  acct.cash = round2(acct.cash + proceeds - exitFee);
  // متوسط الخروج موزوناً بكل الشرائح المنفذة، بما فيها حالة TP1 فقط.
  const tp1Ratio = p.tp1Taken ? TP1_RATIO : 0;
  const tp2Ratio = p.tp2Taken ? TP2_RATIO : 0;
  const remRatio = Math.max(0, 1 - tp1Ratio - tp2Ratio);
  const tp1Fill = p.tp1Taken ? sellFillPrice(p.tp1) : 0;
  const tp2Fill = p.tp2Taken ? sellFillPrice(p.tp2) : 0;
  const exitAvg = tp1Ratio * tp1Fill + tp2Ratio * tp2Fill + remRatio * fillPrice;
  const totalFees = round2((p.feesPaid ?? 0) + exitFee);
  const totalPnl = round2(p.pnlAccum + (fillPrice - p.entry) * p.qty - exitFee);
  const outcome: PaperTradeOutcome =
    reason === 'SL' && !p.tp1Taken ? 'SL_FIRST'
    : p.tp1Taken || reason === 'TP3' ? 'TP1_FIRST'
    : reason === 'TIME' ? 'TIME'
    : 'SELL_SIGNAL';
  acct.realizedPnl = round2(acct.realizedPnl + totalPnl);
  acct.closed.push({
    id: p.id,
    asset: p.asset,
    openedAt: p.openedAtSec * 1000,
    closedAt: nowMs,
    entry: p.entry,
    exitAvg: round2(exitAvg),
    qty: round2(p.qtyOpen),
    pnlUsd: totalPnl,
    feesUsd: totalFees,
    reason,
    outcome,
  });
  if (acct.closed.length > MAX_CLOSED) acct.closed.splice(0, acct.closed.length - MAX_CLOSED);
}

/** يقفل مركز الأصل كاملاً استجابة لإشارة بيع/خروج من المحرك. */
export function closeBySellSignal(acct: PaperAccount, asset: SupportedAsset, price: number, nowMs: number): PaperAccount {
  const remaining: PaperPosition[] = [];
  for (const p of acct.open) {
    if (p.asset !== asset) {
      remaining.push(p);
      continue;
    }
    const exit = Number.isFinite(price) && price > 0 ? price : p.entry;
    closeRemainder(acct, p, exit, 'SELL_SIGNAL', nowMs);
  }
  acct.open = remaining;
  acct.updatedAt = nowMs;
  return acct;
}

/** يسير كل المراكز بآخر شمعة — وقف أولاً (متحفظ) ثم سلم الأهداف ثم الإيقاف المتحرك. */
export function markToMarket(
  acct: PaperAccount,
  prices: Partial<Record<SupportedAsset, number>>,
  candles: Partial<Record<SupportedAsset, PaperCandle>>,
  nowMs: number,
  maxHoldHours = DEFAULT_PROTECTION.paperMaxHoldHours,
): PaperAccount {
  const surviving: PaperPosition[] = [];
  for (const p of acct.open) {
    const candle = candles[p.asset];
    const price = prices[p.asset] ?? p.entry;
    const holdExpired = maxHoldHours > 0 && nowMs - p.openedAtSec * 1000 >= maxHoldHours * 3600_000;
    const hasNewCandle = Boolean(candle && candle.time > p.openedAtSec);
    // Do not evaluate price targets on the opening candle. A time limit still
    // closes at the current mark when no newer candle is available.
    if (!hasNewCandle) {
      if (holdExpired) {
        closeRemainder(acct, p, price, 'TIME', nowMs);
        continue;
      }
      surviving.push(p);
      continue;
    }
    if (!candle) {
      surviving.push(p);
      continue;
    }

    // 1) الوقف أولاً (متحفظ — نفس ترتيب الباك تست بالضبط) بانزلاق الثوابت
    if (candle.low <= p.stop) {
      const slippage = p.atrEntry * STRATEGY_RISK_MULTIPLIERS.STOP_SLIPPAGE_ATR;
      const exit = Math.min(candle.open, p.stop - slippage);
      closeRemainder(acct, p, exit, 'SL', nowMs);
      continue;
    }

    // 2) جني TP1 ثم TP2 (كميات ثابتة من الكمية الأصلية)
    if (!p.tp1Taken && candle.high >= p.tp1) {
      const out = p.qtyOpen * TP1_RATIO;
      const fillPrice = sellFillPrice(p.tp1);
      const proceeds = fillPrice * out;
      const exitFee = feeFor(proceeds);
      p.qty = round8(Math.max(0, p.qty - out));
      p.feesPaid = round2((p.feesPaid ?? 0) + exitFee);
      p.pnlAccum = round2(p.pnlAccum + (fillPrice - p.entry) * out - exitFee);
      acct.cash = round2(acct.cash + proceeds - exitFee);
      p.tp1Taken = true;
      // رفع الوقف فوراً إلى نقطة التعادل + تغطية الرسوم (True Breakeven)
      const breakevenPlusFees = p.entry * (1 + PAPER_EXECUTION.FEE_RATE * 2);
      p.stop = Math.max(p.stop, breakevenPlusFees);
    }
    if (p.tp1Taken && !p.tp2Taken && candle.high >= p.tp2) {
      const out = p.qtyOpen * TP2_RATIO;
      const fillPrice = sellFillPrice(p.tp2);
      const proceeds = fillPrice * out;
      const exitFee = feeFor(proceeds);
      p.qty = round8(Math.max(0, p.qty - out));
      p.feesPaid = round2((p.feesPaid ?? 0) + exitFee);
      p.pnlAccum = round2(p.pnlAccum + (fillPrice - p.entry) * out - exitFee);
      acct.cash = round2(acct.cash + proceeds - exitFee);
      p.tp2Taken = true;
    }

    // 3) الهدف الثالث: قفل الكمية المتبقية كاملة (يُقيَّم بعد تجهيز أي جني في نفس الشمعة)
    if (p.tp2Taken && p.tp3 > 0 && candle.high >= p.tp3) {
      closeRemainder(acct, p, p.tp3, 'TP3', nowMs);
      continue;
    }

    // 4) خروج بالزمن إذا انتهت أقصى فترة احتفاظ
    if (holdExpired) {
      closeRemainder(acct, p, price, 'TIME', nowMs);
      continue;
    }

    // 5) وقف متحرك مدرّج ذكي (Trailing Stop Loss) لتأمين الأرباح تصاعدياً
    p.trailPeak = Math.max(p.trailPeak, candle.high);
    const profitAtr = p.atrEntry > 0 ? (p.trailPeak - p.entry) / p.atrEntry : 0;
    if (profitAtr >= TRAILING.ACTIVATE_AFTER_ATR || p.tp1Taken) {
      const offset = (p.tp2Taken || profitAtr >= TRAILING.TIGHT_AFTER_ATR) ? TRAILING.TIGHT_OFFSET_ATR : TRAILING.OFFSET_ATR;
      const trail = p.trailPeak - p.atrEntry * offset;
      if (trail > p.stop) p.stop = round2(trail);
    }

    surviving.push(p);
  }
  acct.open = surviving;

  // 4) نقطة منحنى رصيد (مرة كل دقيقة على الأقل)
  const equity = currentEquity(acct, prices);
  const last = acct.equityCurve[acct.equityCurve.length - 1];
  if (!last || nowMs - last.time >= 60_000) {
    acct.equityCurve.push({ time: nowMs, equity });
    if (acct.equityCurve.length > MAX_EQUITY_POINTS) acct.equityCurve.splice(0, acct.equityCurve.length - MAX_EQUITY_POINTS);
  }
  acct.updatedAt = nowMs;
  return acct;
}

// ─── الاستمرارية: ذري (tmp + rename) — مثل طبقة التخزين ───
export function loadPaperAccount(): PaperAccount {
  const durable = getDurablePersistence();
  if (durable) return durable.loadPaperAccount(defaultPaperAccount());
  try {
    if (fs.existsSync(PAPER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PAPER_FILE, 'utf-8')) as PaperAccount;
      if (typeof parsed?.cash === 'number' && Array.isArray(parsed?.open)) return parsed;
    }
  } catch {
    // ملف تالف → حساب جديد نظيف
  }
  return defaultPaperAccount();
}

export function savePaperAccount(acct: PaperAccount): void {
  const durable = getDurablePersistence();
  if (durable) {
    durable.savePaperAccount(acct);
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${PAPER_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(acct, null, 2), 'utf-8');
    fs.renameSync(tmp, PAPER_FILE);
  } catch {
    // الحفظ اختياري — الفشل لا يوقف المسح
  }
}

export function resetPaperAccount(): PaperAccount {
  const fresh = defaultPaperAccount();
  savePaperAccount(fresh);
  return fresh;
}

/** لقطة سطحية مستقلة — تُستخدم قبل أي تعديل لحساب الفرق (diff) الصحيح للأحداث. */
export function snapshotPaperAccount(acct: PaperAccount): PaperAccount {
  return {
    ...acct,
    open: acct.open.map((p) => ({ ...p })),
    closed: acct.closed.slice(),
    equityCurve: acct.equityCurve.slice(),
  };
}

// ─── أحداث المحفظة (لتنبيهات تليجرام) ───
// نستنتج الأحداث بفرق الحالتين (قبل/بعد) بدل ربط أكواد غير ضرورية في منطق التسيير.
export type PaperEvent =
  | { kind: 'OPENED'; asset: SupportedAsset; pos: PaperPosition }
  | { kind: 'TP1'; asset: SupportedAsset; pos: PaperPosition }
  | { kind: 'TP2'; asset: SupportedAsset; pos: PaperPosition }
  | { kind: 'CLOSED'; asset: SupportedAsset; trade?: PaperTrade; posBefore?: PaperPosition };

export function diffPaperEvents(before: PaperAccount, after: PaperAccount): PaperEvent[] {
  const events: PaperEvent[] = [];
  const beforeOpen = new Map(before.open.map((p) => [p.id, p] as const));
  const afterOpen = new Map(after.open.map((p) => [p.id, p] as const));

  for (const [id, b] of beforeOpen) {
    const a = afterOpen.get(id);
    if (!a) {
      const trade = after.closed.find((t) => t.id === id);
      events.push({ kind: 'CLOSED', asset: b.asset, trade, posBefore: b });
      continue;
    }
    if (!b.tp1Taken && a.tp1Taken) events.push({ kind: 'TP1', asset: a.asset, pos: a });
    if (!b.tp2Taken && a.tp2Taken) events.push({ kind: 'TP2', asset: a.asset, pos: a });
  }
  for (const [id, a] of afterOpen) {
    if (!beforeOpen.has(id)) events.push({ kind: 'OPENED', asset: a.asset, pos: a });
  }
  return events;
}
