import { useEffect, useState } from 'react';
import { FileText, Download, Printer, X, Shield, Activity, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, type DailyReportData } from '../api';
import type { Lang } from '../i18n';

interface Props {
  lang: Lang;
  isOpen: boolean;
  onClose: () => void;
}

export default function DailyReportModal({ lang, isOpen, onClose }: Props) {
  const isAr = lang === 'ar';
  const [data, setData] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    api.dailyReport()
      .then((res) => setData(res))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDownloadJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SignalForge_Daily_Report_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadCsv = () => {
    if (!data) return;
    const rows = [
      ['Asset', 'Signal Type', 'Spot Action', 'Score', 'Entry Price', 'Stop Loss', 'TP1', 'Regime Gate'],
      ...data.signals.map((s) => [
        s.asset,
        s.signalType,
        s.spotAction,
        String(s.convictionScore ?? '—'),
        String(s.entryPrice ?? '—'),
        String(s.stopLoss ?? '—'),
        String(s.target1 ?? '—'),
        s.regimeGateStatus,
      ]),
    ];
    const sanitizeCsvCell = (val: string) => {
      let clean = val.replace(/"/g, '""');
      if (/^[=\-+@\t\r]/.test(clean)) clean = `'${clean}`;
      return clean;
    };
    const csv = rows.map((r) => r.map((c) => `"${sanitizeCsvCell(c)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SignalForge_Signals_Summary_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm print:p-0 print:bg-white print:text-black">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-h-none">
        {/* شريط العنوان */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-6 py-4 print:border-b-2 print:border-zinc-300">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-400">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100 print:text-black">
                {isAr ? 'التقرير اليومي الشامل — SignalForge Terminal' : 'SignalForge Daily Terminal Report'}
              </h2>
              <p className="text-xs text-zinc-400 print:text-zinc-600">
                {data ? new Date(data.generatedAt).toLocaleString(isAr ? 'ar-EG' : 'en-US') : '…'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {data && (
              <>
                <button
                  onClick={handleDownloadJson}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
                >
                  <Download size={13} />
                  JSON
                </button>
                <button
                  onClick={handleDownloadCsv}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
                >
                  <Download size={13} />
                  CSV
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/30"
                >
                  <Printer size={13} />
                  {isAr ? 'طباعة / PDF' : 'Print / PDF'}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* جسم التقرير */}
        <div className="overflow-y-auto p-6 space-y-6 text-xs text-zinc-300 print:text-black">
          {loading && (
            <div className="py-12 text-center text-zinc-400">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <div className="mt-2">{isAr ? 'جاري تجميع التقرير المباشر…' : 'Compiling live report…'}</div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300">
              {error}
            </div>
          )}

          {data && (
            <>
              {/* المؤشرات العامة والسياق */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 print:border-zinc-300">
                  <div className="text-[10px] text-zinc-500 print:text-zinc-600">{isAr ? 'محرك الإشارات' : 'Engine Signature'}</div>
                  <div className="mt-1 font-mono font-bold text-amber-400 print:text-black">v{data.engine.version}</div>
                  <div className="text-[10px] text-zinc-400">{data.engine.signature}</div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 print:border-zinc-300">
                  <div className="text-[10px] text-zinc-500 print:text-zinc-600">{isAr ? 'مؤشر الخوف والجشع' : 'Fear & Greed'}</div>
                  <div className="mt-1 font-bold text-zinc-100 print:text-black">
                    {data.market.fearAndGreed ? `${data.market.fearAndGreed.value} / 100` : '—'}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    {data.market.fearAndGreed?.classification ?? '—'}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 print:border-zinc-300">
                  <div className="text-[10px] text-zinc-500 print:text-zinc-600">{isAr ? 'ربح المحفظة الورقية' : 'Paper Total PnL'}</div>
                  <div className={`mt-1 font-mono font-bold ${data.paperTrading.totalRealizedPnlUsd >= 0 ? 'text-emerald-400 print:text-emerald-700' : 'text-rose-400 print:text-rose-700'}`}>
                    {data.paperTrading.totalRealizedPnlUsd >= 0 ? '+' : ''}${data.paperTrading.totalRealizedPnlUsd.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    {isAr ? `نسبة الفوز: ${data.paperTrading.winRatePercent}%` : `Win Rate: ${data.paperTrading.winRatePercent}%`}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 print:border-zinc-300">
                  <div className="text-[10px] text-zinc-500 print:text-zinc-600">{isAr ? 'قاطع الدائرة (Circuit Breaker)' : 'Circuit Breaker'}</div>
                  <div className="mt-1 flex items-center gap-1 font-bold">
                    {data.engine.breakerTripped ? (
                      <span className="text-rose-400">⚠️ {isAr ? 'مفعل (وقف الشراء)' : 'Tripped (Paused)'}</span>
                    ) : (
                      <span className="text-emerald-400">✅ {isAr ? 'سليم ونشط' : 'Clear & Active'}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    {data.market.duneConnected ? 'Dune On-chain Online' : 'Dune Standby'}
                  </div>
                </div>
              </div>

              {/* جدول الإشارات الحالية للأصول */}
              <div className="space-y-2">
                <h3 className="font-bold text-zinc-200 print:text-black">
                  {isAr ? '1. حالة الإشارات ونقاط الدخول والخروج' : '1. Asset Signals & Execution Levels'}
                </h3>
                <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40 print:border-zinc-300">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-800 bg-zinc-900 text-zinc-400 print:border-zinc-300 print:text-black">
                      <tr>
                        <th className="px-3 py-2">{isAr ? 'الأصل' : 'Asset'}</th>
                        <th className="px-3 py-2">{isAr ? 'التوصية' : 'Signal'}</th>
                        <th className="px-3 py-2">{isAr ? 'النقاط' : 'Score'}</th>
                        <th className="px-3 py-2">{isAr ? 'سعر الدخول' : 'Entry'}</th>
                        <th className="px-3 py-2">{isAr ? 'وقف الخسارة' : 'Stop Loss'}</th>
                        <th className="px-3 py-2">{isAr ? 'الهدف الأول' : 'TP 1'}</th>
                        <th className="px-3 py-2">{isAr ? 'البوابات' : 'Gates'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 print:divide-zinc-200">
                      {data.signals.map((s) => (
                        <tr key={s.asset} className="hover:bg-zinc-800/30">
                          <td className="px-3 py-2 font-bold text-zinc-200 print:text-black">
                            {s.asset} <span className="text-[10px] font-normal text-zinc-500">({s.labelAr})</span>
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] ${
                                s.spotAction === 'SPOT_BUY'
                                  ? 'bg-emerald-500/20 text-emerald-300 print:text-emerald-700'
                                  : s.spotAction === 'SPOT_SELL_ALL'
                                  ? 'bg-rose-500/20 text-rose-300 print:text-rose-700'
                                  : 'bg-zinc-800 text-zinc-400 print:text-zinc-600'
                              }`}
                            >
                              {s.spotAction}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono">{s.convictionScore ?? '—'}</td>
                          <td className="px-3 py-2 font-mono" dir="ltr">{s.entryPrice ? `$${s.entryPrice.toLocaleString()}` : '—'}</td>
                          <td className="px-3 py-2 font-mono text-rose-400 print:text-rose-700" dir="ltr">{s.stopLoss ? `$${s.stopLoss.toLocaleString()}` : '—'}</td>
                          <td className="px-3 py-2 font-mono text-emerald-400 print:text-emerald-700" dir="ltr">{s.target1 ? `$${s.target1.toLocaleString()}` : '—'}</td>
                          <td className="px-3 py-2">
                            <span className={s.regimeGateStatus === 'CLEAR' ? 'text-emerald-400' : 'text-amber-400'}>
                              {s.regimeGateStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* المحفظة الورقية */}
              <div className="space-y-2">
                <h3 className="font-bold text-zinc-200 print:text-black">
                  {isAr ? '2. تفاصيل المحفظة الورقية الحية' : '2. Paper Portfolio Snapshot'}
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 print:border-zinc-300">
                  <div>
                    <span className="text-zinc-500">{isAr ? 'الرصيد الكلي' : 'Total Equity'}</span>
                    <p className="font-mono font-bold text-zinc-100 print:text-black">${data.paperTrading.equity.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">{isAr ? 'الكاش المتاح' : 'Available Cash'}</span>
                    <p className="font-mono font-bold text-zinc-100 print:text-black">${data.paperTrading.cash.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">{isAr ? 'المراكز المفتوحة' : 'Open Positions'}</span>
                    <p className="font-mono font-bold text-zinc-100 print:text-black">{data.paperTrading.openPositionsCount}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">{isAr ? 'الصفقات المكتملة' : 'Closed Trades'}</span>
                    <p className="font-mono font-bold text-zinc-100 print:text-black">{data.paperTrading.closedTradesCount}</p>
                  </div>
                </div>
              </div>

              {/* صفقات الحيتان المرصودة */}
              {data.recentMegaWhaleSwaps.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-bold text-zinc-200 print:text-black">
                    {isAr ? '3. أحدث صفقات الحيتان على البلوكشين (Dune Verified)' : '3. Recent Mega Whale Swaps (Dune Verified)'}
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40 print:border-zinc-300">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-zinc-800 bg-zinc-900 text-zinc-400 print:border-zinc-300 print:text-black">
                        <tr>
                          <th className="px-3 py-2">{isAr ? 'الوقت' : 'Time'}</th>
                          <th className="px-3 py-2">{isAr ? 'البروتوكول' : 'Protocol'}</th>
                          <th className="px-3 py-2">{isAr ? 'شراء' : 'Bought'}</th>
                          <th className="px-3 py-2">{isAr ? 'بيع' : 'Sold'}</th>
                          <th className="px-3 py-2">{isAr ? 'القيمة USD' : 'Amount USD'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 print:divide-zinc-200">
                        {data.recentMegaWhaleSwaps.map((w, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-400">{w.block_time}</td>
                            <td className="px-3 py-1.5 capitalize">{w.project}</td>
                            <td className="px-3 py-1.5 font-bold text-emerald-400 print:text-emerald-700">{w.token_bought_symbol}</td>
                            <td className="px-3 py-1.5 font-medium text-rose-400 print:text-rose-700">{w.token_sold_symbol}</td>
                            <td className="px-3 py-1.5 font-mono font-bold" dir="ltr">${Math.round(w.amount_usd).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
