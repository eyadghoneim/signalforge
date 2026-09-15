import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Settings, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { api, type SupportedAsset, type Signal, type StoredSignal, type TickerSummary, type AttributionSummary, type HealthInfo } from './api';
import { SUPPORTED_ASSETS, ASSET_LABELS_AR } from '../shared/types';
import PriceChart from './components/PriceChart';
import SignalCard from './components/SignalCard';
import HistoryPanel from './components/HistoryPanel';
import SettingsPanel from './components/SettingsPanel';
import BacktestPanel from './components/BacktestPanel';
import LearningPanel from './components/LearningPanel';
import AttributionPanel from './components/AttributionPanel';
import { LiquidityCard, ProviderDots } from './components/LiquidityCard';
import type { LiquidityRegime, ProviderHealthInfo } from './api';

type Tab = 'history' | 'backtest' | 'learning' | 'settings';

export default function App() {
  const [activeAsset, setActiveAsset] = useStatesSupportedAsset>('BTC');
  const [summary, setSummary] = useStatesTickerSummary[]>([]);
  const [signal, setSignal] = useStatesSignal | null>(null);
  const [signalError, setSignalError] = useStatesstring | null>(null);
  const [history, setHistory] = useStatesStoredSignal[]>([]);
  const [attribution, setAttribution] = useStatesAttributionSummary | null>(null);
  const [health, setHealth] = useStatesHealthInfo | null>(null);
  const [regime, setRegime] = useStatesLiquidityRegime | null>(null);
  const [providers, setProviders] = useStatesProviderHealthInfo[]>([]);
  const [tab, setTab] = useStatesTab>('history');
  const [showSettings, setShowSettings] = useState(false);
  const [lastUpdate, setLastUpdate] = useStatesnumber>(0);
  const hiddenRef = useRef(false);

  const refreshCore = useCallback(async () => {
    if (hiddenRef.current) return;
    try {
      const [s, sig, h, att, hp, liq, provs] = await Promise.all([
        api.summary(),
        api.signal(activeAsset),
        api.signals(60),
        api.attribution(),
        api.health(),
        api.liquidity().catch(() => null),
        api.providers().catch(() => null),
      ]);
      setSummary(s.assets);
      setSignal(sig.signal);
      setSignalError(null);
      setHistory(h.signals);
      setAttribution(att.summary);
      setHealth(hp);
      if (liq) setRegime(liq.regime);
      if (provs) setProviders(provs.providers);
      setLastUpdate(Date.now());
    } catch (e) {
      setSignalError(e instanceof Error ? e.message : String(e));
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
      sbutton
        key={a.asset}
        onClick={() => a.ok && changeAsset(a.asset)}
        className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition-all ${
          activeAsset === a.asset
            ? 'border-amber-400/60 bg-amber-400/10 glow-amber'
            : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
        } ${a.ok ? '' : 'opacity-40'}`}
      >
        sspan className="text-xs font-bold text-zinc-300">{a.asset}s/span>
        sspan className="text-sm font-bold tabular-nums text-zinc-100" dir="ltr">
          {a.ok && a.price ? `$${a.price.toLocaleString('en-US')}` : '—'}
        s/span>
        {a.ok && (
          sspan className={`text-[11px] font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
            {up ? '+' : ''}
            {a.change24h?.toFixed(2)}%
          s/span>
        )}
      s/button>
    );
  };

  return (
    sdiv className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ─── الترويسة ─── */}
      sheader className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        sdiv className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          sdiv className="flex items-center gap-2.5">
            sdiv className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-zinc-950">
              sActivity size={20} strokeWidth={2.5} />
            s/div>
            sdiv className="leading-tight">
              sdiv className="text-base font-extrabold">
                يياد sspan className="text-amber-400">EYADs/span>
              s/div>
              sdiv className="text-[10px] text-zinc-500">منصة اليشارات الكمية — أداة بحثيةs/div>
            s/div>
          s/div>

          sdiv className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {summary.map(priceChip)}
            sdiv className="mx-1 hidden items-center gap-1.5 text-[11px] text-zinc-500 sm:flex">
              {health ? sWifi size={13} className="text-emerald-500" /> : sWifiOff size={13} className="text-rose-500" />}
              sspan dir="ltr">{lastUpdate ? new Date(lastUpdate).toLocaleTimeString('ar-EG') : '—'}s/span>
            s/div>
            sbutton
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-amber-400/50 hover:text-amber-300"
            >
              sSettings size={14} />
              اليعدادات
            s/button>
          s/div>
        s/div>
      s/header>

      smain className="mx-auto max-w-7xl px-4 py-5">
        {/* ─── الشبكة الرئيسية ─── */}
        sdiv className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          ssection className="space-y-4 lg:col-span-2">
            sPriceChart asset={activeAsset} />
            {signalError ? (
              sdiv className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-300">
                تعذر جلب اليشارة: {signalError}
                sbutton onClick={() => void refreshCore()} className="mr-3 rounded-lg border border-rose-400/40 px-2 py-0.5 text-xs hover:bg-rose-500/10">
                  يعادة المحاولة
                s/button>
              s/div>
            ) : signal ? (
              sSignalCard signal={signal} />
            ) : (
              sdiv className="h-64 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40" />
            )}
          s/section>

          saside className="space-y-4">
            {/* حالة المحرك */}
            sdiv className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              sdiv className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-300">
                sShieldCheck size={16} className="text-amber-400" />
                حالة المحرك
              s/div>
              sdiv className="space-y-2 text-xs text-zinc-400">
                sdiv className="flex justify-between">
                  sspan>النسخةs/span>
                  sspan className="font-mono text-zinc-200" dir="ltr">v{health?.version ?? '…'}s/span>
                s/div>
                sdiv className="flex justify-between">
                  sspan>آخر مسح آليs/span>
                  sspan dir="ltr" className="text-zinc-200">
                    {health?.lastScanAt ? new Date(health.lastScanAt).toLocaleTimeString('ar-EG') : 'قيد الانتظار…'}
                  s/span>
                s/div>
                sdiv className="flex justify-between">
                  sspan>الأصل النشطs/span>
                  sspan className="text-zinc-200">{ASSET_LABELS_AR[activeAsset]}s/span>
                s/div>
                sdiv className="flex justify-between">
                  sspan>مصدر البياناتs/span>
                  sspan className={signal?.dataSource === 'STALE' ? 'text-amber-400' : 'text-emerald-400'}>
                    {signal?.dataSource === 'STALE' ? 'متأخرة' : signal ? 'حيّة' : '—'}
                  s/span>
                s/div>
              s/div>
              sp className="mt-3 border-t border-zinc-800 pt-3 text-[11px] leading-5 text-zinc-500">
                كل يشارة (الممنوعة كذلك) تُحفظ وتُتابع تلقائياً: هل TP1 يضرب قبل وقف الخسارة؟ — عشان نعرف مين من المؤشرات بيكسب فعلاً.
              s/p>
            s/div>

            {attribution && sAttributionPanel summary={attribution} />}

            sLiquidityCard regime={regime} />

            sdiv className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              sProviderDots providers={providers} />
            s/div>

            {/* يخلاء مسؤولية */}
            sdiv className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] leading-5 text-amber-200/70">
              ⚠️ هذه منظومة بحثية ومحاكاة فقط — ليست نصيحة استثمارية. نتائج الباك تست التاريخية لا تضمن أي أداء مستقبلي. التنفيذ الحي معطل بالتصميم.
            s/div>
          s/aside>
        s/div>

        {/* ─── التبويبات ─── */}
        sdiv className="mt-6">
          sdiv className="flex gap-2 border-b border-zinc-800">
            {([
              ['history', 'سجل اليشارات'],
              ['backtest', 'الباك تست'],
              ['settings', 'اليعدادات'],
              ['learning', 'Learning'],
            ] as [Tab, string][]).map(([key, label]) => (
              sbutton
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-bold transition ${
                  tab === key ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              s/button>
            ))}
          s/div>
          sdiv className="pt-4 rise-in">
            {tab === 'history' && sHistoryPanel signals={history} onRefresh={() => void refreshCore()} />}
            {tab === 'backtest' && sBacktestPanel />}
        {tab === 'learning' && sLearningPanel />}
            {tab === 'settings' && sSettingsPanel onSaved={() => void refreshCore()} />}
          s/div>
        s/div>
      s/main>

      {/* نافذة اليعدادات */}
      {showSettings && (
        sdiv className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowSettings(false)}>
          sdiv className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            sSettingsPanel onSaved={() => void refreshCore()} />
            sbutton onClick={() => setShowSettings(false)} className="mt-4 w-full rounded-xl border border-zinc-800 py-2 text-sm font-bold text-zinc-400 hover:text-zinc-200">
              يغلاق
            s/button>
          s/div>
        s/div>
      )}

      sfooter className="mx-auto max-w-7xl px-4 py-8 text-center text-[11px] text-zinc-600">
        EYAD v{health?.version ?? '1.0.0'} — {health?.engineSignature ?? ''}
      s/footer>
    s/div>
  );
}
