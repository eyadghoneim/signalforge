import { useCallback, useEffect, useState } from 'react';
import { Wallet, RefreshCw, TrendingUp, TrendingDown, RotateCcw } from 'lucide-react';
import { api, type PaperAccountInfo } from '../api';
import type { Lang } from '../i18n';

const TXT = {
  ar: {
    title: 'المحفظة الورقية (محاكاة)',
    subtitle: 'حساب وهمي بـ $10,000 — بيقلد إشارات المحرك الحقيقية بنفس الوقف والأهداف. مفيش فلوس حقيقية.',
    equity: 'الرصيد الحالي',
    realized: 'الربح/الخسارة المحصلة',
    starting: 'رصيد البداية',
    open: 'صفقات مفتوحة',
    closed: 'آخر الصفقات المقفولة',
    noOpen: 'مفيش صفقات مفتوحة دلوقتي — بيستنى إشارة شراء تمر من البوابات',
    noClosed: 'لسه مفيش صفقات مقفولة',
    reset: 'تصفير',
    refresh: 'تحديث',
    qty: 'كمية',
    realized2: 'محقق',
  },
  en: {
    title: 'Paper wallet (simulation)',
    subtitle: 'A virtual $10,000 account mirroring the live engine signals (same stop/targets). No real money.',
    equity: 'Current equity',
    realized: 'Realized P&L',
    starting: 'Starting balance',
    open: 'Open positions',
    closed: 'Recently closed',
    noOpen: 'No open positions — waiting for a buy signal that passes the gates',
    noClosed: 'No closed trades yet',
    reset: 'Reset',
    refresh: 'Refresh',
    qty: 'Qty',
    realized2: 'Realized',
  },
};

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

  if (loading || !acct) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-500">{x.title}…</div>
    );
  }

  const equity = acct.equityCurve.length ? acct.equityCurve[acct.equityCurve.length - 1].equity : acct.startingEquity;
  const totalPnl = equity - initialEquity;
  const pnlCls = totalPnl >= 0 ? 'text-emerald-300' : 'text-rose-300';

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
          <div className="text-sm font-extrabold tabular-nums text-zinc-100" dir="ltr">
            ${equity.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </div>
          <div className={`flex items-center justify-center gap-1 text-[10px] font-bold ${pnlCls}`} dir="ltr">
            {totalPnl >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {totalPnl >= 0 ? '+' : ''}
            {totalPnl.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <div className="text-[9px] text-emerald-400/70">{x.realized}</div>
          <div className="text-sm font-extrabold tabular-nums text-emerald-300" dir="ltr">
            ${acct.realizedPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-800/40 p-2">
          <div className="text-[9px] text-zinc-500">{x.starting}</div>
          <div className="text-sm font-extrabold tabular-nums text-zinc-400" dir="ltr">
            ${initialEquity.toLocaleString('en-US')}
          </div>
        </div>
      </div>

      {/* صفقات مفتوحة */}
      <div className="mb-2 text-[10px] font-bold text-zinc-500">{x.open}</div>
      {acct.open.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-2 text-[10px] text-zinc-600">{x.noOpen}</div>
      ) : (
        <div className="space-y-1.5">
          {acct.open.map((p) => {
            return (
              <div key={p.id} className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-zinc-300" dir="ltr">{p.asset}</span>
                <span className="text-zinc-400" dir="ltr">
                  {x.qty} {p.qty.toFixed(6)}
                </span>
                <span className="text-zinc-400" dir="ltr">@{p.entry.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                <span className={`font-bold ${p.pnlAccum >= 0 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">
                  {p.pnlAccum >= 0 ? '+' : ''}
                  {p.pnlAccum.toFixed(2)}
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
              <span className={`font-mono text-[9px] ${t2.reason === 'SELL_SIGNAL' ? 'text-amber-300' : t2.reason === 'SL' ? 'text-rose-300' : 'text-emerald-300'}`}>
                {t2.reason}
              </span>
              <span className={`font-bold ${t2.pnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">
                {t2.pnlUsd >= 0 ? '+' : ''}
                {t2.pnlUsd.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
