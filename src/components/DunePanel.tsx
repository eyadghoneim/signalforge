import { useEffect, useState } from 'react';
import { Database, Download, Play, RefreshCw, Zap, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight, Bookmark, Trash2, Send, CheckCircle2 } from 'lucide-react';
import { api, type DuneWhaleTrade, type DuneTopToken } from '../api';
import type { Lang } from '../i18n';

interface Props {
  lang: Lang;
}

type ViewMode = 'whales' | 'tokens' | 'sql';

const STABLE_SYMBOLS = "('USDT','USDC','DAI','USDS','FDUSD','USDe','PYUSD','crvUSD','FRAX','BUSD','GUSD','LUSD','sUSD')";

interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
}

const STORAGE_KEY_SAVED_QUERIES = 'signalforge_user_dune_queries';

const PRESET_QUERIES = [
  {
    nameAr: 'صفقات الحيتان (استبعاد العملات المستقرة)',
    nameEn: 'Whale Swaps (Excluding Stables)',
    sql: `SELECT
  CAST(block_time AS VARCHAR) as block_time,
  project,
  token_bought_symbol,
  token_sold_symbol,
  round(amount_usd, 2) as amount_usd
FROM dex.trades
WHERE block_time > now() - interval '3' hour
  AND amount_usd >= 100000
  AND NOT (
    token_bought_symbol IN ${STABLE_SYMBOLS}
    AND token_sold_symbol IN ${STABLE_SYMBOLS}
  )
ORDER BY block_time DESC
LIMIT 20`,
  },
  {
    nameAr: 'صفقات كبار الكريبتو (BTC / ETH / SOL)',
    nameEn: 'Major Crypto Swaps (BTC/ETH/SOL)',
    sql: `SELECT
  CAST(block_time AS VARCHAR) as block_time,
  project,
  token_bought_symbol,
  token_sold_symbol,
  round(amount_usd, 2) as amount_usd
FROM dex.trades
WHERE block_time > now() - interval '6' hour
  AND amount_usd >= 50000
  AND (
    token_bought_symbol IN ('WETH', 'ETH', 'WBTC', 'BTC', 'SOL', 'WSOL', 'PAXG')
    OR token_sold_symbol IN ('WETH', 'ETH', 'WBTC', 'BTC', 'SOL', 'WSOL', 'PAXG')
  )
ORDER BY block_time DESC
LIMIT 20`,
  },
  {
    nameAr: 'تجميع الحيتان (شراء الكريبتو بالدولار المستقر)',
    nameEn: 'Whale Accumulation (Buy with Stables)',
    sql: `SELECT
  CAST(block_time AS VARCHAR) as block_time,
  project,
  token_bought_symbol as bought_crypto,
  token_sold_symbol as sold_stable,
  round(amount_usd, 2) as amount_usd
FROM dex.trades
WHERE block_time > now() - interval '6' hour
  AND amount_usd >= 75000
  AND token_sold_symbol IN ${STABLE_SYMBOLS}
  AND token_bought_symbol NOT IN ${STABLE_SYMBOLS}
ORDER BY amount_usd DESC
LIMIT 20`,
  },
  {
    nameAr: 'أعلى العملات حجماً (غير مستقرة)',
    nameEn: 'Top Non-Stable Tokens (24h)',
    sql: `SELECT
  token_bought_symbol,
  count(*) as trades_count,
  round(sum(amount_usd), 2) as total_usd_volume
FROM dex.trades
WHERE block_time > now() - interval '24' hour
  AND amount_usd >= 10000
  AND token_bought_symbol IS NOT NULL
  AND token_bought_symbol NOT IN ${STABLE_SYMBOLS}
GROUP BY token_bought_symbol
ORDER BY total_usd_volume DESC
LIMIT 10`,
  },
  {
    nameAr: 'أكبر مجمعات سيولة على Uniswap v3',
    nameEn: 'Top Uniswap v3 Pool Swaps',
    sql: `SELECT
  CAST(block_time AS VARCHAR) as block_time,
  project,
  token_bought_symbol,
  token_sold_symbol,
  round(amount_usd, 2) as amount_usd
FROM dex.trades
WHERE block_time > now() - interval '12' hour
  AND project = 'uniswap'
  AND amount_usd >= 200000
ORDER BY amount_usd DESC
LIMIT 15`,
  },
];

