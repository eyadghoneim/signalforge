import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Key, Loader2, Save, Send, Shield, XCircle } from 'lucide-react';
import { api, getAdminToken, setAdminToken, type ConfigInfo } from '../api';
import { t, type Lang } from '../i18n';

export default function SettingsPanel({ onSaved, lang }: { onSaved: () => void; lang: Lang }) {
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [adminTokenInput, setAdminTokenInput] = useState(() => getAdminToken());
  const [tokenInput, setTokenInput] = useState('');
  const [chatIdInput, setChatIdInput] = useState('');
  const [intervalInput, setIntervalInput] = useState(120);
  const [gates, setGates] = useState({ htf: true, chop: true, rvol: true, funding: true });
  const [enabled, setEnabled] = useState(false);
  const [regimeEnabled, setRegimeEnabled] = useState(true);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [paperAlertsEnabled, setPaperAlertsEnabled] = useState(true);
  const [telegramLang, setTelegramLang] = useState<'ar' | 'en'>('ar');
  const [dailyLossLimitR, setDailyLossLimitR] = useState(3);
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [expiryHours, setExpiryHours] = useState(3);
  const [corrGuard, setCorrGuard] = useState(true);
  const [stoplossGuardMax, setStoplossGuardMax] = useState(3);
  const [stoplossGuardHours, setStoplossGuardHours] = useState(6);
  const [lossCooldownHours, setLossCooldownHours] = useState(2);
  const [choppyLossStreak, setChoppyLossStreak] = useState(3);
  const [choppyCooldownHours, setChoppyCooldownHours] = useState(24);
  const [paperMaxHoldHours, setPaperMaxHoldHours] = useState(168);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.config();
        setConfig(res.config);
        setIntervalInput(res.config.scanIntervalSeconds);
        setGates(res.config.gates);
        setEnabled(res.config.telegramEnabled);
        setRegimeEnabled(res.config.regimeEnabled);
        setDigestEnabled(res.config.digestEnabled);
        setPaperAlertsEnabled(res.config.paperAlertsEnabled);
        setTelegramLang(res.config.telegramLang ?? 'ar');
        if (res.config.protection) {
          setDailyLossLimitR(res.config.protection.dailyLossLimitR);
          setMaxConcurrent(res.config.protection.maxConcurrentSignals);
          setExpiryHours(res.config.protection.signalExpiryHours);
          setCorrGuard(res.config.protection.correlationGuard);
          setStoplossGuardMax(res.config.protection.stoplossGuardMax);
          setStoplossGuardHours(res.config.protection.stoplossGuardHours);
          setLossCooldownHours(res.config.protection.lossCooldownHours);
          setChoppyLossStreak(res.config.protection.choppyLossStreak);
          setChoppyCooldownHours(res.config.protection.choppyCooldownHours);
          setPaperMaxHoldHours(res.config.protection.paperMaxHoldHours);
        }
        setChatIdInput(res.config.hasChatId ? '••••••••' : '');
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: Parameters<typeof api.saveConfig>[0] = {
        scanIntervalSeconds: intervalInput,
        telegramEnabled: enabled,
        regimeEnabled,
        digestEnabled,
        paperAlertsEnabled,
        telegramLang,
        gates,
        protection: {
          dailyLossLimitR,
          maxConcurrentSignals: maxConcurrent,
          signalExpiryHours: expiryHours,
          stoplossGuardMax,
          stoplossGuardHours,
          lossCooldownHours,
          choppyLossStreak,
          choppyCooldownHours,
          paperMaxHoldHours,
          correlationGuard: corrGuard,
        },
      };
      setAdminToken(adminTokenInput.trim());
      if (tokenInput.trim() && !tokenInput.startsWith('••')) body.telegramToken = tokenInput.trim();
      if (chatIdInput.trim() && !chatIdInput.startsWith('••')) body.telegramChatId = chatIdInput.trim();
      await api.saveConfig(body);
      setMessage({ ok: true, text: t(lang, 'setSaved') });
      setTokenInput('');
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const testTelegram = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await api.telegramTest();
      setMessage(res.ok ? { ok: true, text: t(lang, 'setTestOk') } : { ok: false, text: `${t(lang, 'setTestFail')} ${res.error}` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const gateRow = (key: keyof typeof gates, label: string, desc: string) => (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 transition hover:border-zinc-700">
      <div>
        <div className="text-xs font-bold text-zinc-200">{label}</div>
        <div className="text-[10px] leading-4 text-zinc-500">{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={gates[key]}
        onChange={(e) => setGates((g) => ({ ...g, [key]: e.target.checked }))}
        className="mt-1 h-4 w-4 accent-amber-400"
      />
    </label>
  );

  return (
    <div className="space-y-5">
      {/* حماية الإدارة (Admin Authentication) */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
            <Shield size={16} className="text-amber-400" />
            {lang === 'ar' ? 'توثيق الإدارة (Admin Token)' : 'Admin Authentication'}
          </div>
          {config?.adminRequired && (
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
              {lang === 'ar' ? 'مطلوب للتعديل' : 'Admin Required'}
            </span>
          )}
        </div>
        <p className="mb-3 text-[10px] leading-4 text-zinc-500">
          {lang === 'ar'
            ? 'إذا كان السيرفر محمياً بـ BOT_ADMIN_TOKEN، أدخل التوكن هنا لتتمكن من حفظ الإعدادات وتصفير الحسابات وتشغيل استعلامات Dune بأمان.'
            : 'If the server is configured with BOT_ADMIN_TOKEN, enter your token here to authorize saving settings and privileged actions.'}
        </p>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500">
            <Key size={14} />
          </div>
          <input
            type="password"
            value={adminTokenInput}
            onChange={(e) => setAdminTokenInput(e.target.value)}
            placeholder={lang === 'ar' ? 'أدخل رمز إدارة البوت x-bot-admin-token...' : 'Enter x-bot-admin-token...'}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:border-amber-400/50 focus:outline-none"
            dir="ltr"
          />
        </div>
      </div>

      {/* تليجرام */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-300">
          <Bot size={16} className="text-sky-400" />
          {t(lang, 'setTelegram')}
        </div>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div>
              <div className="text-xs font-bold text-zinc-200">{t(lang, 'setTelegramOn')}</div>
              <div className="text-[10px] text-zinc-500">{t(lang, 'setTelegramOnDesc')}</div>
            </div>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-amber-400" />
          </label>

          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div>
              <div className="text-xs font-bold text-zinc-200">{t(lang, 'setDigest')}</div>
              <div className="text-[10px] leading-4 text-zinc-500">{t(lang, 'setDigestDesc')}</div>
            </div>
            <input type="checkbox" checked={digestEnabled} onChange={(e) => setDigestEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-amber-400" />
          </label>

          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div>
              <div className="text-xs font-bold text-zinc-200">{t(lang, 'setPaperAlerts')}</div>
              <div className="text-[10px] leading-4 text-zinc-500">{t(lang, 'setPaperAlertsDesc')}</div>
            </div>
            <input type="checkbox" checked={paperAlertsEnabled} onChange={(e) => setPaperAlertsEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-amber-400" />
          </label>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div>
              <div className="text-xs font-bold text-zinc-200">{t(lang, 'setTelegramLang')}</div>
            </div>
            <select
              value={telegramLang}
              onChange={(e) => setTelegramLang(e.target.value === 'en' ? 'en' : 'ar')}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
            >
              <option value="ar">{t(lang, 'langArabic')}</option>
              <option value="en">{t(lang, 'langEnglish')}</option>
            </select>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Bot Token</div>
            <input
              type="password"
              value={tokenInput || (config?.hasTelegramToken ? `••••••••${config.telegramTokenMasked ? ` (${config.telegramTokenMasked})` : ''}` : '')}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="6123456789:AAH…"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>

          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Chat ID</div>
            <input
              type="text"
              value={chatIdInput}
              onChange={(e) => setChatIdInput(e.target.value)}
              placeholder="123456789"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>

          <details className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-3 text-[10px] leading-5 text-zinc-500">
            <summary className="cursor-pointer font-bold text-zinc-400">{t(lang, 'setHowTo')}</summary>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>{t(lang, 'setStep1')}</li>
              <li>{t(lang, 'setStep2')}</li>
              <li>{t(lang, 'setStep3')}</li>
            </ol>
          </details>

          <button
            onClick={() => void testTelegram()}
            disabled={testing}
            className="flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-bold text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
          >
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {t(lang, 'setTest')}
          </button>
        </div>
      </div>

      {/* بوابات المخاطر */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-1 text-sm font-bold text-zinc-300">{t(lang, 'setRiskGates')}</div>
        <p className="mb-3 text-[10px] text-zinc-500">{t(lang, 'setRiskGatesDesc')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {gateRow('htf', t(lang, 'gateHtf'), t(lang, 'gateHtfDesc'))}
          {gateRow('chop', t(lang, 'gateChop'), t(lang, 'gateChopDesc'))}
          {gateRow('rvol', t(lang, 'gateRvol'), t(lang, 'gateRvolDesc'))}
          {gateRow('funding', t(lang, 'gateSqueeze'), t(lang, 'gateSqueezeDesc'))}
        </div>
        <label className="mt-2 flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 transition hover:border-sky-500/50">
          <div>
            <div className="text-xs font-bold text-sky-200">{t(lang, 'setLiquidityLayer')}</div>
            <div className="text-[10px] leading-4 text-zinc-500">{t(lang, 'setLiquidityLayerDesc')}</div>
          </div>
          <input type="checkbox" checked={regimeEnabled} onChange={(e) => setRegimeEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-sky-400" />
        </label>
      </div>

      {/* حماية رأس المال */}
      <div className="rounded-2xl border border-rose-500/25 bg-zinc-900/40 p-4">
        <div className="mb-1 text-sm font-bold text-zinc-300">Capital protection</div>
        <p className="mb-3 text-[10px] text-zinc-500">Daily loss breaker, exposure cap, signal expiry, BTC/ETH guard, three-loss choppy cooldown, StoplossGuard, and a maximum Paper position age.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Daily loss limit (R)</div>
            <input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={dailyLossLimitR}
              onChange={(e) => setDailyLossLimitR(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Max open signals</div>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Signal expiry (hours)</div>
            <input
              type="number"
              min={1}
              max={72}
              step={1}
              value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Stoploss guard (max SL count)</div>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={stoplossGuardMax}
              onChange={(e) => setStoplossGuardMax(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Stoploss guard window (hours)</div>
            <input
              type="number"
              min={1}
              max={72}
              step={1}
              value={stoplossGuardHours}
              onChange={(e) => setStoplossGuardHours(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Loss cooldown (hours)</div>
            <input
              type="number"
              min={0}
              max={48}
              step={1}
              value={lossCooldownHours}
              onChange={(e) => setLossCooldownHours(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Choppy cooldown losses</div>
            <input
              type="number"
              min={2}
              max={10}
              step={1}
              value={choppyLossStreak}
              onChange={(e) => setChoppyLossStreak(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Choppy cooldown (hours)</div>
            <input
              type="number"
              min={1}
              max={168}
              step={1}
              value={choppyCooldownHours}
              onChange={(e) => setChoppyCooldownHours(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Max paper hold (hours)</div>
            <input
              type="number"
              min={24}
              max={720}
              step={24}
              value={paperMaxHoldHours}
              onChange={(e) => setPaperMaxHoldHours(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-rose-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>
        </div>
        <label className="mt-2 flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 transition hover:border-rose-500/50">
          <div>
            <div className="text-xs font-bold text-rose-200">BTC/ETH correlation guard</div>
            <div className="text-[10px] leading-4 text-zinc-500">Holding both longs together counts as +1 exposure unit.</div>
          </div>
          <input type="checkbox" checked={corrGuard} onChange={(e) => setCorrGuard(e.target.checked)} className="mt-1 h-4 w-4 accent-rose-400" />
        </label>
      </div>

      {/* فترة المسح */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3 text-sm font-bold text-zinc-300">{t(lang, 'setScanInterval')}</div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={30}
            max={600}
            step={10}
            value={intervalInput}
            onChange={(e) => setIntervalInput(Number(e.target.value))}
            className="flex-1 accent-amber-400"
            dir="ltr"
          />
          <span className="w-24 text-center text-sm font-extrabold tabular-nums text-amber-300" dir="ltr">{intervalInput}s</span>
        </div>
        <p className="mt-1 text-[10px] text-zinc-500">{t(lang, 'setScanIntervalDesc')}</p>
      </div>

      {/* الحفظ */}
      {message && (
        <div className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${message.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-rose-500/30 bg-rose-500/5 text-rose-300'}`}>
          {message.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {message.text}
        </div>
      )}
      <button
        onClick={() => void save()}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-2.5 text-sm font-extrabold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-50"
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {t(lang, 'setSave')}
      </button>
    </div>
  );
}
