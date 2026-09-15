import { useEffect, useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { api, type LearningInfo } from '../api';

export default function LearningPanel() {
  const [data, setData] = useState<LearningInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.learning();
        if (alive) setData(res);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 text-zinc-500">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }
  if (error) {
    return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">{error}</div>;
  }
  if (!data) return null;

  const stat = (label: string, value: string, cls = 'text-zinc-100') => (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`text-lg font-extrabold tabular-nums ${cls}`} dir="ltr">{value}</div>
    </div>
  );

  const activeالانحيازes = Object.values(data.biases).filter((v) => v !== 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <Brain size={16} className="text-violet-400" />
        <span className="text-sm font-bold text-zinc-300">نظام التعلم - أوزان العوامل مستنتجة من إشارات البوت المحسومة</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat('الربح الأساسي %', String(data.baselineWinRatePercent))}
        {stat('إشارات محسومة', String(data.totalResolved))}
        {stat('انحيازات نشطة', String(activeالانحيازes), 'text-violet-300')}
        {stat('دروس مسجلة', String(data.lessons.length))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-800">
        <div className="border-b border-zinc-800 px-4 py-2.5 text-xs font-bold text-zinc-300">
          أدلة العوامل والانحياز (تعديل بسيط للدرجة عند ظهور العامل، بحد أقصى 3+/-، يحتاج 10+ إشارات محسومة)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-[10px] text-zinc-500">
                <th className="px-3 py-2 font-medium">العامل</th>
                <th className="px-3 py-2 font-medium">عينات</th>
                <th className="px-3 py-2 font-medium">رابحة</th>
                <th className="px-3 py-2 font-medium">خاسرة</th>
                <th className="px-3 py-2 font-medium">الربح %</th>
                <th className="px-3 py-2 font-medium">صافي R</th>
                <th className="px-3 py-2 font-medium">الانحياز</th>
              </tr>
            </thead>
            <tbody>
              {data.perTag.map((t) => (
                <tr key={t.tag} className="border-b border-zinc-800/50">
                  <td className="px-3 py-1.5 font-mono text-zinc-300" dir="ltr">{t.tag}</td>
                  <td className="px-3 py-1.5 tabular-nums text-zinc-400" dir="ltr">{t.samples}</td>
                  <td className="px-3 py-1.5 tabular-nums text-emerald-300" dir="ltr">{t.wins}</td>
                  <td className="px-3 py-1.5 tabular-nums text-rose-300" dir="ltr">{t.losses}</td>
                  <td className={`px-3 py-1.5 tabular-nums font-bold ${t.winRatePercent >= data.baselineWinRatePercent ? 'text-emerald-300' : 'text-amber-300'}`} dir="ltr">{t.winRatePercent}%</td>
                  <td className="px-3 py-1.5 tabular-nums text-zinc-300" dir="ltr">{t.netR > 0 ? '+' : ''}{t.netR}</td>
                  <td className={`px-3 py-1.5 tabular-nums font-extrabold ${(data.biases[t.tag] ?? 0) > 0 ? 'text-emerald-300' : (data.biases[t.tag] ?? 0) < 0 ? 'text-rose-300' : 'text-zinc-500'}`} dir="ltr">
                    {(data.biases[t.tag] ?? 0) > 0 ? '+' : ''}{data.biases[t.tag] ?? 0}
                  </td>
                </tr>
              ))}
              {data.perTag.length === 0 && (
                <tr><td className="px-3 py-4 text-center text-zinc-500" colSpan={7}>لا إشارات محسومة بعد - البوت يتعلم مع تحسم كل إشارة (هدف أو وقف).</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-2 text-xs font-bold text-zinc-300">سجل الدروس (كل تغيير موثق بدليله)</div>
        {data.lessons.length === 0 ? (
          <div className="text-xs text-zinc-500">لا تغييرات بعد - كل تغيير هيتم توثيقه هنا بدليله.</div>
        ) : (
          <div className="space-y-1.5">
            {data.lessons.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400" dir="ltr">
                <span className="font-mono text-zinc-500">{new Date(l.at).toLocaleString('en-GB')}</span>
                <span className="font-bold text-violet-300">{l.tag}</span>
                <span className="tabular-nums">bias {l.from} to {l.to}</span>
                <span className="text-zinc-500">evidence: {l.samples} samples, tag win {l.tagWinRatePercent}% vs baseline {l.baselineWinRatePercent}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
