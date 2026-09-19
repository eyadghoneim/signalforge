import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, RefreshCw, TrendingUp, TrendingDown, RotateCcw, Activity } from 'lucide-react';
import { api, type PaperAccountInfo } from '../api';
import type { Lang } from '../i18n';

const TXT = {
  ar: {
    title: 'المحفظة الورقية (محاكاة)',
    subtitle: 'حساب وهمي بـ $10,000 — بيقلد إشارات المحرك الحقيقية بنفس الوقف والأهداف. مفيش فلوس حقيقية.',
    equity: 'الرصيد الحالي',
    realized: 'الربح/الخسارة المحصلة',
    starting: 'رصيد البداية',
    curve: 'منحنى الرصيد',
    dd: 'تراجع',
    return30d: 'آخر 30 يوم',
    winRate: 'نسبة النجاح',
    trades: 'صفقات مقفولة',
    profitFactor: 'عامل الربح',
    maxDd: 'أقصى تراجع',
    avgWin: 'متوسط الربح',
    avgLoss: 'متوسط الخسارة',
    noTradesYet: 'لسه مفيش صفقات مقفولة — الإحصائيات هتظهر مع أول صفقة',
    updated: 'آخر تحديث',
    open: 'صفقات مفتوحة',
    closed: 'آخر الصفقات المقفولة',
    noOpen: 'مفيش صفقات مفتوحة دلوقتي — بيستنى إشارة شراء تمر من البوابات',
    noClosed: 'لسه مفيش صفقات مقفولة',
    reset: 'تصفير',
    refresh: 'تحديث',
    qty: 'كمية',
    fees: 'رسوم',
  },
  en: {
    title: 'Paper wallet (simulation)',
    subtitle: 'A virtual $10,000 account mirroring the live engine signals (same stop/targets). No real money.',
    equity: 'Current equity',
    realized: 'Realized P&L',
    starting: 'Starting balance',
    curve: 'Equity curve',
    dd: 'Drawdown',
    return30d: 'Last 30 days',
    winRate: 'Win rate',
    trades: 'Closed trades',
    profitFactor: 'Profit factor',
    maxDd: 'Max drawdown',
    avgWin: 'Avg win',
    avgLoss: 'Avg loss',
    noTradesYet: 'No closed trades yet — stats appear with the first trade',
    updated: 'Updated',
    open: 'Open positions',
    closed: 'Recently closed',
    noOpen: 'No open positions — waiting for a buy signal that passes the gates',
    noClosed: 'No closed trades yet',
    reset: 'Reset',
    refresh: 'Refresh',
    qty: 'Qty',
    fees: 'Fees',
  },
};

function computeStats(acct: PaperAccountInfo) {
  const trades = acct.closed;
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const winRate = trades.length ? (wins.length / trades.length) * 100 : null;

  let peak = 0;
  let maxDd = 0;
  for (const p of acct.equityCurve) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - p.equity) / peak) * 100);
  }

  const curve = acct.equityCurve;
  const last = curve.length ? curve[curve.length - 1].equity : acct.startingEquity;
  let return30d: number | null = null;
  if (curve.length >= 1) {
    const latest = curve[curve.length - 1].time;
    const cutoff = latest - 30 * 24 * 3600 * 1000;
    const base = curve.find((p) => p.time >= cutoff) ?? curve[0];
    if (base.equity > 0) return30d = ((last - base.equity) / base.equity) * 100;
  }

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    profitFactor: trades.length ? (grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null) : null,
    maxDd,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -(grossLoss / losses.length) : null,
    return30d,
  };
}

