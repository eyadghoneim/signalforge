import { AlertTriangle, ArrowDownRight, ArrowUpRight, Lock, Minus, ShieldAlert, Target, Crosshair } from 'lucide-react';
import type { Signal } from '../api';

const TYPE_STYLES: Record<string, { label: string; cls: string; ring: string }> = {
  STRONG_BUY: { label: '🚀 شراء قوي', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/40', ring: '#10b981' },
  BUY: { label: '📈 شراء', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', ring: '#34d399' },
  HOLD: { label: '⏳ انتظار', cls: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30', ring: '#a1a1aa' },
  NO_TRADE: { label: '🛡️ ممنوع الدخول', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/40', ring: '#f59e0b' },
  SELL: { label: '📉 بيع', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/40', ring: '#f43f5e' },
  STRONG_SELL: { label: '🛑 بيع قوي', cls: 'text-rose-300 bg-rose-500/15 border-rose-500/50', ring: '#e11d48' },
};

const GATE_LABELS: Record<string, string> = {
  HTF_BLOCKED: 'بوابة الفريم الأكبر (4h)',
  CHOP_BLOCKED: 'بوابة السوق العرضي (ADX)',
  RVOL_BLOCKED: 'بوابة الفوليوم الضعيف',
  SQUEEZE_BLOCKED: 'بوابة تمويل العقود',
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
        <span className="text-[9px] text-zinc-500">من 100</span>
      </div>
    </div>
  );
}

export default function SignalCard({ signal }: { signal: Signal }) {
  const style = TYPE_STYLES[signal.signalType] ?? TYPE_STYLES.HOLD;
  const isBuy = signal.spotAction === 'SPOT_BUY';
  const isSell = signal.spotAction === 'SPOT_SELL_ALL';
  const gated = signal.regimeGateStatus !== 'CLEAR';

  return (
    <div className={`rise-in rounded-2xl border bg-zinc-900/60 p-5 ${gated ? 'border-amber-500/30' : 'border-zinc-800'}`}>
      {/* الترويسة: الدرجة + النوع */}
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={signal.convictionScore} color={style.ring} />
        <div className="min-w-40 flex-1">
          <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-extrabold ${style.cls}`}>
            {style.label}
          </div>
          <div className="mt-2 text-lg font-extrabold tabular-nums text-zinc-100" dir="ltr">
            {fmtUsd(signal.entryPrice)}
          </div>
          <div className="text-xs text-zinc-500">{signal.summaryAr}</div>
        </div>
        <div className="text-left">
          <div className="text-[10px] text-zinc-500">مخاطرة/عائد</div>
          <div className="text-xl font-extrabold tabular-nums text-amber-300" dir="ltr">
            {signal.riskRewardRatio || '—'}
          </div>
          <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${signal.dataSource === 'STALE' ? 'text-amber-400' : 'text-emerald-400'}`}>
            {signal.dataSource === 'STALE' ? <AlertTriangle size={10} /> : <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />}
            بيانات {signal.dataSource === 'STALE' ? 'متأخرة' : 'حيّة'}
          </div>
        </div>
      </div>

      {/* لافتة البوابة */}
      {gated && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-200">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <b>{GATE_LABELS[signal.regimeGateStatus] ?? signal.regimeGateStatus}:</b> {signal.blockReasonAr}
            <div className="mt-1 text-[10px] text-amber-200/60">الإشارة محفوظة للتدقيق — هنعرف بعدين لو البوابة منعت خسارة أو منعت ربح.</div>
          </div>
        </div>
      )}

      {/* أهداف المخاطرة */}
      {(isBuy || isSell) && !gated && isBuy && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-rose-300"><ArrowDownRight size={11} /> وقف الخسارة</div>
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
            ليه الإشارة دي؟ ({signal.reasons.length} عامل)
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
          {signal.htfAvailable ? 'بوابة 4h نشطة' : 'بيانات 4h غير متاحة — البوابة معطلة بصراحة'}
        </span>
        <span dir="ltr" className="font-mono">{signal.engineSignature.slice(0, 44)}…</span>
      </div>
      {signal.liquidity && signal.liquidity.summaryAr && (
        <div className="mt-1.5 text-[9px] text-zinc-600">🌐 {signal.liquidity.summaryAr}</div>
      )}
    </div>
  );
}
