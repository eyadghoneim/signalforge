import { RefreshCw, ShieldAlert } from 'lucide-react';
import type { StoredSignal } from '../api';
import { useMemo } from 'react';
import { t, type Lang, type TKey } from '../i18n';

const BADGE_KEY: Record<string, TKey> = {
  STRONG_BUY: 'typeStrongBuy',
  BUY: 'typeBuy',
  HOLD: 'typeHold',
  NO_TRADE: 'typeNoTrade',
  SELL: 'typeSell',
  STRONG_SELL: 'typeStrongSell',
};

const BADGE_CLS: Record<string, string> = {
  STRONG_BUY: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40',
  BUY: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  HOLD: 'bg-zinc-500/10 text-zinc-400 border-zinc-600/40',
  NO_TRADE: 'bg-amber-500/10 text-amber-300 border-amber-500/40',
  SELL: 'bg-rose-500/10 text-rose-300 border-rose-500/40',
  STRONG_SELL: 'bg-rose-500/10 text-rose-300 border-rose-500/50',
};

const RESOLUTION_KEY: Record<string, TKey> = {
  TP1_FIRST: 'resTp1',
  SL_FIRST: 'resSl',
  OPEN: 'resOpen',
  EXPIRED: 'resExpired',
};

const RESOLUTION_CLS: Record<string, string> = {
  TP1_FIRST: 'text-emerald-300',
  SL_FIRST: 'text-rose-300',
  OPEN: 'text-sky-300',
  EXPIRED: 'text-zinc-400',
};

export default function HistoryPanel({ signals, onRefresh, lang }: { signals: StoredSignal[]; onRefresh: () => void; lang: Lang }) {
  const stats = useMemo(() => {
    const actionable = signals.filter((s) => !s.isGateBlocked);
    const resolved = actionable.filter((s) => s.outcomes?.resolution === 'TP1_FIRST' || s.outcomes?.resolution === 'SL_FIRST');
    const tp1 = resolved.filter((s) => s.outcomes.resolution === 'TP1_FIRST').length;
    return {
      total: signals.length,
      blocked: signals.length - actionable.length,
      resolved: resolved.length,
      winRate: resolved.length ? Math.round((tp1 / resolved.length) * 100) : null,
    };
  }, [signals]);

  const gb = (s: string): { label: string; cls: string } => {
    const key = BADGE_KEY[s] ?? 'typeHold';
    return { label: t(lang, key), cls: BADGE_CLS[s] ?? BADGE_CLS.HOLD };
  };
  const go = (s: string) => ({
    label: t(lang, RESOLUTION_KEY[s] ?? 'resOpen'),
    cls: RESOLUTION_CLS[s] ?? RESOLUTION_CLS.OPEN,
  });

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-bold text-zinc-300">{t(lang, 'historyTitle')}</span>
          <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-zinc-400" dir="ltr">
            {stats.total} {t(lang, 'historySig')}
          </span>
          {stats.blocked > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-300">
              <ShieldAlert size={11} /> {stats.blocked} {t(lang, 'historyBlocked')}
            </span>
          )}
          {stats.winRate !== null && (
            <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-sky-300" dir="ltr">
              {t(lang, 'historyWinRate')} {stats.winRate}% ({stats.resolved} {t(lang, 'historyResolved')})
            </span>
          )}
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-amber-400/40 hover:text-amber-300">
          <RefreshCw size={12} /> {t(lang, 'historyRefresh')}
        </button>
      </div>

      {signals.length === 0 ? (
        <div className="p-8 text-center text-sm text-zinc-500">{t(lang, 'historyEmpty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-[10px] text-zinc-500">
                <th className="px-3 py-2 font-medium">{t(lang, 'colTime')}</th>
                <th className="px-3 py-2 font-medium">{t(lang, 'colAsset')}</th>
                <th className="px-3 py-2 font-medium">{t(lang, 'colSignal')}</th>
                <th className="px-3 py-2 font-medium">{t(lang, 'colScore')}</th>
                <th className="px-3 py-2 font-medium">{t(lang, 'colPrice')}</th>
                <th className="px-3 py-2 font-medium">{t(lang, 'colSlTp1')}</th>
                <th className="px-3 py-2 font-medium">{t(lang, 'colOutcome')}</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => {
                const badge = gb(s.signalType);
                const outcome = go(s.outcomes?.resolution ?? 'OPEN');
                return (
                  <tr key={s.id} className="border-b border-zinc-800/50 transition hover:bg-zinc-800/30">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500" dir="ltr">
                      {new Date(s.generatedAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 font-bold text-zinc-300" dir="ltr">{s.asset}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                        {s.isGateBlocked && <ShieldAlert size={10} />}
                        {badge.label}
                      </span>
                      {s.isGateBlocked && s.blockReasonAr && (
                        <div className="mt-0.5 max-w-56 truncate text-[9px] text-amber-300/70" title={s.blockReasonAr}>
                          {s.blockReasonAr}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-bold tabular-nums text-zinc-200" dir="ltr">{s.convictionScore}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-300" dir="ltr">${s.entryPrice.toLocaleString('en-US')}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-500" dir="ltr">
                      ${s.stopLoss.toLocaleString('en-US')} / ${s.target1.toLocaleString('en-US')}
                    </td>
                    <td className={`px-3 py-2 font-bold ${outcome.cls}`}>
                      {s.isGateBlocked ? (
                        <span className="text-[10px] text-amber-300/80">{t(lang, 'auditVirtual')}</span>
                      ) : (
                        <span className="text-[11px]">{outcome.label}</span>
                      )}
                      {s.outcomes?.windows?.h72 && (s.outcomes.windows.h72.mfePercent !== 0 || s.outcomes.windows.h72.maePercent !== 0) && (
                        <div className="text-[9px] font-normal text-zinc-500" dir="ltr">
                          MFE {s.outcomes.windows.h72.mfePercent > 0 ? '+' : ''}{s.outcomes.windows.h72.mfePercent}% / MAE {s.outcomes.windows.h72.maePercent}%
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