function Sparkline({ points, positive }: { points: { time: number; equity: number }[]; positive: boolean }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const n = points.length;
  const xAt = (i: number) => (i / (n - 1)) * 100;
  const yAt = (v: number) => 40 - ((v - min) / range) * 36 - 2;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(p.equity).toFixed(2)}`).join(' ');
  const area = `${line} L100,40 L0,40 Z`;
  const color = positive ? '#34d399' : '#fb7185';
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-14 w-full" style={{ direction: 'ltr' }}>
      <defs>
        <linearGradient id="paperEq" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#paperEq)" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export default function PaperPanel({ lang }: { lang: Lang }) {
  const [acct, setAcct] = useState<PaperAccountInfo | null>(null);
  const [initialEquity, setInitialEquity] = useState(10_000);
  const [loading, setLoading] = useState(true);
  const x = TXT[lang];

  const load = useCallback(async () => {
    try {
      const d = await api.paper();
      setAcct(d.account);
      setInitialEquity(d.initialEquity);
    } catch {
      // ignore — keep last state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const reset = async () => {
    try {
      await api.resetPaper();
      await load();
    } catch {
      // ignore
    }
  };

  const stats = useMemo(() => (acct ? computeStats(acct) : null), [acct]);

  if (loading || !acct || !stats) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-500">{x.title}…</div>
    );
  }

  const equity = acct.equityCurve.length ? acct.equityCurve[acct.equityCurve.length - 1].equity : acct.startingEquity;
  const totalPnl = equity - initialEquity;
  const pnlCls = totalPnl >= 0 ? 'text-emerald-300' : 'text-rose-300';

  const money = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
          <Wallet size={16} className="text-amber-400" />
          {x.title}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => void load()} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 hover:text-zinc-200" title={x.refresh}>
            <RefreshCw size={13} />
          </button>
          <button onClick={() => void reset()} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 hover:text-rose-300" title={x.reset}>
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
      <p className="mb-3 text-[10px] leading-4 text-zinc-500">{x.subtitle}</p>

      {/* بطاقات الرصيد */}
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-zinc-800/60 p-2">
          <div className="text-[9px] text-zinc-500">{x.equity}</div>
          <div className="text-sm font-extrabold tabular-nums text-zinc-100" dir="ltr">{money(equity)}</div>
          <div className={`flex items-center justify-center gap-1 text-[10px] font-bold ${pnlCls}`} dir="ltr">
            {totalPnl >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {signed(totalPnl)}
          </div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <div className="text-[9px] text-emerald-400/70">{x.realized}</div>
          <div className="text-sm font-extrabold tabular-nums text-emerald-300" dir="ltr">{money(acct.realizedPnl)}</div>
        </div>
        <div className="rounded-lg bg-zinc-800/40 p-2">
          <div className="text-[9px] text-zinc-500">{x.starting}</div>
          <div className="text-sm font-extrabold tabular-nums text-zinc-400" dir="ltr">{money(initialEquity)}</div>
        </div>
      </div>

      {/* منحنى الرصيد */}
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500">
          <Activity size={11} className="text-zinc-500" /> {x.curve}
        </div>
        <div className="flex items-center gap-2 text-[9px] tabular-nums" dir="ltr">
          {stats.return30d !== null && (
            <span className={stats.return30d >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {x.return30d} {stats.return30d >= 0 ? '+' : ''}{stats.return30d.toFixed(1)}%
            </span>
          )}
          <span className="text-amber-400/80">{x.dd} {stats.maxDd.toFixed(1)}%</span>
        </div>
      </div>
      {acct.equityCurve.length >= 2 ? (
        <Sparkline points={acct.equityCurve} positive={totalPnl >= 0} />
      ) : (
        <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-[9px] text-zinc-600">
          {x.curve}…
        </div>
      )}

      {/* إحصائيات */}
      {stats.total > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-lg bg-zinc-800/50 p-1.5">
            <div className="text-[8px] text-zinc-500">{x.winRate}</div>
            <div className={`text-[11px] font-extrabold tabular-nums ${(stats.winRate ?? 0) >= 50 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">
              {stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-800/50 p-1.5">
            <div className="text-[8px] text-zinc-500">{x.trades}</div>
            <div className="text-[11px] font-extrabold tabular-nums text-zinc-200" dir="ltr">{stats.total}</div>
          </div>
          <div className="rounded-lg bg-zinc-800/50 p-1.5">
            <div className="text-[8px] text-zinc-500">{x.profitFactor}</div>
            <div className="text-[11px] font-extrabold tabular-nums text-amber-300" dir="ltr">
              {stats.profitFactor === null ? '—' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-800/50 p-1.5">
            <div className="text-[8px] text-zinc-500">{x.maxDd}</div>
            <div className="text-[11px] font-extrabold tabular-nums text-amber-300" dir="ltr">{stats.maxDd.toFixed(1)}%</div>
          </div>
          <div className="rounded-lg bg-zinc-800/50 p-1.5">
            <div className="text-[8px] text-zinc-500">{x.avgWin}</div>
            <div className="text-[11px] font-extrabold tabular-nums text-emerald-300" dir="ltr">
              {stats.avgWin !== null ? money(stats.avgWin) : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-800/50 p-1.5">
            <div className="text-[8px] text-zinc-500">{x.avgLoss}</div>
            <div className="text-[11px] font-extrabold tabular-nums text-rose-300" dir="ltr">
              {stats.avgLoss !== null ? money(stats.avgLoss) : '—'}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-dashed border-zinc-800 p-2 text-center text-[9px] text-zinc-600">{x.noTradesYet}</div>
      )}

      <div className="mt-2 text-right text-[8px] text-zinc-600" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {x.updated}{' '}
        <span dir="ltr">{acct.updatedAt ? new Date(acct.updatedAt).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
      </div>

      {/* صفقات مفتوحة */}
      <div className="mb-2 mt-3 text-[10px] font-bold text-zinc-500">{x.open}</div>
      {acct.open.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-2 text-[10px] text-zinc-600">{x.noOpen}</div>
      ) : (
        <div className="space-y-1.5">
          {acct.open.map((p) => {
            return (
              <div key={p.id} className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-zinc-300" dir="ltr">{p.asset}</span>
                <span className="text-zinc-400" dir="ltr">{x.qty} {p.qty.toFixed(6)}</span>
                <span className="text-zinc-400" dir="ltr">@{p.entry.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                <span className="text-zinc-500" dir="ltr">{x.fees} {p.feesPaid?.toFixed(2) ?? '—'}</span>
                <span className={`font-bold ${p.pnlAccum >= 0 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">
                  {p.pnlAccum >= 0 ? '+' : ''}{p.pnlAccum.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* صفقات مقفولة */}
      <div className="mb-1 mt-3 text-[10px] font-bold text-zinc-500">{x.closed}</div>
      {acct.closed.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-2 text-[10px] text-zinc-600">{x.noClosed}</div>
      ) : (
        <div className="space-y-1">
          {acct.closed.slice(0, 8).map((t2) => (
            <div key={t2.id} className="flex items-center justify-between text-[10px]">
              <span className="font-bold text-zinc-300" dir="ltr">{t2.asset}</span>
              <span className={`font-mono text-[9px] ${t2.reason === 'SELL_SIGNAL' || t2.reason === 'TIME' ? 'text-amber-300' : t2.reason === 'SL' ? 'text-rose-300' : 'text-emerald-300'}`}>
                {t2.reason}
              </span>
              <span className="text-zinc-500" dir="ltr">{x.fees} {t2.feesUsd?.toFixed(2) ?? '—'}</span>
              <span className={`font-bold ${t2.pnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">
                {t2.pnlUsd >= 0 ? '+' : ''}{t2.pnlUsd.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
