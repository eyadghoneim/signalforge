import { useEffect, useState } from 'react';
import { Droplets, ExternalLink, Loader2, Search } from 'lucide-react';
import { api, type DexPairInfo } from '../api';

/** معلومات شرائح DEX الحية من DexScreener — سيولة وحجم تداول خارج البورصات المركزية. */
export default function DexPanel() {
  const [query, setQuery] = useState('BTC');
  const [pairs, setPairs] = useState<DexPairInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.dexPairs(q);
      setPairs(res.pairs ?? []);
      if (!res.pairs?.length) setError('مفيش أزواج بالسيولة الكافية للبحث ده');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPairs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('BTC');
  }, []);

  const fmtUsd = (v: number | null) =>
    v === null ? '—' : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}K` : `$${v.toFixed(2)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
          <Search size={14} className="text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load(query.trim() || 'BTC')}
            placeholder="BTC / ETH / أي زوج"
            className="w-44 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </div>
        <button
          onClick={() => void load(query.trim() || 'BTC')}
          disabled={loading}
          className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-bold text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : 'بحث'}
        </button>
        <span className="text-[11px] text-zinc-500">حسب السيولة — من DexScreener (مصدر إرشادي، مش داخل في التقييم)</span>
      </div>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300">{error}</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {pairs.map((p, i) => (
          <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Droplets size={15} className="text-sky-400" />
                <span className="text-sm font-bold text-zinc-200">{p.dexId}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-400" dir="ltr">
                  {p.chainId}
                </span>
              </div>
              {p.pairUrl && (
                <a href={p.pairUrl} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-amber-300">
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div>
                <div className="text-zinc-500">السعر</div>
                <div className="font-bold tabular-nums text-zinc-100" dir="ltr">{p.priceUsd !== null ? `$${p.priceUsd.toLocaleString('en-US')}` : '—'}</div>
              </div>
              <div>
                <div className="text-zinc-500">السيولة</div>
                <div className="font-bold tabular-nums text-sky-300" dir="ltr">{fmtUsd(p.liquidityUsd)}</div>
              </div>
              <div>
                <div className="text-zinc-500">حجم 24h</div>
                <div className="font-bold tabular-nums text-zinc-300" dir="ltr">{fmtUsd(p.volume24hUsd)}</div>
              </div>
              <div>
                <div className="text-zinc-500">تغير 24h</div>
                <div className={`font-bold tabular-nums ${(p.priceChange24hPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                  {p.priceChange24hPercent !== null ? `${p.priceChange24hPercent > 0 ? '+' : ''}${p.priceChange24hPercent.toFixed(2)}%` : '—'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
