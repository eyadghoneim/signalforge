import { useEffect, useState } from 'react';
import { Database, Download, Play, RefreshCw, Zap, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api, type DuneWhaleTrade, type DuneTopToken } from '../api';
import type { Lang } from '../i18n';

interface Props {
  lang: Lang;
}

type ViewMode = 'whales' | 'tokens' | 'sql';

const PRESET_QUERIES = [
  {
    nameAr: 'صفقات الحيتان الضخمة (> $100k)',
    nameEn: 'Whale Swaps (> $100k)',
    sql: `SELECT
  CAST(block_time AS VARCHAR) as block_time,
  project,
  token_bought_symbol,
  token_sold_symbol,
  round(amount_usd, 2) as amount_usd
FROM dex.trades
WHERE block_time > now() - interval '3' hour
  AND amount_usd >= 100000
ORDER BY block_time DESC
LIMIT 20`,
  },
  {
    nameAr: 'أعلى 10 توكنز حجماً على DEX (آخر 24 ساعة)',
    nameEn: 'Top 10 DEX Tokens (24h Volume)',
    sql: `SELECT
  token_bought_symbol,
  count(*) as trades_count,
  round(sum(amount_usd), 2) as total_usd_volume
FROM dex.trades
WHERE block_time > now() - interval '24' hour
  AND amount_usd >= 10000
  AND token_bought_symbol IS NOT NULL
GROUP BY token_bought_symbol
ORDER BY total_usd_volume DESC
LIMIT 10`,
  },
  {
    nameAr: 'توزيع فوليوم البورصات اللامركزية (Uniswap vs Curve)',
    nameEn: 'DEX Volume Share (Last 24h)',
    sql: `SELECT
  project,
  count(*) as total_swaps,
  round(sum(amount_usd), 2) as total_volume_usd
FROM dex.trades
WHERE block_time > now() - interval '24' hour
  AND amount_usd > 1000
GROUP BY project
ORDER BY total_volume_usd DESC
LIMIT 10`,
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

  const isStable = (sym: string) => ['USDT', 'USDC', 'DAI', 'FDUSD', 'USDbC', 'USD'].includes(sym?.toUpperCase());

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

        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {isAr ? 'تحديث البيانات' : 'Refresh Data'}
        </button>
      </div>

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
