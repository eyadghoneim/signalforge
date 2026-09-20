import { useEffect, useRef, useState } from 'react';
import { Beaker, Download, Loader2, Play, Timer } from 'lucide-react';
import { createChart, LineSeries, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { api, type BacktestResult, type SupportedAsset, type RobustnessCell, type WalkForwardResult } from '../api';
import { SUPPORTED_ASSETS } from '../../shared/types';
import { t, type Lang, type TKey } from '../i18n';

const ASSET_OPTION_KEY: Record<SupportedAsset, TKey> = {
  BTC: 'assetBTC',
  ETH: 'assetETH',
  SOL: 'assetSOL',
  PAXG: 'assetPAXG',
};

export default function BacktestPanel({ lang }: { lang: Lang }) {
  const [asset, setAsset] = useState<SupportedAsset>('BTC');
  const [running, setRunning] = useState(false);
  const [robustRunning, setRobustRunning] = useState(false);
  const [wf, setWf] = useState<WalkForwardResult | null>(null);
  const [wfRunning, setWfRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [robustness, setRobustness] = useState<RobustnessCell[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const equityRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bhRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    // The chart container is rendered only after a result exists. Creating the
    // chart on the initial result transition avoids a one-time null-ref exit.
    if (!result || !containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 260,
      layout: { background: { type: ColorType.Solid, color: '#0c0c0f' }, textColor: '#a1a1aa', attributionLogo: false },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      timeScale: { timeVisible: false, borderColor: '#27272a' },
      rightPriceScale: { borderColor: '#27272a' },
    });
    chartRef.current = chart;
    equityRef.current = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 2, title: 'SignalForge' });
    bhRef.current = chart.addSeries(LineSeries, { color: '#71717a', lineWidth: 1, lineStyle: 2, title: t(lang, 'btBuyHold') });
    return () => {
      chart.remove();
      chartRef.current = null;
      equityRef.current = null;
      bhRef.current = null;
    };
  }, [result, lang]);

  useEffect(() => {
    if (!result || result.equityCurve.length === 0) return;
    equityRef.current?.setData(result.equityCurve.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity })));
    bhRef.current?.setData(result.equityCurve.map((p) => ({ time: p.time as UTCTimestamp, value: p.buyHold })));
    chartRef.current?.timeScale().fitContent();
  }, [result, lang]);

  const run = async (mode: 'standard' | 'robustness' | 'walkforward' = 'standard') => {
    if (mode === 'robustness') setRobustRunning(true);
    else if (mode === 'walkforward') setWfRunning(true);
    else setRunning(true);
    setError(null);
    try {
      const res = await api.backtest(asset, 365, mode === 'robustness', mode === 'walkforward');
      if (res.result) setResult(res.result);
      if (res.robustness) setRobustness(res.robustness);
      if (res.walkforward) setWf(res.walkforward);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setRobustRunning(false);
      setWfRunning(false);
    }
  };

  const downloadCsv = () => {
    if (!result || result.trades.length === 0) return;
    const header = 'entry_time,exit_time,entry,exit_avg,qty,pnl_usd,exit_reason,signal_score';
    const rows = result.trades.map((tr) =>
      [
        new Date(tr.entryTime * 1000).toISOString(),
        new Date(tr.exitTime * 1000).toISOString(),
        tr.entry,
        tr.exitAvgPrice,
        tr.qty,
        tr.pnlUsd,
        tr.exitReason,
        tr.signalScore,
      ].join(','),
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signalforge-backtest-${result.asset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stat = (label: string, value: string, cls = 'text-zinc-100') => (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`text-lg font-extrabold tabular-nums ${cls}`} dir="ltr">{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <Beaker size={16} className="text-amber-400" />
        <span className="text-sm font-bold text-zinc-300">{t(lang, 'btTitle')}</span>
        <select
          value={asset}
          onChange={(e) => setAsset(e.target.value as SupportedAsset)}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200"
        >
          {SUPPORTED_ASSETS.map((a) => (
            <option key={a} value={a}>{t(lang, ASSET_OPTION_KEY[a])}</option>
          ))}
        </select>
        <button
          onClick={() => void run()}
          disabled={running || robustRunning || wfRunning}
          className="flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-1.5 text-sm font-extrabold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-50"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {running ? t(lang, 'btComputing') : t(lang, 'btRun')}
        </button>
        <button
          onClick={() => void run('robustness')}
          disabled={running || robustRunning || wfRunning}
          className="flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-1.5 text-sm font-bold text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
        >
          {robustRunning ? <Loader2 size={15} className="animate-spin" /> : <Beaker size={15} />}
          {robustRunning ? t(lang, 'btRobustRunning') : t(lang, 'btRobustness')}
        </button>
        {error && <span className="text-xs text-rose-300">{error}</span>}
        {result && (
          <button
            onClick={downloadCsv}
            disabled={result.trades.length === 0}
            className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-1.5 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <Download size={15} />
            CSV
          </button>
        )}
        <button
          onClick={() => void run('walkforward')}
          disabled={running || robustRunning || wfRunning}
          className="flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-1.5 text-sm font-bold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-50"
        >
          {wfRunning ? <Loader2 size={15} className="animate-spin" /> : <Timer size={15} />}
          Walk-Forward
        </button>
      </div>

      {result && (
        <div className="rise-in space-y-4">
          <div className={`rounded-2xl border p-4 text-sm font-bold ${result.finalEquity >= result.buyHoldFinal ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            {result.verdictAr}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {stat(t(lang, 'btFinalEquity'), `$${result.finalEquity.toLocaleString('en-US')}`, result.finalEquity >= result.startEquity ? 'text-emerald-300' : 'text-rose-300')}
            {stat(t(lang, 'btBuyHold'), `$${result.buyHoldFinal.toLocaleString('en-US')}`, 'text-zinc-300')}
            {stat(t(lang, 'btTrades'), String(result.totalTrades))}
            {stat(t(lang, 'btWinRate'), `${result.winRatePercent}%`, result.winRatePercent >= 50 ? 'text-emerald-300' : 'text-rose-300')}
            {stat(t(lang, 'btProfitFactor'), result.profitFactor !== null ? String(result.profitFactor) : '∞', (result.profitFactor ?? 2) >= 1 ? 'text-emerald-300' : 'text-rose-300')}
            {stat(t(lang, 'btMaxDd'), `${result.maxDrawdownPercent}%`, 'text-amber-300')}
            {stat(t(lang, 'btPeriod'), `${Math.round((result.period.to - result.period.from) / 86400)} ${t(lang, 'btDays')}`)}
          </div>

          {result.performance && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {stat('Expectancy (R)', String(result.performance.expectancyR ?? '-'), (result.performance.expectancyR ?? 0) > 0 ? 'text-emerald-300' : 'text-rose-300')}
              {stat('Payoff W/L', String(result.performance.payoffRatio ?? '-'))}
              {stat('Trade return Z', String(result.performance.sharpePerTrade ?? '-'))}
              {stat('Sortino Ratio', String(result.performance.sortinoRatio ?? '-'), (result.performance.sortinoRatio ?? 0) > 0.5 ? 'text-emerald-300' : 'text-zinc-300')}
              {stat('Calmar Ratio', String(result.performance.calmarRatio ?? '-'), (result.performance.calmarRatio ?? 0) > 0.5 ? 'text-emerald-300' : 'text-zinc-300')}
              {stat('Avg win', result.performance.avgWinUsd !== null ? `$${result.performance.avgWinUsd}` : '-')}
              {stat('Avg loss', result.performance.avgLossUsd !== null ? `$${result.performance.avgLossUsd}` : '-')}
              {stat('DD duration', result.performance.maxDrawdownDurationHours !== null ? `${result.performance.maxDrawdownDurationHours}h` : '-')}
              {stat('Win streak', String(result.performance.longestWinStreak))}
              {stat('Loss streak', String(result.performance.longestLossStreak))}
              {stat('Time in market', result.performance.timeInMarketPercent !== null ? `${result.performance.timeInMarketPercent}%` : '-')}
            </div>
          )}

          {result.performance?.monteCarlo && (
            <div className="overflow-hidden rounded-2xl border border-purple-500/30 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/15 text-purple-400">
                    <Beaker size={14} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-zinc-200">
                      {lang === 'ar' ? 'محاكاة مونت كارلو الاحتمالية (1,000 جولة عشوائية)' : 'Monte Carlo Permutation Simulation (1,000 runs)'}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      {lang === 'ar'
                        ? 'اختبار هل النتائج تحققت بسبب تسلسل صفقات محظوظ أم أنها استراتيجية متينة وقابلة للصمود عبر تدوير الترتيب'
                        : 'Tests whether backtest results depend on a lucky sequence of trades or remain resilient across permutations'}
                    </div>
                  </div>
                </div>
                <span className="rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] font-mono text-purple-300">
                  Deterministic Seeded
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {stat(
                  lang === 'ar' ? 'هبوط الوسيط (50%)' : 'Median DD (50%)',
                  `${result.performance.monteCarlo.maxDrawdown.p50}%`,
                  'text-amber-300',
                )}
                {stat(
                  lang === 'ar' ? 'أسوأ سيناريو هبوط' : 'Worst Max DD',
                  `${result.performance.monteCarlo.maxDrawdown.worst}%`,
                  result.performance.monteCarlo.maxDrawdown.worst > 30 ? 'text-rose-400' : 'text-amber-400',
                )}
                {stat(
                  lang === 'ar' ? 'هبوط 95% ثقة' : '95% Worst DD',
                  `${result.performance.monteCarlo.maxDrawdown.p95}%`,
                  'text-amber-300',
                )}
                {stat(
                  lang === 'ar' ? 'وسيط الرصيد النهائي' : 'Median Final Eq',
                  `$${result.performance.monteCarlo.finalEquity.p50.toLocaleString('en-US')}`,
                  result.performance.monteCarlo.finalEquity.p50 >= result.startEquity ? 'text-emerald-300' : 'text-rose-300',
                )}
                {stat(
                  lang === 'ar' ? 'احتمالية خسارة الرأس مال' : 'Loss Probability',
                  `${result.performance.monteCarlo.lossProbabilityPercent}%`,
                  result.performance.monteCarlo.lossProbabilityPercent === 0
                    ? 'text-emerald-400'
                    : result.performance.monteCarlo.lossProbabilityPercent < 20
                    ? 'text-amber-300'
                    : 'text-rose-400',
                )}
                {stat(
                  lang === 'ar' ? 'خطر الإفلاس (<50% رأس مال)' : 'Ruin Risk (<50%)',
                  `${result.performance.monteCarlo.riskOfRuinPercent}%`,
                  result.performance.monteCarlo.riskOfRuinPercent === 0 ? 'text-emerald-400' : 'text-rose-400',
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-400">
                <div>
                  <span className="text-zinc-500">{lang === 'ar' ? 'مجال الثقة 95% للرصيد النهائي: ' : '95% Confidence Final Equity: '}</span>
                  <span className="font-mono font-bold text-zinc-200" dir="ltr">
                    ${result.performance.monteCarlo.confidenceInterval95.minEquity.toLocaleString('en-US')} → ${result.performance.monteCarlo.confidenceInterval95.maxEquity.toLocaleString('en-US')}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">{lang === 'ar' ? 'مجال الثقة 95% لأقصى هبوط: ' : '95% Confidence Max DD: '}</span>
                  <span className="font-mono font-bold text-amber-300" dir="ltr">
                    {result.performance.monteCarlo.confidenceInterval95.minDrawdown}% → {result.performance.monteCarlo.confidenceInterval95.maxDrawdown}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {result.performance && result.performance.scoreBuckets.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <div className="border-b border-zinc-800 px-4 py-2.5 text-xs font-bold text-zinc-300">Performance by signal score</div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[10px] text-zinc-500">
                      <th className="px-3 py-2 font-medium">Score</th>
                      <th className="px-3 py-2 font-medium">Trades</th>
                      <th className="px-3 py-2 font-medium">Win %</th>
                      <th className="px-3 py-2 font-medium">Total PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.performance.scoreBuckets.map((b) => (
                      <tr key={b.bucket} className="border-b border-zinc-800/50">
                        <td className="px-3 py-1.5 font-mono text-zinc-300" dir="ltr">{b.bucket}</td>
                        <td className="px-3 py-1.5 tabular-nums text-zinc-400" dir="ltr">{b.trades}</td>
                        <td className={`px-3 py-1.5 tabular-nums font-bold ${b.winRatePercent >= 50 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">{b.winRatePercent}%</td>
                        <td className={`px-3 py-1.5 tabular-nums font-bold ${b.totalPnlUsd > 0 ? 'text-emerald-300' : b.totalPnlUsd < 0 ? 'text-rose-300' : 'text-zinc-400'}`} dir="ltr">{b.totalPnlUsd > 0 ? '+' : ''}${b.totalPnlUsd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.performance && result.performance.exitBreakdown.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <div className="border-b border-zinc-800 px-4 py-2.5 text-xs font-bold text-zinc-300">Exit reasons breakdown</div>
              <div className="flex flex-wrap gap-2 p-3">
                {result.performance.exitBreakdown.map((e) => (
                  <span key={e.reason} className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold tabular-nums ${e.totalPnlUsd >= 0 ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-rose-500/30 bg-rose-500/5 text-rose-300'}`} dir="ltr">
                    {e.reason}: {e.count}x ({e.totalPnlUsd > 0 ? '+' : ''}${e.totalPnlUsd})
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-2">
            <div className="flex items-center gap-3 px-2 pt-1 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-amber-400" /> {t(lang, 'btLegendStrategy')}</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-zinc-500" /> {t(lang, 'btBuyHold')}</span>
            </div>
            <div ref={containerRef} className="h-64 w-full" />
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="mb-2 text-xs font-bold text-zinc-400">{t(lang, 'btLimitsTitle')}</div>
            <ul className="list-inside list-disc space-y-1 text-[11px] leading-5 text-zinc-500">
              {result.limitsAr.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>

          {result.monthlyStats && result.monthlyStats.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <div className="border-b border-zinc-800 px-4 py-2.5 text-xs font-bold text-zinc-300">{t(lang, 'btMonthlyTitle')}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[10px] text-zinc-500">
                      <th className="px-3 py-2 font-medium">{t(lang, 'colMonth')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'btTrades')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'btWinRate')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'colPnl')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.monthlyStats.map((m) => (
                      <tr key={m.monthKey} className="border-b border-zinc-800/50">
                        <td className="px-3 py-1.5 font-mono text-zinc-400" dir="ltr">{m.monthKey}</td>
                        <td className="px-3 py-1.5 tabular-nums text-zinc-300" dir="ltr">{m.trades}</td>
                        <td className={`px-3 py-1.5 tabular-nums font-bold ${m.winRatePercent >= 50 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">{m.winRatePercent}%</td>
                        <td className={`px-3 py-1.5 tabular-nums font-bold ${m.pnlUsd > 0 ? 'text-emerald-300' : m.pnlUsd < 0 ? 'text-rose-300' : 'text-zinc-400'}`} dir="ltr">
                          {m.pnlUsd > 0 ? '+' : ''}${m.pnlUsd}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {robustness && (
            <div className="overflow-hidden rounded-2xl border border-sky-500/25">
              <div className="border-b border-sky-500/20 bg-sky-500/5 px-4 py-2.5 text-xs font-bold text-sky-300">
                {t(lang, 'btRobustTitle')}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[10px] text-zinc-500">
                      <th className="px-3 py-2 font-medium">{t(lang, 'colEntryScore')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'colAdxFloor')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'btTrades')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'btWinRate')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'btProfitFactor')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'btFinalEquity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {robustness.map((c, i) => (
                      <tr key={i} className="border-b border-zinc-800/50">
                        <td className="px-3 py-1.5 tabular-nums text-zinc-300" dir="ltr">{c.entryMinScore}</td>
                        <td className="px-3 py-1.5 tabular-nums text-zinc-300" dir="ltr">{c.adxFloor}</td>
                        <td className="px-3 py-1.5 tabular-nums text-zinc-400" dir="ltr">{c.totalTrades}</td>
                        <td className={`px-3 py-1.5 tabular-nums font-bold ${c.winRatePercent >= 50 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">{c.winRatePercent}%</td>
                        <td className="px-3 py-1.5 tabular-nums text-zinc-300" dir="ltr">{c.profitFactor ?? '∞'}</td>
                        <td className="px-3 py-1.5 tabular-nums font-bold text-amber-300" dir="ltr">${c.finalEquity.toLocaleString('en-US')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.trades.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <div className="border-b border-zinc-800 px-4 py-2.5 text-xs font-bold text-zinc-300">{t(lang, 'btLastTrades')} {result.trades.length}</div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 bg-zinc-900">
                    <tr className="text-[10px] text-zinc-500">
                      <th className="px-3 py-2 font-medium">{t(lang, 'colEntry')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'colExit')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'colFromTo')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'colPnl')}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, 'colReason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((tr, i) => (
                      <tr key={i} className="border-b border-zinc-800/50">
                        <td className="px-3 py-1.5 text-zinc-500" dir="ltr">{new Date(tr.entryTime * 1000).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')}</td>
                        <td className="px-3 py-1.5 text-zinc-500" dir="ltr">{new Date(tr.exitTime * 1000).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')}</td>
                        <td className="px-3 py-1.5 tabular-nums text-zinc-400" dir="ltr">${tr.entry.toLocaleString()} → ${tr.exitAvgPrice.toLocaleString()}</td>
                        <td className={`px-3 py-1.5 font-bold tabular-nums ${tr.pnlUsd > 0 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">
                          {tr.pnlUsd > 0 ? '+' : ''}${tr.pnlUsd}
                        </td>
                        <td className="px-3 py-1.5 text-[10px] text-zinc-500" dir="ltr">{tr.exitReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      {wf && (
        <div className="overflow-hidden rounded-2xl border border-violet-500/25">
          <div className="border-b border-violet-500/20 bg-violet-500/5 px-4 py-2.5 text-xs font-bold text-violet-300">
            Walk-forward: best config picked by IN-SAMPLE performance, then judged on unseen second half. Best row highlighted.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] text-zinc-500">
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Entry/ADX</th>
                  <th className="px-3 py-2 font-medium">Opt PF</th>
                  <th className="px-3 py-2 font-medium">Val PF</th>
                  <th className="px-3 py-2 font-medium">Val win %</th>
                  <th className="px-3 py-2 font-medium">Val DD %</th>
                  <th className="px-3 py-2 font-medium">Val trades</th>
                  <th className="px-3 py-2 font-medium">Val equity</th>
                </tr>
              </thead>
              <tbody>
                {wf.results.slice(0, 8).map((c, i) => (
                  <tr key={i} className={`border-b border-zinc-800/50 ${i === 0 ? 'bg-violet-500/10' : ''}`}>
                    <td className="px-3 py-1.5 tabular-nums font-bold text-violet-300" dir="ltr">{c.score}</td>
                    <td className="px-3 py-1.5 tabular-nums text-zinc-300" dir="ltr">{c.entryMinScore}/{c.adxFloor}</td>
                    <td className="px-3 py-1.5 tabular-nums text-zinc-400" dir="ltr">{c.optimizeProfitFactor ?? '-'}</td>
                    <td className={`px-3 py-1.5 tabular-nums font-bold ${(c.validateProfitFactor ?? 0) >= 1 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">{c.validateProfitFactor ?? '-'}</td>
                    <td className="px-3 py-1.5 tabular-nums text-zinc-300" dir="ltr">{c.validateWinRatePercent}%</td>
                    <td className="px-3 py-1.5 tabular-nums text-amber-300" dir="ltr">{c.validateMaxDrawdownPercent}%</td>
                    <td className="px-3 py-1.5 tabular-nums text-zinc-400" dir="ltr">{c.validateTrades}</td>
                    <td className="px-3 py-1.5 tabular-nums font-bold text-zinc-200" dir="ltr">${c.validateFinalEquity.toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
