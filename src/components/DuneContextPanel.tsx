import { Database, ExternalLink, ShieldAlert } from 'lucide-react';
import type { DuneInfo } from '../api';
import { t, type Lang } from '../i18n';

function compactUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
}

export default function DuneContextPanel({ data, lang }: { data: DuneInfo | null; lang: Lang }) {
  if (!data) return null;

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-zinc-900/60 p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold text-zinc-300">
        <Database size={16} className="text-cyan-400" />
        {t(lang, 'duneTitle')}
        <span className="mr-auto rounded-full border border-cyan-500/30 px-2 py-0.5 text-[9px] font-normal text-cyan-300">DUNE</span>
      </div>
      <p className="mb-3 text-[10px] leading-4 text-zinc-500">{t(lang, 'duneDesc')}</p>

      {!data.enabled ? (
        <div className="flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-[10px] text-zinc-500">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-zinc-600" />
          <span>{t(lang, 'duneDisabled')}</span>
        </div>
      ) : !data.ok ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[10px] leading-4 text-amber-200/80">
          {t(lang, 'duneError')}: {data.error || '—'}
        </div>
      ) : data.assets && data.assets.length > 0 ? (
        <div className="space-y-2">
          {data.assets.map((item) => (
            <div key={`${item.asset}-${item.blockchain}`} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-extrabold text-zinc-200" dir="ltr">{item.asset}</span>
                <span className="text-[9px] text-zinc-600" dir="ltr">{item.blockchain}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[9px]">
                <div>
                  <div className="text-zinc-600">{t(lang, 'duneVolume')}</div>
                  <div className="font-mono text-cyan-300" dir="ltr">{compactUsd(item.volume24hUsd)}</div>
                </div>
                <div>
                  <div className="text-zinc-600">{t(lang, 'duneWhale')}</div>
                  <div className="font-mono text-amber-300" dir="ltr">{compactUsd(item.whaleVolume24hUsd)}</div>
                </div>
                <div>
                  <div className="text-zinc-600">{t(lang, 'duneTrades')}</div>
                  <div className="font-mono text-zinc-300" dir="ltr">{item.tradeCount.toLocaleString('en-US')}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-zinc-500">{t(lang, 'duneNoData')}</div>
      )}

      {data.ok && (
        <div className="mt-3 border-t border-zinc-800 pt-2 text-[9px] leading-4 text-zinc-600">
          {t(lang, 'duneResearchNote')}
          {data.fetchedAt ? ` · ${new Date(data.fetchedAt).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US')}` : ''}
          <a className="mr-1 inline-flex text-cyan-400/70 hover:text-cyan-300" href="https://dune.com" target="_blank" rel="noreferrer" aria-label="Dune">
            <ExternalLink size={10} />
          </a>
        </div>
      )}
    </div>
  );
}
