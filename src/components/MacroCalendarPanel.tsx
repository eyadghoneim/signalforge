import { useEffect, useState } from 'react';
import { Calendar, ShieldAlert, ShieldCheck, Clock, Flame, RefreshCw, Radio } from 'lucide-react';
import { api, type MacroCalendarResponse } from '../api';
import type { Lang } from '../i18n';

interface Props {
  lang: Lang;
}

export default function MacroCalendarPanel({ lang }: Props) {
  const [data, setData] = useState<MacroCalendarResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [timeLeftStr, setTimeLeftStr] = useState<string>('');
  const [nowTick, setNowTick] = useState<number>(Date.now());

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await api.macroCalendar();
      if (res.ok) {
        setData(res);
      }
    } catch (e) {
      console.warn('Failed to load macro calendar:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const interval = setInterval(loadData, 45_000);
    return () => clearInterval(interval);
  }, []);

  // Update countdown to closest event
  useEffect(() => {
    const updateCountdown = () => {
      if (!data || !data.upcomingEvents.length) return;
      const now = Date.now();
      const nextEvt = data.upcomingEvents.find((e) => e.timestamp > now);
      if (!nextEvt) {
        setTimeLeftStr(lang === 'ar' ? 'لا توجد أحداث قريبة' : 'No upcoming events');
        return;
      }
      const diff = Math.max(0, nextEvt.timestamp - now);
      const hrs = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeftStr(`${hrs}h ${mins}m ${secs}s`);
    };

    updateCountdown();
    const timer = setInterval(() => {
      setNowTick(Date.now());
      updateCountdown();
    }, 1000);
    return () => clearInterval(timer);
  }, [data, lang]);

  // Relative label per event row (ticking every second with nowTick)
  const formatRelative = (ts: number): string | null => {
    const diff = ts - nowTick;
    if (diff <= 0) return null;
    const days = Math.floor(diff / 86_400_000);
    const hrs = Math.floor((diff % 86_400_000) / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    if (lang === 'ar') {
      if (days > 0) return `بعد ${days}ي ${hrs}س`;
      if (hrs > 0) return `بعد ${hrs}س ${mins}د`;
      return `بعد ${mins}د`;
    }
    if (days > 0) return `in ${days}d ${hrs}h`;
    if (hrs > 0) return `in ${hrs}h ${mins}m`;
    return `in ${mins}m`;
  };

  const isRealCalendar = data?.calendarSource === 'REAL_EXTERNAL';

  const isBlackout = data?.isBlackoutActive ?? false;
  const events = data?.upcomingEvents || [];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
      {/* الترويسة العلوية */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`rounded-xl border p-2 ${
              isBlackout
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                : 'border-amber-400/30 bg-amber-400/10 text-amber-400'
            }`}
          >
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100">
                {lang === 'ar' ? 'المفكرة الاقتصادية وفلتر فترات الحظر (CPI & FOMC Guard)' : 'Macroeconomic Events & Blackout Filter'}
              </h3>
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                  isBlackout
                    ? 'border-rose-500/50 bg-rose-500/20 text-rose-300 animate-pulse'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                }`}
              >
                {isBlackout ? '⚠️ REFERENCE EVENT WINDOW' : '🛡️ NO REFERENCE OVERLAP'}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                  isRealCalendar
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                    : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-400'
                }`}
              >
                {isRealCalendar
                  ? (lang === 'ar' ? '🗓️ مفكرة حقيقية — مصدر خارجي' : '🗓️ Real calendar — external feed')
                  : (lang === 'ar' ? 'جدول استرشادي — ليس حجلاً حقيقياً' : 'Reference schedule — not a real calendar')}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {lang === 'ar'
                ? 'تنبيه عرضي حول نوافذ الأخبار الأمريكية عالية التأثير (نمط مرجعي) — لا يحظر أي صفقات فعلياً'
                : 'Display-only notice around high-impact US release windows (reference rhythm) — it does NOT block any trades'}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-white transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-amber-400' : 'text-zinc-400'}`} />
          <span>{lang === 'ar' ? 'تحديث المفكرة' : 'Refresh Calendar'}</span>
        </button>
      </div>

      {/* شريط حالة الحظر الفوري */}
      <div
        className={`rounded-xl border p-3 text-xs flex flex-wrap items-center justify-between gap-3 ${
          isBlackout
            ? 'border-rose-500/40 bg-rose-950/30 text-rose-200'
            : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {isBlackout ? (
            <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0 animate-bounce" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
          )}
          <div>
            <span className="font-bold block text-sm">
              {isBlackout
                ? (lang === 'ar' ? '⚠️ تداخل مع نافذة حدث مرجعي — تنبيه عرضي فقط، لا يوجد حظر فعلي' : '⚠️ Overlap with a reference event window — display-only, nothing is blocked')
                : (lang === 'ar' ? '✅ لا تداخل مع نوافذ الأحداث المرجعية حالياً' : '✅ No overlap with reference event windows right now')}
            </span>
            {isBlackout && data?.lockReasonAr && (
              <span className="text-[11px] text-rose-300 block mt-0.5">
                {lang === 'ar' ? data.lockReasonAr : data.lockReasonEn}
              </span>
            )}
          </div>
        </div>

        {timeLeftStr && (
          <div className="flex items-center gap-1.5 rounded-lg border border-current bg-zinc-950/60 px-3 py-1 text-xs font-mono font-bold shrink-0" dir="ltr">
            <Clock className="h-3.5 w-3.5" />
            <span>Next Event: {timeLeftStr}</span>
          </div>
        )}
      </div>

      {/* إفصاح المصدر: مفكرة حقيقية أو جدول استرشادي (نص السيرفر الديناميكي إن توفر) */}
      <div
        className={`rounded-xl border p-3 text-[11px] leading-5 ${
          isRealCalendar
            ? 'border-sky-500/30 bg-sky-500/5 text-sky-200/80'
            : 'border-amber-500/30 bg-amber-500/5 text-amber-200/80'
        }`}
      >
        {lang === 'ar'
          ? (data?.noteAr ?? 'ℹ️ إفصاح: هذا جدول استرشادي بنمط المواعيد المتكررة المعتادة (يتكرر يومياً كنموذج مرجعي) وليس مفكرة اقتصادية حقيقية، ولا يحظر أي صفقات تلقائياً. راجع المواعيد الفعلية من مصادر رسمية.')
          : (data?.noteEn ?? 'ℹ️ Disclosure: this is a reference schedule of typical recurring release times (repeats daily as a template), not a real economic calendar, and it does NOT block any trading automatically. Verify actual dates from official sources.')}
      </div>

      {/* جدول الأحداث الاقتصادية الكبرى */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-zinc-200 flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
            {lang === 'ar' ? 'جدول الأحداث الاقتصادية الأمريكية المرتقبة:' : 'Upcoming High-Impact US Releases:'}
          </span>
          <span className="text-[11px] text-zinc-500">
            {lang === 'ar' ? 'النمط المرجعي للفترة المحيطة بالحدث' : 'Reference buffer around the event'}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/50">
          <table className="w-full text-xs text-left">
            <thead className="border-b border-zinc-800 bg-zinc-900/60 text-zinc-400">
              <tr>
                <th className="p-3 text-right">{lang === 'ar' ? 'الحدث الاقتصادي' : 'Event'}</th>
                <th className="p-3 text-center">{lang === 'ar' ? 'التصنيف والتأثير' : 'Impact'}</th>
                <th className="p-3 text-center">{lang === 'ar' ? 'التوقيت (UTC)' : 'Time (UTC)'}</th>
                <th className="p-3 text-center">{lang === 'ar' ? 'السابق / التقديري' : 'Prev / Forecast'}</th>
                <th className="p-3 text-center">{lang === 'ar' ? 'حالة المنظومة' : 'Status'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {events.map((evt) => {
                const isActive = evt.status === 'ACTIVE_BLACKOUT';
                return (
                  <tr
                    key={evt.id}
                    className={`hover:bg-zinc-900/40 transition-colors ${
                      isActive ? 'bg-rose-950/20' : evt.status === 'PASSED' ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="p-3 text-right">
                      <div className="font-bold text-zinc-100 flex items-center justify-end gap-1.5 font-sans">
                        <span>{lang === 'ar' ? evt.nameAr : evt.name}</span>
                        {evt.impact === 'HIGH' && <Flame className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                      </div>
                      <span className="text-[10px] text-zinc-500 block font-sans mt-0.5">{evt.descriptionAr}</span>
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                          evt.impact === 'HIGH'
                            ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                            : 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                        }`}
                      >
                        {evt.category} ({evt.impact})
                      </span>
                    </td>
                    <td className="p-3 text-center text-zinc-300 whitespace-nowrap">
                      {evt.timeFormatted}
                      {evt.status !== 'PASSED' && formatRelative(evt.timestamp) && (
                        <div className="text-[10px] font-bold text-amber-400/90 mt-0.5" dir="ltr">
                          {formatRelative(evt.timestamp)}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-center text-zinc-400 whitespace-nowrap">
                      <span className="text-zinc-500">{lang === 'ar' ? 'سابق: ' : 'Prev: '}</span>
                      <span className="text-zinc-300">{evt.previousValue}</span>
                      <span className="mx-1 text-zinc-600">/</span>
                      <span className="text-emerald-400">{lang === 'ar' ? 'توقع: ' : 'Fcst: '}</span>
                      <span className="text-emerald-300">{evt.forecastValue}</span>
                    </td>
                    <td className="p-3 text-center whitespace-nowrap">
                      {isActive ? (
                        <span className="rounded-md bg-amber-600/80 px-2 py-1 text-[10px] font-bold text-white">
                          ⚠️ {lang === 'ar' ? 'تنبيه عرضي' : 'Notice'}
                        </span>
                      ) : evt.status === 'PASSED' ? (
                        <span className="rounded-md border border-zinc-700/60 bg-zinc-800/30 px-2 py-0.5 text-[10px] text-zinc-500">
                          ✅ {lang === 'ar' ? 'انتهى' : 'Passed'}
                        </span>
                      ) : (
                        <span className="rounded-md border border-zinc-700/60 bg-zinc-800/50 px-2 py-0.5 text-[10px] text-zinc-400">
                          ⏳ {lang === 'ar' ? 'مرتقب' : 'Upcoming'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
