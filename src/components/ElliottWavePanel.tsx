import { useEffect, useState } from 'react';
import { Activity, Compass, ShieldCheck, AlertTriangle, ArrowUpRight, BarChart3, RefreshCw } from 'lucide-react';
import { api, type ElliottWaveAnalysis, type SupportedAsset } from '../api';
import type { Lang } from '../i18n';

interface Props {
  asset: SupportedAsset;
  lang: Lang;
}

export default function ElliottWavePanel({ asset, lang }: Props) {
  const [data, setData] = useState<ElliottWaveAnalysis | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.elliott(asset);
      if (res.ok && res.analysis) {
        setData(res.analysis);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, [asset]);

  if (loading && !data) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/40 text-xs text-zinc-400">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin text-amber-400" />
        {lang === 'ar' ? 'جارٍ تحليل هيكل موجات إليوت وفيبوناتشي...' : 'Analyzing Elliott Wave & Fibonacci structures...'}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-800/40 bg-rose-950/20 p-4 text-xs text-rose-300">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle className="h-4 w-4 text-rose-400" />
          {lang === 'ar' ? 'تعذر جلب تحليل موجات إليوت' : 'Failed to fetch Elliott Wave analysis'}
        </div>
        <div className="mt-1 text-zinc-400">{error || 'No data'}</div>
        <button
          onClick={loadData}
          className="mt-3 rounded-lg border border-rose-700/50 bg-rose-900/30 px-3 py-1 text-xs text-rose-200 hover:bg-rose-900/50"
        >
          {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
        </button>
      </div>
    );
  }

  const isImpulse = data.waveType === 'IMPULSE';
  const isCorrective = data.waveType === 'CORRECTIVE';

  const waveColor = isImpulse
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    : isCorrective
    ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
    : 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40';

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
      {/* الترويسة العلوية */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-2 text-amber-400">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100">
                {lang === 'ar' ? 'محرك موجات إليوت وامتدادات فيبوناتشي' : 'Elliott Wave & Fibonacci Engine'}
              </h3>
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${waveColor}`}>
                {data.currentWave} ({data.waveType})
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {lang === 'ar'
                ? `تحليل هيكلي حتمي للأصل (${asset}) مع التحقق من القواعد الكلاسيكية الثلاث`
                : `Deterministic structural fractal count for (${asset}) with 3-core rules verification`}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-white transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-amber-400' : 'text-zinc-400'}`} />
          <span>{lang === 'ar' ? 'تحديث الموجات' : 'Refresh Waves'}</span>
        </button>
      </div>

      {/* بطاقات الإحصاءات السريعة */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
          <div className="text-[11px] text-zinc-500">{lang === 'ar' ? 'نسبة الثقة الموجية' : 'Wave Confidence'}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-bold font-mono text-zinc-100">{data.confidence}%</span>
            <span className="text-[10px] text-zinc-400">
              {data.confidence >= 55 ? (lang === 'ar' ? 'عالية' : 'High') : (lang === 'ar' ? 'متوسطة' : 'Moderate')}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full transition-all duration-500 ${
                data.confidence >= 55 ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${data.confidence}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
          <div className="text-[11px] text-zinc-500">{lang === 'ar' ? 'الهدف الموجي التقديري' : 'Estimated Target'}</div>
          <div className="mt-1 text-lg font-bold font-mono text-emerald-400 flex items-center gap-1">
            <ArrowUpRight className="h-4 w-4" />
            ${data.estimatedTarget.toLocaleString('en-US')}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            {lang === 'ar' ? 'امتداد فيبوناتشي المستهدف' : 'Target Fibonacci extension'}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
          <div className="text-[11px] text-zinc-500">{lang === 'ar' ? 'سعر إبطال النموذج' : 'Invalidation Level'}</div>
          <div className="mt-1 text-lg font-bold font-mono text-rose-400">
            ${data.invalidationPrice.toLocaleString('en-US')}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            {lang === 'ar' ? 'كسره يلغي العدّ الموجي' : 'Breach invalidates count'}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
          <div className="text-[11px] text-zinc-500">{lang === 'ar' ? 'زخم حجم الأرجل' : 'Leg Volume Ratio'}</div>
          <div className="mt-1 text-lg font-bold font-mono text-sky-400 flex items-center gap-1">
            <BarChart3 className="h-4 w-4" />
            {data.impulseVolumeRatio}x
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            {data.impulseVolumeRatio >= 1.2
              ? (lang === 'ar' ? 'تأكيد قوي للزخم' : 'Strong expansion')
              : (lang === 'ar' ? 'زخم اعتيادي' : 'Normal ratio')}
          </div>
        </div>
      </div>

      {/* التفسير الموجي الرسمي */}
      <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3.5 text-xs leading-relaxed text-zinc-300">
        <div className="font-bold text-zinc-200 mb-1 flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-amber-400" />
          <span>{lang === 'ar' ? 'التفسير الهيكلي والموجي:' : 'Structural Interpretation:'}</span>
        </div>
        <div>{lang === 'ar' ? data.explanationAr : data.explanationEn}</div>
      </div>

      {/* شبكة فيبوناتشي وشروط القواعد */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* شبكة فيبوناتشي */}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3.5">
          <div className="text-xs font-bold text-zinc-200 mb-2.5 flex items-center justify-between">
            <span>{lang === 'ar' ? 'شبكة فيبوناتشي الارتدادية والامتدادية:' : 'Fibonacci Retracements & Extensions:'}</span>
            <span className="text-[10px] text-zinc-500 font-mono">0.236 - 1.618</span>
          </div>
          <div className="space-y-1.5 text-xs font-mono" dir="ltr">
            <div className="flex items-center justify-between rounded bg-zinc-900/60 px-2.5 py-1 text-zinc-300">
              <span className="text-emerald-400 font-bold">1.618 Golden Target</span>
              <span>${data.fibLevels.level1_618.toLocaleString('en-US')}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-zinc-900/60 px-2.5 py-1 text-zinc-300">
              <span className="text-amber-400">0.786 Deep Retracement</span>
              <span>${data.fibLevels.level0_786.toLocaleString('en-US')}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-zinc-900/60 px-2.5 py-1 text-zinc-300">
              <span className="text-sky-400 font-bold">0.618 Golden Pocket</span>
              <span>${data.fibLevels.level0_618.toLocaleString('en-US')}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-zinc-900/60 px-2.5 py-1 text-zinc-300">
              <span className="text-zinc-400">0.500 Equilibrium</span>
              <span>${data.fibLevels.level0_500.toLocaleString('en-US')}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-zinc-900/60 px-2.5 py-1 text-zinc-300">
              <span className="text-zinc-400">0.382 Pullback Zone</span>
              <span>${data.fibLevels.level0_382.toLocaleString('en-US')}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-zinc-900/60 px-2.5 py-1 text-zinc-300">
              <span className="text-zinc-500">0.236 Minor Level</span>
              <span>${data.fibLevels.level0_236.toLocaleString('en-US')}</span>
            </div>
          </div>
        </div>

        {/* فحص القواعد الكلاسيكية */}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3.5 space-y-2.5">
          <div className="text-xs font-bold text-zinc-200 mb-2">
            {lang === 'ar' ? 'فحص قواعد إليوت الصارمة (Strict Invariants):' : 'Elliott Invariant Rules Check:'}
          </div>

          <div className="space-y-1.5 text-xs">
            {data.rulesPassed.map((rule, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded bg-emerald-500/10 border border-emerald-500/20 p-2 text-emerald-300">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                <span>{rule}</span>
              </div>
            ))}

            {data.rulesViolated.map((violation, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded bg-rose-500/10 border border-rose-500/20 p-2 text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{violation}</span>
              </div>
            ))}

            {data.rulesPassed.length === 0 && data.rulesViolated.length === 0 && (
              <div className="text-xs text-zinc-500 italic p-2">
                {lang === 'ar' ? 'لا توجد قواعد كافية في هذه العينة لتحديد الانتهاكات' : 'No rules triggered in this candle range'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
