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

function fmtUsd(v: number): string {
  return Number.isFinite(v) ? `$${v.toLocaleString('en-US')}` : '—';
}

function ScoreRing({ score, color }: { score: number; color: string }) {
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
        <span className="text-[9px] text-zinc-500">{t('ar', 'factors') === 'عامل' ? 'من 100' : 'of 100'}</span>
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

      {/* الترويسة: الدرجة + النوع */}
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={signal.convictionScore} color={style.ring} />
        <div className="min-w-40 flex-1">
          <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-extrabold ${style.cls}`}>
            {typeLabel}
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
