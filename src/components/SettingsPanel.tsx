import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Save, Send, XCircle } from 'lucide-react';
import { api, type ConfigInfo } from '../api';

export default function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [chatIdInput, setChatIdInput] = useState('');
  const [intervalInput, setIntervalInput] = useState(120);
  const [gates, setGates] = useState({ htf: true, chop: true, rvol: true, funding: true });
  const [enabled, setEnabled] = useState(false);
  const [regimeEnabled, setRegimeEnabled] = useState(true);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [dailyLossLimitR, setDailyLossLimitR] = useState(3);
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [expiryHours, setExpiryHours] = useState(3);
  const [corrGuard, setCorrGuard] = useState(true);
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
        if (res.config.protection) {
          setDailyLossLimitR(res.config.protection.dailyLossLimitR);
          setMaxConcurrent(res.config.protection.maxConcurrentSignals);
          setExpiryHours(res.config.protection.signalExpiryHours);
          setCorrGuard(res.config.protection.correlationGuard);
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
        gates,
        protection: {
          dailyLossLimitR,
          maxConcurrentSignals: maxConcurrent,
          signalExpiryHours: expiryHours,
          correlationGuard: corrGuard,
        },
      };
      if (tokenInput.trim() && !tokenInput.startsWith('••')) body.telegramToken = tokenInput.trim();
      if (chatIdInput.trim() && !chatIdInput.startsWith('••')) body.telegramChatId = chatIdInput.trim();
      await api.saveConfig(body);
      setMessage({ ok: true, text: 'حُفظت الإعدادات — المسح الآلي هيلتقطها في الدورة القادمة' });
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
      setMessage(res.ok ? { ok: true, text: '✅ وصلت رسالة الاختبار لتليجرام — الربط سليم' } : { ok: false, text: `فشل الاختبار: ${res.error}` });
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
      {/* تليجرام */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-300">
          <Bot size={16} className="text-sky-400" />
          إشعارات تليجرام
        </div>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div>
              <div className="text-xs font-bold text-zinc-200">تشغيل الإشعارات</div>
              <div className="text-[10px] text-zinc-500">إشارات الشراء/البيع القابلة للتنفيذ فقط (مع فترة تهدئة 30 دقيقة لكل أصل)</div>
            </div>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-amber-400" />
          </label>

          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div>
              <div className="text-xs font-bold text-zinc-200">التقرير اليومي الصادق</div>
              <div className="text-[10px] leading-4 text-zinc-500">مرة يومياً: عدد إشارات الأمس + نسبة نجاح المحسومة + أقوى العوامل — مفيش كلام حلو، أرقام بس</div>
            </div>
            <input type="checkbox" checked={digestEnabled} onChange={(e) => setDigestEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-amber-400" />
          </label>

          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Bot Token</div>
            <input
              type="password"
              value={tokenInput || (config?.hasTelegramToken ? `••••••••${config.telegramTokenMasked ? ` (${config.telegramTokenMasked})` : ''}` : '')}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="مثال: 6123456789:AAH…"
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
              placeholder="مثال: 123456789"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none"
              dir="ltr"
            />
          </div>

          <details className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-3 text-[10px] leading-5 text-zinc-500">
            <summary className="cursor-pointer font-bold text-zinc-400">إزاي أجهّز البوت؟ (3 خطوات)</summary>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>افتح تليجرام ودوّر على <b dir="ltr">@BotFather</b> وابعته <b dir="ltr">/newbot</b> واتبع الخطوات — هيدّيك توكن.</li>
              <li>دوّر على <b dir="ltr">@userinfobot</b> وابعتله أي رسالة — هيدّيك الـ Chat ID بتاعك.</li>
              <li>ابدأ محادثة مع البوت الجديد (اضغط Start) قبل الاختبار — تليجرام بيرفض الرسائل لمحادثة لم تبدأ.</li>
            </ol>
          </details>

          <button
            onClick={() => void testTelegram()}
            disabled={testing}
            className="flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-bold text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
          >
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            اختبر الاتصال
          </button>
        </div>
      </div>

      {/* بوابات المخاطر */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-1 text-sm font-bold text-zinc-300">بوابات المخاطر</div>
        <p className="mb-3 text-[10px] text-zinc-500">البوابات بتمنع دخول الشراء في الظروف الخطرة — الخروج الدفاعي بيتخطاها دايماً.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {gateRow('htf', 'بوابة الفريم الأكبر (4h)', 'حظر الشراء لو ترند 4 ساعات هابط — أقوى فلتر')}
          {gateRow('chop', 'بوابة السوق العرضي', 'حظر الشراء لو ADX أقل من 18 (سوق ميت)')}
          {gateRow('rvol', 'بوابة الفوليوم', 'حظر الكسر بفوليوم أقل من 0.45x (فخ سيولة)')}
          {gateRow('funding', 'بوابة تمويل العقود', 'حظر الشراء عند تمويل مرتفع (خطر تصفية)')}
        </div>
        <label className="mt-2 flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 transition hover:border-sky-500/50">
          <div>
            <div className="text-xs font-bold text-sky-200">طبقة السيولة العالمية (DefiLlama)</div>
            <div className="text-[10px] leading-4 text-zinc-500">تعديل الدرجة ±8 حسب TVL والعملات المستقرة وحجم DEX عالمياً</div>
          </div>
          <input type="checkbox" checked={regimeEnabled} onChange={(e) => setRegimeEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-sky-400" />
        </label>
      </div>

      {/* فترة المسح */}
      <div className="rounded-2xl border border-rose-500/25 bg-zinc-900/40 p-4">
        <div className="mb-1 text-sm font-bold text-zinc-300">Capital protection</div>
        <p className="mb-3 text-[10px] text-zinc-500">Daily loss breaker (R units), max concurrent open buys, signal expiry and the BTC/ETH correlation guard.</p>
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
        </div>
        <label className="mt-2 flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 transition hover:border-rose-500/50">
          <div>
            <div className="text-xs font-bold text-rose-200">BTC/ETH correlation guard</div>
            <div className="text-[10px] leading-4 text-zinc-500">Holding both longs together counts as +1 exposure unit.</div>
          </div>
          <input type="checkbox" checked={corrGuard} onChange={(e) => setCorrGuard(e.target.checked)} className="mt-1 h-4 w-4 accent-rose-400" />
        </label>
      </div>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3 text-sm font-bold text-zinc-300">فترة المسح الآلي</div>
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
        <p className="mt-1 text-[10px] text-zinc-500">كل مسح بيحدّث الأسعار ويحسب الإشارات ويحدّث عدّاد الأداء ويتبع نتائج الإشارات المفتوحة.</p>
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
        حفظ الإعدادات
      </button>
    </div>
  );
}
