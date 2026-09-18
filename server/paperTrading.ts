// محفظة تداول ورقية (Paper Trading) — حساب افتراضي يبدأ بـ $10,000.
// مرآة حية للمحرك: تفتح صفقة شراء عندما يقول المحرك BUY (بعد البوابات والحماية)،
// وتسيرها على نفس سلم الأهداف (50/30/20) ووقف الخسارة بنفس انزلاق الثوابت — فتفضل
// النتيجة مرآة صادقة للباك تست في الزمن الحي. لا أوامر حقيقية أبداً.
//
// التزامن: الكتابة على القرص ذرية (tmp + rename) — نفس نمط الـ persistence.
import * as fs from 'fs';
import * as path from 'path';
import type { Signal, SupportedAsset } from '../shared/types';
import { STRATEGY_RISK_MULTIPLIERS, TRAILING } from '../shared/strategyConstants';

export const PAPER_INITIAL_EQUITY = 10_000;
export const PAPER_RISK_PERCENT = 1; // مخاطرة لكل صفقة: 1% من الرصيد المتاح
const TP1_RATIO = 0.5; // أول جني: نصف الكمية
const TP2_RATIO = 0.3; // ثاني جني: 30% من الكمية الأصلية
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
  reason: 'TP3' | 'SL' | 'SELL_SIGNAL';
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
    const price = prices[p.asset] ?? p.entry;
    openValue += p.qty * price;
  }
  return round2(acct.cash + openValue);
}

/** يفتح صفقة شراء ورقية من إشارة حقيقية — حجم محسوب بـ 1% مخاطرة من الرصيد. */
export function openBuy(acct: PaperAccount, signal: Signal, atrEntry: number, nowMs: number): PaperAccount {
  const entry = signal.entryPrice;
  const stop = signal.stopLoss;
  const riskDistance = entry - stop;
  if (!Number.isFinite(entry) || entry <= 0 || !(riskDistance > 0)) return acct;
  if (acct.open.some((p) => p.asset === signal.asset)) return acct; // مركز واحد لكل أصل

  const riskAmount = acct.cash * (PAPER_RISK_PERCENT / 100);
  let qty = riskAmount / riskDistance;
  const notional = qty * entry;
  if (notional > acct.cash * 0.95) qty = (acct.cash * 0.95) / entry;
  if (!(qty > 0)) return acct;

  acct.cash = round2(acct.cash - qty * entry);
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
    pnlAccum: 0,
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
  const proceeds = exitPrice * p.qty;
  acct.cash = round2(acct.cash + proceeds);
  // متوسط الخروج موزوناً بكل الشرائح المنفذة، بما فيها حالة TP1 فقط.
  const tp1Ratio = p.tp1Taken ? TP1_RATIO : 0;
  const tp2Ratio = p.tp2Taken ? TP2_RATIO : 0;
  const remRatio = Math.max(0, 1 - tp1Ratio - tp2Ratio);
  const exitAvg = tp1Ratio * p.tp1 + tp2Ratio * p.tp2 + remRatio * exitPrice;
  const totalPnl = round2(p.pnlAccum + (exitPrice - p.entry) * p.qty);
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
    reason,
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
): PaperAccount {
  const surviving: PaperPosition[] = [];
  for (const p of acct.open) {
    const candle = candles[p.asset];
    const price = prices[p.asset] ?? p.entry;
    void price;
    // لا نقيّم على شمعة فتح المركز (منع أي تسرب زمني داخل نفس الشمعة).
    if (!candle || candle.time <= p.openedAtSec) {
      surviving.push(p);
      continue;
    }

    // 0) وقف متحرك مدرّج (freqtrade-style) بعد TP2: لا يتحرك قبل 1×ATR ربح،
    // ثم يتبع القمة بهامش 2×ATR ويضيق إلى 1×ATR فوق 2×ATR ربح.
    if (p.tp2Taken) {
      p.trailPeak = Math.max(p.trailPeak, candle.high);
      const profitAtr = p.atrEntry > 0 ? (p.trailPeak - p.entry) / p.atrEntry : 0;
      if (profitAtr >= TRAILING.ACTIVATE_AFTER_ATR) {
        const offset = profitAtr >= TRAILING.TIGHT_AFTER_ATR ? TRAILING.TIGHT_OFFSET_ATR : TRAILING.OFFSET_ATR;
        const trail = p.trailPeak - p.atrEntry * offset;
        if (trail > p.stop) p.stop = trail;
      }
    }

    // 1) الوقف أولاً (متحفظ — نفس ترتيب الباك تست) بانزلاق الثوابت
    if (candle.low <= p.stop) {
      const slippage = p.atrEntry * STRATEGY_RISK_MULTIPLIERS.STOP_SLIPPAGE_ATR;
      const exit = Math.min(candle.open, p.stop - slippage);
      closeRemainder(acct, p, exit, 'SL', nowMs);
      continue;
    }

    // 2) جني TP1 ثم TP2 (كميات ثابتة من الكمية الأصلية)
    if (!p.tp1Taken && candle.high >= p.tp1) {
      const out = p.qtyOpen * TP1_RATIO;
      p.qty = round2(p.qty - out);
      p.pnlAccum = round2(p.pnlAccum + (p.tp1 - p.entry) * out);
      acct.cash = round2(acct.cash + p.tp1 * out);
      p.tp1Taken = true;
      p.stop = Math.max(p.stop, p.entry); // وقف تعادل بعد TP1
    }
    if (p.tp1Taken && !p.tp2Taken && candle.high >= p.tp2) {
      const out = p.qtyOpen * TP2_RATIO;
      p.qty = round2(p.qty - out);
      p.pnlAccum = round2(p.pnlAccum + (p.tp2 - p.entry) * out);
      acct.cash = round2(acct.cash + p.tp2 * out);
      p.tp2Taken = true;
    }

    // 3) الهدف الثالث: قفل الكمية المتبقية كاملة (يُقيَّم بعد تجهيز أي جني في نفس الشمعة)
    if (p.tp2Taken && p.tp3 > 0 && candle.high >= p.tp3) {
      closeRemainder(acct, p, p.tp3, 'TP3', nowMs);
      continue;
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