export default function DunePanel({ lang }: Props) {
  const isAr = lang === 'ar';
  const [view, setView] = useState<ViewMode>('whales');
  const [whaleTrades, setWhaleTrades] = useState<DuneWhaleTrade[]>([]);
  const [topTokens, setTopTokens] = useState<DuneTopToken[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SQL Runner state
  const [customSql, setCustomSql] = useState(PRESET_QUERIES[0].sql);
  const [sqlResults, setSqlResults] = useState<Record<string, unknown>[] | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Custom Query Library state
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SAVED_QUERIES);
      return raw ? (JSON.parse(raw) as SavedQuery[]) : [];
    } catch {
      return [];
    }
  });
  const [newQueryName, setNewQueryName] = useState('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);

  // Telegram test alert
  const [tgTesting, setTgTesting] = useState(false);
  const [tgFeedback, setTgFeedback] = useState<string | null>(null);

  const saveQueryToLibrary = () => {
    const trimmed = newQueryName.trim();
    if (!trimmed || !customSql.trim()) return;
    const item: SavedQuery = {
      id: `query_${Date.now()}`,
      name: trimmed,
      sql: customSql.trim(),
      createdAt: Date.now(),
    };
    const updated = [item, ...savedQueries];
    setSavedQueries(updated);
    try {
      localStorage.setItem(STORAGE_KEY_SAVED_QUERIES, JSON.stringify(updated));
    } catch {
      // ignore
    }
    setNewQueryName('');
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 2500);
  };

  const deleteSavedQuery = (id: string) => {
    const updated = savedQueries.filter((q) => q.id !== id);
    setSavedQueries(updated);
    try {
      localStorage.setItem(STORAGE_KEY_SAVED_QUERIES, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const handleTestTelegramWhale = async () => {
    setTgTesting(true);
    setTgFeedback(null);
    try {
      const res = await api.telegramTestWhaleAlert();
      if (res.ok) {
        setTgFeedback(isAr ? 'تم إرسال إشعار الحوت التجريبي لتليجرام بنجاح!' : 'Test whale alert sent to Telegram successfully!');
      } else {
        setTgFeedback(res.error || (isAr ? 'تعذر الإرسال. تحقق من إعدادات البوت' : 'Failed to send. Check bot settings'));
      }
    } catch (e) {
      setTgFeedback(e instanceof Error ? e.message : String(e));
    } finally {
      setTgTesting(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await api.duneStatus();
      setAvailable(status.available);
      if (!status.available) {
        setWhaleTrades([]);
        setTopTokens([]);
        return;
      }
      const [tradesRes, tokensRes] = await Promise.all([
        api.duneWhaleTrades(),
        api.duneTopTokens(),
      ]);
      setWhaleTrades(tradesRes.trades);
      setTopTokens(tokensRes.tokens);
    } catch (e) {
      setAvailable(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleRunSql = async () => {
    if (!customSql.trim() || available === false) return;
    setSqlLoading(true);
    setSqlError(null);
    try {
      const res = await api.duneRunSql(customSql.trim());
      setSqlResults(res.rows);
      setExecutionTime(res.executionTimeMs);
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : String(e));
      setSqlResults(null);
    } finally {
      setSqlLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!sqlResults || sqlResults.length === 0) return;
    const headers = Object.keys(sqlResults[0]);
    const rows = sqlResults.map((r) =>
      headers.map((h) => {
        const val = r[h];
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(','),
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `dune_query_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatUsd = (num: number) => {
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
    return `$${num.toLocaleString()}`;
  };

  const isStable = (sym: string) => ['USDT', 'USDC', 'DAI', 'FDUSD', 'USDBC', 'USDE', 'USD'].includes(sym?.toUpperCase());

  return (
    <div className="space-y-6 pt-4 text-zinc-200">
      {/* رأس الصفحة والشارة */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
            <Database size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-zinc-100">
                {isAr ? 'رادار Dune Analytics Plus للبيانات الحية على الشبكة' : 'Dune Analytics Plus On-Chain Engine'}
              </h3>
              <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-orange-500/20 to-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-orange-300 border border-orange-500/30">
                <Zap size={12} className="text-orange-400" />
                {available === false ? (isAr ? 'غير مفعّل' : 'Optional / disabled') : 'Dune Plus'}
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              {isAr
                ? 'سياق بحثي للبيانات اللامركزية عبر Trino SQL — صفقات كبيرة، حجم الأصول الموثوقة، واستعلامات محدودة التكلفة'
                : 'Read-only research context via Trino SQL — large swaps, verified-asset volume, and cost-limited queries'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {isAr ? 'تحديث البيانات' : 'Refresh Data'}
          </button>
          <button
            onClick={() => void handleTestTelegramWhale()}
            disabled={tgTesting}
            className="flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
            title={isAr ? 'إرسال نموذج تنبيه صفقة حوت فورية لتليجرام' : 'Send a test whale trade alert to Telegram'}
          >
            <Send size={14} className={tgTesting ? 'animate-pulse' : ''} />
            {tgTesting ? (isAr ? 'جاري الإرسال…' : 'Sending…') : (isAr ? 'تجربة تنبيه الحوت 🐋' : 'Test Whale Alert 🐋')}
          </button>
        </div>
      </div>

      {tgFeedback && (
        <div className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-200">
          <span>{tgFeedback}</span>
          <button onClick={() => setTgFeedback(null)} className="text-sky-400 hover:text-white">✕</button>
        </div>
      )}

      {/* التبويبات الداخلية */}
      <div className="flex gap-2 border-b border-zinc-800 pb-2">
        <button
          onClick={() => setView('whales')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
            view === 'whales'
              ? 'bg-zinc-800 text-orange-400 border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <DollarSign size={14} />
          {isAr ? 'صفقات الحيتان (> $100K)' : 'Whale Swaps (> $100K)'}
          {whaleTrades.length > 0 && (
            <span className="rounded-full bg-orange-500/20 px-2 py-0.2 text-[10px] text-orange-300">
              {whaleTrades.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setView('tokens')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
            view === 'tokens'
              ? 'bg-zinc-800 text-orange-400 border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <TrendingUp size={14} />
          {isAr ? 'أعلى العملات تداولاً (24h)' : 'Top DEX Tokens (24h)'}
        </button>

        <button
          onClick={() => setView('sql')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
            view === 'sql'
              ? 'bg-zinc-800 text-orange-400 border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Play size={14} />
          {isAr ? 'محرر ومُنفذ SQL + تصدير CSV' : 'Dune SQL Runner & CSV Export'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">
          {error}
        </div>
      )}

      {available === false && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-950/60 p-4 text-xs leading-5 text-zinc-400">
          {isAr
            ? 'Dune اختياري وغير مفعّل حاليًا. أضف DUNE_API_KEY كـ Secret على السيرفر فقط. هذه الطبقة بحثية ولا تغيّر الإشارات أو تنفّذ تداولًا.'
            : 'Dune is optional and currently disabled. Add DUNE_API_KEY as a server-side Secret only. This layer is research-only and never changes signals or executes trades.'}
        </div>
      )}

      {/* ─── عرض صفقات الحيتان ─── */}
      {view === 'whales' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>
              {isAr
                ? 'أحدث المعاملات اللامركزية الضخمة المسجلة على البلوكشين (Uniswap, Fluid, Curve)'
                : 'Latest verified massive on-chain DEX swaps across Ethereum protocols'}
            </span>
            <span className="text-[11px] text-zinc-500">
              {isAr ? 'تأكيد مباشر من كتل البلوكشين' : 'Direct block-time verification'}
            </span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-900/90 text-zinc-400">
                <tr>
                  <th className="px-4 py-3">{isAr ? 'الوقت (UTC)' : 'Time (UTC)'}</th>
                  <th className="px-4 py-3">{isAr ? 'البروتوكول' : 'Protocol'}</th>
                  <th className="px-4 py-3">{isAr ? 'العملة المشتراة' : 'Token Bought'}</th>
                  <th className="px-4 py-3">{isAr ? 'العملة المباعة' : 'Token Sold'}</th>
                  <th className="px-4 py-3">{isAr ? 'القيمة بالدولار' : 'Amount USD'}</th>
                  <th className="px-4 py-3">{isAr ? 'التصنيف' : 'Classification'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {whaleTrades.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                      {loading ? (isAr ? 'جاري الاستعلام من Dune…' : 'Querying Dune…') : (isAr ? 'لا توجد صفقات حالياً' : 'No whale trades found')}
                    </td>
                  </tr>
                ) : (
                  whaleTrades.map((trade, i) => {
                    const isAccumulation = !isStable(trade.token_bought_symbol) && isStable(trade.token_sold_symbol);
                    const isDumping = isStable(trade.token_bought_symbol) && !isStable(trade.token_sold_symbol);
                    return (
                      <tr key={i} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-3 font-mono text-[11px] text-zinc-400">{trade.block_time}</td>
                        <td className="px-4 py-3 font-medium capitalize text-zinc-300">{trade.project}</td>
                        <td className="px-4 py-3 font-bold text-emerald-400">{trade.token_bought_symbol}</td>
                        <td className="px-4 py-3 font-medium text-rose-400">{trade.token_sold_symbol}</td>
                        <td className="px-4 py-3 font-mono font-bold text-zinc-100">{formatUsd(trade.amount_usd)}</td>
                        <td className="px-4 py-3">
                          {isAccumulation ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                              <ArrowUpRight size={12} />
                              {isAr ? 'تجميع حوت' : 'Accumulation'}
                            </span>
                          ) : isDumping ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-400">
                              <ArrowDownRight size={12} />
                              {isAr ? 'ضغط بيع' : 'Sell Pressure'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-400">
                              {isAr ? 'تبديل أصول' : 'Asset Swap'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── عرض العملات الأكثر نشاطاً ─── */}
      {view === 'tokens' && (
        <div className="space-y-3">
          <div className="text-xs text-zinc-400">
            {isAr
              ? 'العملات الأكثر تداولاً من حيث حجم السيولة الحقيقية على المنصات اللامركزية خلال آخر 24 ساعة'
              : 'Top traded tokens by aggregate 24-hour USD volume on decentralized exchanges'}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topTokens.map((t, idx) => (
              <div key={idx} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-zinc-500">#{idx + 1}</span>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                    {t.trades.toLocaleString()} {isAr ? 'صفقة' : 'swaps'}
                  </span>
                </div>
                <div className="mt-2 text-lg font-bold text-zinc-100">{t.token_bought_symbol}</div>
                <div className="mt-1 text-sm font-semibold text-orange-400">
                  {formatUsd(t.total_usd)} <span className="text-[11px] font-normal text-zinc-500">{isAr ? 'حجم 24س' : '24h vol'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── محرر استعلامات SQL الفوري ─── */}
      {view === 'sql' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-zinc-400">
              {isAr
                ? 'استعلامات جاهزة أو اكتب أي كود SQL لاستخراج أي داتا من شبكات البلوكشين مباشرة:'
                : 'Select a preset or enter any Trino SQL query to extract live on-chain data:'}
            </span>
            <div className="flex flex-wrap gap-2">
              {PRESET_QUERIES.map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => setCustomSql(preset.sql)}
                  className="rounded-lg border border-zinc-800 bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
                >
                  {isAr ? preset.nameAr : preset.nameEn}
                </button>
              ))}
            </div>
          </div>

          {/* مكتبة الاستعلامات المحفوظة الخاصة بك */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-300">
                <Bookmark size={15} className="text-orange-400" />
                <span>{isAr ? 'مكتبة استعلاماتي الخاصة المحفوظة' : 'My Saved Custom Queries'}</span>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                  {savedQueries.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newQueryName}
                  onChange={(e) => setNewQueryName(e.target.value)}
                  placeholder={isAr ? 'اسم الاستعلام لحفظه…' : 'Query name to save…'}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-orange-500 focus:outline-none"
                />
                <button
                  onClick={saveQueryToLibrary}
                  disabled={!newQueryName.trim()}
                  className="flex items-center gap-1 rounded-lg bg-orange-600/90 px-3 py-1 text-xs font-semibold text-white transition hover:bg-orange-500 disabled:opacity-40"
                >
                  <Bookmark size={12} />
                  {isAr ? 'حفظ الكود الحالي' : 'Save Current'}
                </button>
              </div>
            </div>

            {saveSuccessMsg && (
              <div className="flex items-center gap-1 text-[11px] text-emerald-400">
                <CheckCircle2 size={13} />
                <span>{isAr ? 'تم حفظ الاستعلام بنجاح في مكتبتك المحلية!' : 'Query saved to your local library!'}</span>
              </div>
            )}

            {savedQueries.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {savedQueries.map((q) => (
                  <div
                    key={q.id}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/90 px-2.5 py-1 text-xs text-zinc-200"
                  >
                    <button
                      onClick={() => setCustomSql(q.sql)}
                      className="font-medium hover:text-orange-400 transition"
                      title={isAr ? 'تحميل الاستعلام في المحرر' : 'Load query into editor'}
                    >
                      {q.name}
                    </button>
                    <button
                      onClick={() => deleteSavedQuery(q.id)}
                      className="text-zinc-500 hover:text-rose-400 transition ml-1"
                      title={isAr ? 'حذف من المكتبة' : 'Delete'}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-zinc-500">
                {isAr
                  ? 'يمكنك حفظ أي استعلام SQL مخصص كتبته هنا للوصول إليه بضغطة زر لاحقاً.'
                  : 'You can save any custom SQL query here for one-click access later.'}
              </div>
            )}
          </div>

          <div className="relative">
            <textarea
              rows={6}
              value={customSql}
              onChange={(e) => setCustomSql(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3.5 font-mono text-xs text-zinc-100 placeholder-zinc-500 focus:border-orange-500 focus:outline-none"
              placeholder="SELECT ... FROM dex.trades ..."
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => void handleRunSql()}
              disabled={sqlLoading || available === false}
              className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-orange-600/20 transition hover:bg-orange-500 disabled:opacity-50"
            >
              <Play size={14} className={sqlLoading ? 'animate-spin' : ''} />
              {sqlLoading ? (isAr ? 'جاري التنفيذ على Dune…' : 'Executing on Dune…') : (isAr ? 'تشغيل الاستعلام الآن ⚡' : 'Execute SQL ⚡')}
            </button>

            <div className="flex items-center gap-3">
              {executionTime !== null && (
                <span className="font-mono text-xs text-emerald-400">
                  ⚡ {isAr ? `نُفذ في ${executionTime}ms` : `Executed in ${executionTime}ms`}
                </span>
              )}

              {sqlResults && sqlResults.length > 0 && (
                <button
                  onClick={handleExportCsv}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
                >
                  <Download size={14} />
                  {isAr ? 'تحميل كـ CSV' : 'Export CSV'}
                </button>
              )}
            </div>
          </div>

          {sqlError && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">
              {sqlError}
            </div>
          )}

          {sqlResults && sqlResults.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 max-h-96">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-zinc-800 bg-zinc-900 text-zinc-400">
                  <tr>
                    {Object.keys(sqlResults[0]).map((col) => (
                      <th key={col} className="px-4 py-2.5 font-mono">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-mono text-[11px]">
                  {sqlResults.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-zinc-800/40">
                      {Object.keys(sqlResults[0]).map((col) => (
                        <td key={col} className="px-4 py-2 text-zinc-300 whitespace-nowrap">
                          {row[col] !== null && row[col] !== undefined ? String(row[col]) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
