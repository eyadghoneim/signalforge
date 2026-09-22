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
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [data, lang]);

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
                {isBlackout ? '⚠️ EVENT WINDOW' : '🛡️ NO OVERLAP'}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                  !data?.isReferenceSchedule
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-400'
                }`}
              >
                {!data?.isReferenceSchedule
                  ? (lang === 'ar' ? '🟢 تقويم حي مباشر (TradingView)' : '🟢 Live Feed (TradingView)')
                  : (lang === 'ar' ? 'جدول استرشادي احتياطي' : 'Reference fallback schedule')}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {!data?.isReferenceSchedule
                ? (lang === 'ar'
                    ? 'أحداث ومؤشرات أمريكية حية ومحدثة لحظياً — تنبيه استرشادي لمخاطر التذبذب العالي'
                    : 'Live real-time US indicators and Fed releases — volatility risk advisory')
                : (lang === 'ar'
                    ? 'تنبيه عرضي حول نوافذ الأخبار الأمريكية عالية التأثير (نمط مرجعي) — لا يحظر أي صفقات فعلياً'
                    : 'Display-only notice around high-impact US release windows (reference rhythm) — it does NOT block any trades')}
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

      {/* إفصاح المصدر وطبيعة التنبيه */}
      <div
        className={`rounded-xl border p-3 text-[11px] leading-5 ${
          !data?.isReferenceSchedule
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200/90'
            : 'border-amber-500/30 bg-amber-500/5 text-amber-200/80'
        }`}
      >
        {!data?.isReferenceSchedule ? (
          lang === 'ar' ? (
            <span>
              ℹ️ <strong>بيانات حية مباشرة:</strong> {data?.source || 'TradingView'} — يتم رصد المؤشرات والتصريحات الأمريكية الاقتصادية فور جدولتها ونشرها. التنبيهات استرشادية لمساعدة المتداول في تفادي فترات التذبذب اللحظي العنيف، ولا يقوم المحرك بحظر أي صفقات تلقائياً.
            </span>
          ) : (
            <span>
              ℹ️ <strong>Live Real-Time Data:</strong> {data?.source || 'TradingView'} — monitoring US macroeconomic indicators and Fed events as scheduled. Notices are display-only guidance to help navigate volatility; no orders are automatically blocked.
            </span>
          )
        ) : (
          lang === 'ar' ? (
            <span>
              ℹ️ إفصاح: هذا جدول استرشادي بنمط المواعيد المتكررة المعتادة (يتكرر دورياً كنموذج مرجعي) ويتم تحديثه إلى بيانات حية من TradingView فور الاتصال. لا يحظر هذا الجدول أي صفقات تلقائياً.
            </span>
          ) : (
            <span>
              ℹ️ Disclosure: this is a reference fallback schedule of typical recurring release windows — refreshed to live TradingView data once connected. It does NOT block any trading automatically.
            </span>
          )
        )}
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
                      isActive ? 'bg-rose-950/20' : ''
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
                    </td>
                    <td className="p-3 text-center text-zinc-400 whitespace-nowrap">
                      {evt.actualValue && (
                        <>
                          <span className="text-amber-400 font-bold">{lang === 'ar' ? 'فعلي: ' : 'Act: '}</span>
                          <span className="text-amber-300 font-bold">{evt.actualValue}</span>
                          <span className="mx-1 text-zinc-600">/</span>
                        </>
                      )}
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
