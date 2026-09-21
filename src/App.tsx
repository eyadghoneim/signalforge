import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Globe, Settings, ShieldCheck, Wifi, WifiOff, FileText } from 'lucide-react';
import { api, type SupportedAsset, type Signal, type StoredSignal, type TickerSummary, type AttributionSummary, type HealthInfo, type DuneInfo } from './api';
import { SUPPORTED_ASSETS, ASSET_LABELS_AR } from '../shared/types';
import PriceChart from './components/PriceChart';
import SignalCard from './components/SignalCard';
import HistoryPanel from './components/HistoryPanel';
import SettingsPanel from './components/SettingsPanel';
import BacktestPanel from './components/BacktestPanel';
import LearningPanel from './components/LearningPanel';
import AttributionPanel from './components/AttributionPanel';
import DexPanel from './components/DexPanel';
import LiquidationPanel from './components/LiquidationPanel';
import PaperPanel from './components/PaperPanel';
import DuneContextPanel from './components/DuneContextPanel';
import DuneResearchPanel from './components/DunePanel';
import DailyReportModal from './components/DailyReportModal';
import ElliottWavePanel from './components/ElliottWavePanel';
import MacroCalendarPanel from './components/MacroCalendarPanel';
import WhaleDepthPanel from './components/WhaleDepthPanel';
import { LiquidityCard, ProviderDots } from './components/LiquidityCard';
import { t, applyDocumentDir, type Lang } from './i18n';
import type { LiquidityRegime, ProviderHealthInfo } from './api';

