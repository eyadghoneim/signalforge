import { RefreshCw, ShieldAlert } from 'lucide-react';
import type { StoredSignal } from '../api';
import { useMemo } from 'react';

const BADGE: Record<string, { label: string; cls: string }> = {
  STRONG_BUY: { label: 'شراء قوي', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40' },
  BUY: { label: 'شراء', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  HOLD: { label: 'انتظار', cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-600/40' },
  NO_TRADE: { label: 'محجوبة', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/40' },
  SELL: { label: 'بيع', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/40' },
  STRONG_SELL: { label: 'بيع قوي', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/50' },
};

const RESOLUTION: Record<string, { label: string; cls: string }> = {
  TP1_FIRST: { label: '✅ TP1 قبل الوقف', cls: 'text-emerald-300' },
  SL_FIRST: { label: '❌ الوقف أولاً', cls: 'text-rose-300' },
  OPEN: { label: '⏳ قيد التتبع', cls: 'text-sky-300' },
  EXPIRED: { label: '⌛ انتهت النافذة', cls: 'text-zinc-400' },
};

export default function HistoryPanel({ signals, onRefresh }: { signals: StoredSignal[]; onRefresh: () => void }) {
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

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-bold text-zinc-300">سجل الإشارات المحفوظة</span>
          <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-zinc-400">{stats.total} إشارة</span>
          {stats.blocked > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-300">
              <ShieldAlert size={11} /> {stats.blocked} محجوبة ببوابة
            </span>
          )}
          {stats.winRate !== null && (
            <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-sky-300">
              نجاح المحسومة: {stats.winRate}% ({stats.resolved} محسومة)
            </span>
          )}
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-amber-400/40 hover:text-amber-300">
          <RefreshCw size={12} /> تحديث
        </button>
      </div>

      {signals.length === 0 ? (
        <div className="p-8 text-center text-sm text-zinc-500">
          لسه مفيش إشارات محفوظة — أول مسح آلي بيحصل بعد 30 ثانية من تشغيل المنصة، والإشارات المهمة بس هي اللي تتسجل (شراء/بيع/محجوبة ببوابة).
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-[10px] text-zinc-500">
                <th className="px-3 py-2 font-medium">الوقت</th>
                <th className="px-3 py-2 font-medium">الأصل</th>
                <th className="px-3 py-2 font-medium">الإشارة</th>
                <th className="px-3 py-2 font-medium">الدرجة</th>
                <th className="px-3 py-2 font-medium">السعر</th>
                <th className="px-3 py-2 font-medium">SL / TP1</th>
                <th className="px-3 py-2 font-medium">النتيجة المُتتبعة</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => {
                const badge = BADGE[s.signalType] ?? BADGE.HOLD;
                const outcome = RESOLUTION[s.outcomes?.resolution ?? 'OPEN'] ?? RESOLUTION.OPEN;
                return (
                  <tr key={s.id} className="border-b border-zinc-800/50 transition hover:bg-zinc-800/30">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500" dir="ltr">
                      {new Date(s.generatedAt).toLocaleString('ar-EG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 font-bold text-zinc-300">{s.asset}</td>
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
                        <span className="text-[10px] text-amber-300/80">تدقيق افتراضي</span>
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
