import { AlertTriangle, ArrowDownRight, ArrowUpRight, Lock, Minus, ShieldAlert, Target, Crosshair } from 'lucide-react';
import type { Signal } from '../api';
import { t, type Lang } from '../i18n';
import type { TKey } from '../i18n';

const TYPE_STYLES: Record<string, { cls: string; ring: string }> = {
  STRONG_BUY: { cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/40', ring: '#10b981' },
  BUY: { cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', ring: '#34d399' },
  HOLD: { cls: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30', ring: '#a1a1aa' },
  NO_TRADE: { cls: 'text-amber-300 bg-amber-500/10 border-amber-500/40', ring: '#f59e0b' },
  SELL: { cls: 'text-rose-300 bg-rose-500/10 border-rose-500/40', ring: '#f43f5e' },
  STRONG_SELL: { cls: 'text-rose-300 bg-rose-500/15 border-rose-500/50', ring: '#e11d48' },
};

const TYPE_KEY: Record<string, TKey> = {
  STRONG_BUY: 'typeStrongBuy',
  BUY: 'typeBuy',
  HOLD: 'typeHold',
  NO_TRADE: 'typeNoTrade',
  SELL: 'typeSell',
  STRONG_SELL: 'typeStrongSell',
};

const GATE_KEYS: Record<string, TKey> = {
  HTF_BLOCKED: 'gateHtf',
  CHOP_BLOCKED: 'gateChop',
  RVOL_BLOCKED: 'gateRvol',
  SQUEEZE_BLOCKED: 'gateSqueeze',
};

const QUALITY_TAG_KEYS: Record<string, TKey> = {
  TREND: 'tagTrend',
  MACD: 'tagMacd',
  RSI: 'tagRsi',
  ADX: 'tagAdx',
  RVOL: 'tagRvol',
  MOMENTUM: 'tagMomentum',
  FUNDING: 'tagFunding',
  BOLLINGER: 'tagBollinger',
  HTF: 'tagHtf',
  SMC: 'tagSmc',
  LIQUIDITY: 'tagLiquidity',
  OI: 'tagOi',
  FNG: 'tagFng',
  WHALE: 'tagWhale',
  PATTERN: 'tagPattern',
};

function fmtUsd(v: number): string {
  return Number.isFinite(v) ? `$${v.toLocaleString('en-US')}` : '—';
}

function ScoreRing({ score, color, lang }: { score: number; color: string; lang: Lang }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const filled = (score / 100) * circumference;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#27272a" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold tabular-nums" style={{ color }}>{score}</span>
        <span className="text-[9px] text-zinc-500">{t(lang, 'qualityOf')} 100</span>
      </div>
    </div>
  );
}

export default function SignalCard({ signal, lang }: { signal: Signal; lang: Lang }) {
  const style = TYPE_STYLES[signal.signalType] ?? TYPE_STYLES.HOLD;
  const typeLabel = t(lang, TYPE_KEY[signal.signalType] ?? 'typeHold');
  const isBuy = signal.spotAction === 'SPOT_BUY';
  const isSell = signal.spotAction === 'SPOT_SELL_ALL';
  const gated = signal.regimeGateStatus !== 'CLEAR';

  // التوصية الصريحة: جملة واحدة كبيرة يفهمها أي حد بدون قراية كود.
  const verdict = gated
    ? { text: t(lang, 'verdictGated'), sub: t(lang, 'verdictGatedSub'), cls: 'border-amber-400/50 bg-amber-400/10 text-amber-300' }
    : isBuy
      ? { text: t(lang, 'verdictBuy'), sub: t(lang, 'verdictBuySub'), cls: 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300' }
      : isSell
        ? { text: t(lang, 'verdictSell'), sub: t(lang, 'verdictSellSub'), cls: 'border-rose-400/50 bg-rose-400/10 text-rose-300' }
        : { text: t(lang, 'verdictHold'), sub: t(lang, 'verdictHoldSub'), cls: 'border-zinc-600/50 bg-zinc-600/10 text-zinc-300' };

  const gateLabel = t(lang, GATE_KEYS[signal.regimeGateStatus] ?? 'gateUnknown');
  const qualityScore = signal.entryQuality ?? signal.convictionScore;
  const qualityBreakdown = signal.qualityBreakdown ?? signal.reasons
    .filter((r) => r.adjustment !== 0)
    .reduce<{ tag: string; adjustment: number }[]>((rows, reason) => {
      const row = rows.find((item) => item.tag === reason.tag);
      if (row) row.adjustment += reason.adjustment;
      else rows.push({ tag: reason.tag, adjustment: reason.adjustment });
      return rows;
    }, []);
  const positiveQuality = qualityBreakdown.filter((item) => item.adjustment > 0).reduce((sum, item) => sum + item.adjustment, 0);
  const negativeQuality = qualityBreakdown.filter((item) => item.adjustment < 0).reduce((sum, item) => sum + Math.abs(item.adjustment), 0);

  return (
    <div className={`rise-in rounded-2xl border bg-zinc-900/60 p-5 ${gated ? 'border-amber-500/30' : 'border-zinc-800'}`}>
      {/* ─── التوصية الصريحة الكبيرة ─── */}
      <div className={`mb-5 flex items-center justify-between rounded-2xl border px-4 py-3 ${verdict.cls}`}>
        <div>
          <div className="text-2xl font-black leading-tight">{verdict.text}</div>
          <div className="text-xs opacity-80">{verdict.sub}</div>
        </div>
        <div className="hidden text-4xl sm:block">{isBuy ? '🟢' : isSell ? '🔴' : gated ? '🟠' : '⚪'}</div>
      </div>

      {/* الترويسة: الدرجة + الأصل + النوع */}
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={signal.convictionScore} color={style.ring} lang={lang} />
        <div className="min-w-40 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-sm font-black text-amber-300" dir="ltr">
              {signal.asset}
            </span>
            <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1 text-sm font-extrabold ${style.cls}`}>
              {typeLabel}
            </div>
            {signal.dailyTrend && (
              <span
                className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold ${
                  signal.dailyTrend === 'BULLISH'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : signal.dailyTrend === 'BEARISH'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                }`}
              >
                {lang === 'ar'
                  ? `يومي: ${signal.dailyTrend === 'BULLISH' ? 'صاعد ↗' : signal.dailyTrend === 'BEARISH' ? 'هابط ↘' : 'محايد ↔'}`
                  : `Daily: ${signal.dailyTrend}`}
              </span>
            )}
          </div>
          <div className="mt-2 text-lg font-extrabold tabular-nums text-zinc-100" dir="ltr">
            {fmtUsd(signal.entryPrice)}
          </div>
          <div className="text-xs text-zinc-500">{signal.summaryAr}</div>
        </div>
        <div className="text-left">
          <div className="text-[10px] text-zinc-500">{t(lang, 'riskReward')}</div>
          <div className="text-xl font-extrabold tabular-nums text-amber-300" dir="ltr">
            {signal.riskRewardRatio || '—'}
          </div>
          <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${signal.dataSource === 'STALE' ? 'text-amber-400' : 'text-emerald-400'}`}>
            {signal.dataSource === 'STALE' ? <AlertTriangle size={10} /> : <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />}
            {signal.dataSource === 'STALE' ? t(lang, 'stale') : t(lang, 'live')}
          </div>
        </div>
      </div>

      {/* تحذير مطاردة السعر */}
      {signal.chaseWarning && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-300">
          <AlertTriangle size={16} className="shrink-0 text-amber-400" />
          <span>
            {lang === 'ar'
              ? 'تحذير مطاردة: السعر مبتعد عن متوسط EMA21 بأكثر من 2×ATR، تجنّب الشراء العشوائي وانتظر تصحيحاً لمنطقة الدخول.'
              : 'Chase Warning: Price is extended > 2×ATR from EMA21. Avoid chasing; wait for a pullback to entry zone.'}
          </span>
        </div>
      )}

      {/* منطقة الدخول الموصى بها */}
      {signal.entryZone && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Crosshair size={13} className="text-sky-400" />
            <span>{lang === 'ar' ? 'منطقة الدخول المثالية (Pullback Zone):' : 'Entry Pullback Zone:'}</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-zinc-200" dir="ltr">
            <span>
              ${signal.entryZone.low.toLocaleString()} – ${signal.entryZone.high.toLocaleString()}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                signal.entryZone.priceInside
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {signal.entryZone.priceInside
                ? (lang === 'ar' ? 'داخل النطاق ✅' : 'Inside Zone ✅')
                : (lang === 'ar' ? 'انتظر التصحيح ⏳' : 'Awaiting Retrace ⏳')}
            </span>
          </div>
        </div>
      )}

      {/* شريط جودة الدخول: تفصيل الدرجة الحالية بدل رقم غامض فقط. */}
      <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-sky-200">{t(lang, 'qualityTitle')}</span>
          <span className="font-mono text-sm font-extrabold text-sky-300" dir="ltr">{qualityScore}/100</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="rounded-lg bg-zinc-950/50 px-2 py-1.5 text-center text-zinc-400">
            <div>{t(lang, 'qualityBase')}</div><b className="font-mono text-zinc-200" dir="ltr">50</b>
          </div>
          <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-center text-emerald-300">
            <div>{t(lang, 'qualityPositive')}</div><b className="font-mono" dir="ltr">+{positiveQuality}</b>
          </div>
          <div className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-center text-rose-300">
            <div>{t(lang, 'qualityNegative')}</div><b className="font-mono" dir="ltr">−{negativeQuality}</b>
          </div>
        </div>
        {qualityBreakdown.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {[...qualityBreakdown].sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment)).map((item) => {
              const positive = item.adjustment > 0;
              const width = Math.min(100, Math.max(8, (Math.abs(item.adjustment) / 18) * 100));
              return (
                <div key={item.tag} className="flex items-center gap-2 text-[10px]">
                  <span className="w-24 shrink-0 truncate text-zinc-400">{t(lang, QUALITY_TAG_KEYS[item.tag] ?? 'factors')}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className={`h-full rounded-full ${positive ? 'bg-emerald-400/80' : 'bg-rose-400/80'}`} style={{ width: `${width}%` }} />
                  </div>
                  <span className={`w-8 text-right font-mono ${positive ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">
                    {positive ? '+' : ''}{item.adjustment}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-2 text-[10px] text-zinc-500">{t(lang, 'qualityNoFactors')}</div>
        )}
        {signal.learningBias ? (
          <div className="mt-2 text-[10px] text-violet-300">{t(lang, 'qualityLearning')}: <span dir="ltr">{signal.learningBias > 0 ? '+' : ''}{signal.learningBias}</span></div>
        ) : null}
      </div>

      {/* لافتة البوابة */}
      {gated && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-200">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <b>{gateLabel}:</b> {signal.blockReasonAr}
            <div className="mt-1 text-[10px] text-amber-200/60">{t(lang, 'gateNote')}</div>
          </div>
        </div>
      )}

      {/* أهداف المخاطرة */}
      {isBuy && !gated && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-rose-300"><ArrowDownRight size={11} /> {t(lang, 'stopLoss')}</div>
            <div className="text-sm font-extrabold tabular-nums text-rose-200" dir="ltr">{fmtUsd(signal.stopLoss)}</div>
          </div>
          {[
            ['TP1', signal.target1, '#34d399'],
            ['TP2', signal.target2, '#10b981'],
            ['TP3', signal.target3, '#059669'],
          ].map(([label, val, color]) => (
            <div key={label as string} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-emerald-300">
                <Target size={11} /> {label as string}
              </div>
              <div className="text-sm font-extrabold tabular-nums" style={{ color: color as string }} dir="ltr">
                {fmtUsd(val as number)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* الأسباب */}
      <details className="mt-4 group">
        <summary className="cursor-pointer list-none text-xs font-bold text-zinc-400 transition hover:text-amber-300">
          <span className="inline-flex items-center gap-1.5">
            <Minus size={12} className="transition-transform group-open:rotate-90" />
            {t(lang, 'why')} ({signal.reasons.length} {t(lang, 'factors')})
          </span>
        </summary>
        <div className="mt-3 space-y-1.5 border-r-2 border-zinc-800 pr-3">
          {signal.reasons.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-300">{r.textAr}</span>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                  r.adjustment > 0 ? 'bg-emerald-500/10 text-emerald-300' : r.adjustment < 0 ? 'bg-rose-500/10 text-rose-300' : 'bg-zinc-800 text-zinc-400'
                }`}
                dir="ltr"
              >
                {r.adjustment > 0 ? '+' : ''}
                {r.adjustment}
              </span>
            </div>
          ))}
        </div>
      </details>

      {/* توقيع المحرك */}
      <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3 text-[9px] text-zinc-600">
        <span className="flex items-center gap-1">
          {signal.htfAvailable ? <ArrowUpRight size={10} className="text-emerald-500" /> : <AlertTriangle size={10} className="text-amber-500" />}
          {signal.htfAvailable ? t(lang, 'htfActive') : t(lang, 'htfMissing')}
        </span>
        <span dir="ltr" className="font-mono">{signal.engineSignature.slice(0, 44)}…</span>
      </div>
      {signal.liquidity && (signal.liquidity.summaryAr || signal.liquidity.summaryEn) && (
        <div className="mt-1.5 text-[9px] text-zinc-600">
          🌐 {lang === 'en' && signal.liquidity.summaryEn ? signal.liquidity.summaryEn : signal.liquidity.summaryAr}
        </div>
      )}
    </div>
  );
}