type Tab = 'history' | 'elliott' | 'macro' | 'depth' | 'backtest' | 'learning' | 'dex' | 'dune' | 'settings';

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('sf.lang');
      return saved === 'en' ? 'en' : 'ar';
    } catch {
      return 'ar';
    }
  });
  const [activeAsset, setActiveAsset] = useState<SupportedAsset>('BTC');
  const [summary, setSummary] = useState<TickerSummary[]>([]);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [history, setHistory] = useState<StoredSignal[]>([]);
  const [attribution, setAttribution] = useState<AttributionSummary | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [regime, setRegime] = useState<LiquidityRegime | null>(null);
  const [providers, setProviders] = useState<ProviderHealthInfo[]>([]);
  const [dune, setDune] = useState<DuneInfo | null>(null);
  const [tab, setTab] = useState<Tab>('history');
  const [showSettings, setShowSettings] = useState(false);
  const [showDailyReport, setShowDailyReport] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const hiddenRef = useRef(false);
  const activeAssetRef = useRef(activeAsset);
  activeAssetRef.current = activeAsset;
  const requestSeqRef = useRef(0);

  useEffect(() => {
    applyDocumentDir(lang);
    try {
      localStorage.setItem('sf.lang', lang);
    } catch {
      // ignore
    }
  }, [lang]);

  const refreshCore = useCallback(async () => {
    if (hiddenRef.current) return;
    const currentSeq = ++requestSeqRef.current;
    const reqAsset = activeAsset;
    try {
      const [sRes, sigRes, hRes, attRes, hpRes, liqRes, provsRes, duneRes] = await Promise.allSettled([
        api.summary(),
        api.signal(reqAsset),
        api.signals(60),
        api.attribution(),
        api.health(),
        api.liquidity(),
        api.providers(),
        api.dune(),
      ]);

      // If user switched asset or a newer request began, avoid stale overwrite
      if (currentSeq !== requestSeqRef.current || reqAsset !== activeAssetRef.current) {
        return;
      }

      if (sRes.status === 'fulfilled') setSummary(sRes.value.assets);
      if (sigRes.status === 'fulfilled') {
        setSignal(sigRes.value.signal);
        setSignalError(null);
      } else {
        setSignalError(sigRes.reason instanceof Error ? sigRes.reason.message : String(sigRes.reason));
      }
      if (hRes.status === 'fulfilled') setHistory(hRes.value.signals);
      if (attRes.status === 'fulfilled') setAttribution(attRes.value.summary);
      if (hpRes.status === 'fulfilled') setHealth(hpRes.value);
      if (liqRes.status === 'fulfilled' && liqRes.value) setRegime(liqRes.value.regime);
      if (provsRes.status === 'fulfilled' && provsRes.value) setProviders(provsRes.value.providers);
      if (duneRes.status === 'fulfilled' && duneRes.value) setDune(duneRes.value);
      setLastUpdate(Date.now());
    } catch (e) {
      if (currentSeq === requestSeqRef.current) {
        setSignalError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [activeAsset]);

  useEffect(() => {
    const onVisibility = () => {
      hiddenRef.current = document.hidden;
      if (!document.hidden) void refreshCore();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refreshCore]);

  useEffect(() => {
    void refreshCore();
    const t = setInterval(() => void refreshCore(), 30_000);
    return () => clearInterval(t);
  }, [refreshCore]);

  const changeAsset = (a: SupportedAsset) => {
    setActiveAsset(a);
    setSignal(null);
  };

  const priceChip = (a: TickerSummary) => {
    const up = (a.change24h ?? 0) >= 0;
    return (
      <button
        key={a.asset}
        onClick={() => a.ok && changeAsset(a.asset)}
        className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition-all ${
          activeAsset === a.asset
            ? 'border-amber-400/60 bg-amber-400/10 glow-amber'
            : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
        } ${a.ok ? '' : 'opacity-40'}`}
      >
        <span className="text-xs font-bold text-zinc-300">{a.asset}</span>
        <span className="text-sm font-bold tabular-nums text-zinc-100" dir="ltr">
          {a.ok && a.price ? `$${a.price.toLocaleString('en-US')}` : '—'}
        </span>
        {a.ok && (
          <span className={`text-[11px] font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
            {up ? '+' : ''}
            {a.change24h?.toFixed(2)}%
          </span>
        )}
      </button>
    );
  };

  const te = (key: Parameters<typeof t>[1]) => t(lang, key);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ─── الترويسة الشاملة (Terminal Top Bar) ─── */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] w-full flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* الجانب الأيمن: الشعار + بطاقات أسعار العملات الفورية */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-zinc-950 shadow-md">
                <Activity size={20} strokeWidth={2.5} />
              </div>
              <div className="leading-tight">
                <div className="text-base font-extrabold tracking-tight">
                  <span className="text-amber-400">SignalForge</span>
                </div>
                <div className="text-[10px] text-zinc-500">{te('tagline')}</div>
              </div>
            </div>

            {/* الأصول السريعة المباشرة */}
            <div className="flex items-center gap-2">
              {summary.map(priceChip)}
            </div>
          </div>

          {/* منتصف الترويسة: نبض السوق الفوري ومؤشرات المحرك (استغلال الفراغ باحترافية) */}
          <div className="hidden items-center gap-4 rounded-xl border border-zinc-800/90 bg-zinc-900/60 px-3.5 py-1.5 text-xs lg:flex shadow-inner">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">{lang === 'ar' ? 'وضع السيولة:' : 'Regime:'}</span>
              <span className={`font-bold ${
                regime?.verdict === 'RISK_ON'
                  ? 'text-emerald-400'
                  : regime?.verdict === 'RISK_OFF'
                  ? 'text-rose-400'
                  : 'text-zinc-200'
              }`}>
                {regime?.verdict ?? '—'}
              </span>
            </div>
            <div className="h-3 w-px bg-zinc-800" />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">{lang === 'ar' ? 'قاطع الدائرة:' : 'Circuit:'}</span>
              <span className={health?.protection?.breakerTripped ? 'font-bold text-rose-400' : 'font-bold text-emerald-400'}>
                {health?.protection?.breakerTripped ? (lang === 'ar' ? '⚠️ مفعّل' : '⚠️ Tripped') : (lang === 'ar' ? '✅ نشط وآمن' : '✅ Protected')}
              </span>
            </div>
            <div className="h-3 w-px bg-zinc-800" />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">{lang === 'ar' ? 'شبكة Dune:' : 'Dune On-Chain:'}</span>
              <span className={dune?.enabled ? 'font-bold text-sky-400' : 'text-zinc-500'}>
                {dune?.enabled ? (lang === 'ar' ? 'متصل 🐋' : 'Online 🐋') : (lang === 'ar' ? 'جاهز' : 'Standby')}
              </span>
            </div>
          </div>

          {/* الجانب الأيسر: الإجراءات والإعدادات واللغة والتقرير اليومي */}
          <div className="flex items-center gap-2">
            <div className="mx-1 hidden items-center gap-1.5 text-[11px] text-zinc-500 md:flex">
              {health ? <Wifi size={13} className="text-emerald-500" /> : <WifiOff size={13} className="text-rose-500" />}
              <span dir="ltr">{lastUpdate ? new Date(lastUpdate).toLocaleTimeString('ar-EG') : '—'}</span>
            </div>
            <button
              onClick={() => setShowDailyReport(true)}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20 hover:border-amber-400/60"
              title={lang === 'ar' ? 'تقرير المحطة اليومي الشامل (JSON / CSV / PDF)' : 'Daily Terminal Report (JSON / CSV / PDF)'}
            >
              <FileText size={14} />
              <span className="hidden sm:inline">{lang === 'ar' ? 'التقرير اليومي' : 'Daily Report'}</span>
            </button>
            <button
              onClick={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-emerald-400/50 hover:text-emerald-300"
              title={lang === 'ar' ? 'English' : 'العربية'}
            >
              <Globe size={14} />
              {lang === 'ar' ? 'EN' : 'عربي'}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-amber-400/50 hover:text-amber-300"
            >
              <Settings size={14} />
              <span className="hidden sm:inline">{te('settings')}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] w-full px-4 sm:px-6 py-5">
        {/* ─── الشبكة المتوازنة (Balanced Grid) ─── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* العمود الرئيسي: الرسم البياني + كارت التوصية + مساحة العمل والتبويبات التحليلية */}
          <section className="space-y-4 lg:col-span-2">
            <PriceChart asset={activeAsset} signal={signal} lang={lang} />
            {health?.protection?.choppyCooldown?.active && (
              <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-4 text-sm text-rose-200">
                <div className="font-bold">🛡️ {te('choppyActive')}</div>
                <div className="mt-1 text-xs text-rose-200/70">
                  {health.protection.choppyCooldown.consecutiveLosses} {lang === 'ar' ? 'خسائر متتالية — تم إيقاف إشارات الشراء مؤقتًا' : 'consecutive losses — new BUY signals are paused'}
                  {health.protection.choppyCooldown.cooldownUntil ? ` · ${new Date(health.protection.choppyCooldown.cooldownUntil).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}` : ''}
                </div>
              </div>
            )}
            {signalError ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-300">
                {te('signalError')}: {signalError}
                <button onClick={() => void refreshCore()} className="mr-3 rounded-lg border border-rose-400/40 px-2 py-0.5 text-xs hover:bg-rose-500/10">
                  {te('retry')}
                </button>
              </div>
            ) : signal ? (
              <SignalCard signal={signal} lang={lang} />
            ) : (
              <div className="h-64 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40" />
            )}

            {/* مساحة عمل التبويبات مدمجة مباشرة أسفل الإشارة لاستغلال الفراغ الرأسي بالكامل */}
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-4">
              <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-2">
                {([
                  ['history', te('tabHistory')],
                  ['elliott', te('tabElliott')],
                  ['macro', te('tabMacro')],
                  ['depth', te('tabDepth')],
                  ['backtest', te('tabBacktest')],
                  ['dex', te('tabDex')],
                  ['dune', te('tabDune')],
                  ['learning', te('tabLearning')],
                  ['settings', te('tabSettings')],
                ] as [Tab, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                      tab === key
                        ? 'bg-amber-400/15 text-amber-300 border border-amber-400/40 shadow-sm'
                        : 'border border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="pt-4 rise-in">
                {tab === 'history' && <HistoryPanel signals={history} onRefresh={() => void refreshCore()} lang={lang} />}
                {tab === 'elliott' && <ElliottWavePanel asset={activeAsset} lang={lang} />}
                {tab === 'macro' && <MacroCalendarPanel lang={lang} />}
                {tab === 'depth' && <WhaleDepthPanel asset={activeAsset} lang={lang} />}
                {tab === 'backtest' && <BacktestPanel lang={lang} />}
                {tab === 'dex' && <DexPanel lang={lang} />}
                {tab === 'dune' && <DuneResearchPanel lang={lang} />}
                {tab === 'learning' && <LearningPanel lang={lang} />}
                {tab === 'settings' && <SettingsPanel onSaved={() => void refreshCore()} lang={lang} />}
              </div>
            </div>
          </section>

          {/* العمود الجانبي: لوحة المراقبة وإدارة المخاطر والسيولة */}
          <aside className="space-y-4">
            {/* حالة المحرك */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-300">
                <ShieldCheck size={16} className="text-amber-400" />
                {te('engineStatus')}
              </div>
              <div className="space-y-2 text-xs text-zinc-400">
                <div className="flex justify-between">
                  <span>{te('version')}</span>
                  <span className="font-mono text-zinc-200" dir="ltr">v{health?.version ?? '…'}</span>
                </div>
                <div className="flex justify-between">
                  <span>{te('lastScan')}</span>
                  <span dir="ltr" className="text-zinc-200">
                    {health?.lastScanAt ? new Date(health.lastScanAt).toLocaleTimeString('ar-EG') : te('waiting')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{te('activeAsset')}</span>
                  <span className="text-zinc-200">{ASSET_LABELS_AR[activeAsset]}</span>
                </div>
                <div className="flex justify-between">
                  <span>{te('dataSource')}</span>
                  <span className={signal?.dataSource === 'STALE' ? 'text-amber-400' : 'text-emerald-400'}>
                    {signal?.dataSource === 'STALE' ? te('stale') : signal ? te('live') : '—'}
                  </span>
                </div>
              </div>
              <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] leading-5 text-zinc-500">
                {te('engineNote')}
              </p>
            </div>

            {attribution && <AttributionPanel summary={attribution} lang={lang} />}

            <LiquidityCard regime={regime} lang={lang} />

            <DuneContextPanel data={dune} lang={lang} />

            <PaperPanel lang={lang} />

            <LiquidationPanel asset={activeAsset} lang={lang} />

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <ProviderDots providers={providers} lang={lang} />
            </div>

            {/* إخلاء مسؤولية */}
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] leading-5 text-amber-200/70">
              ⚠️ {te('disclaimer')}
            </div>
          </aside>
        </div>
      </main>

      {/* نافذة الإعدادات */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowSettings(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <SettingsPanel onSaved={() => void refreshCore()} lang={lang} />
            <button onClick={() => setShowSettings(false)} className="mt-4 w-full rounded-xl border border-zinc-800 py-2 text-sm font-bold text-zinc-400 hover:text-zinc-200">
              {te('close')}
            </button>
          </div>
        </div>
      )}

      {/* نافذة التقرير اليومي الشامل */}
      <DailyReportModal
        lang={lang}
        isOpen={showDailyReport}
        onClose={() => setShowDailyReport(false)}
      />

      <footer className="mx-auto max-w-[1600px] px-4 py-8 text-center text-[11px] text-zinc-600">
        SignalForge v{health?.version ?? '1.0.0'} — {health?.engineSignature ?? ''}
      </footer>
    </div>
  );
}
