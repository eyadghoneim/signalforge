// عميل API — أنواع مشتركة من shared/types (مصدر واحد للحقيقة)
import type {
  Signal,
  StoredSignal,
  SupportedAsset,
  Candle,
  AttributionSummary,
  BacktestResult,
  RobustnessCell,
  WalkForwardCell,
  WalkForwardResult,
  LiquidityRegime,
  ProviderHealthInfo,
  ProtectionConfig,
  TagLearningStat,
  LearningLesson,
} from '../shared/types';

export type {
  Signal,
  StoredSignal,
  SupportedAsset,
  Candle,
  AttributionSummary,
  BacktestResult,
  RobustnessCell,
  WalkForwardCell,
  WalkForwardResult,
  LiquidityRegime,
  ProviderHealthInfo,
  ProtectionConfig,
  TagLearningStat,
  LearningLesson,
};

export interface TickerSummary {
  asset: SupportedAsset;
  labelAr: string;
  ok: boolean;
  price?: number;
  change24h?: number;
  source?: string;
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  engineSignature: string;
  lastScanAt: number;
  uptimeSec: number;
  protection?: {
    breakerTripped: boolean;
    dailyRealizedR: number;
    dailyLossLimitR: number;
    openSignals: number;
    effectiveExposure: number;
    maxConcurrentSignals: number;
  };
}

export interface ConfigInfo {
  scanIntervalSeconds: number;
  telegramEnabled: boolean;
  telegramTokenMasked: string;
  telegramChatId: string;
  hasTelegramToken: boolean;
  hasChatId: boolean;
  gates: { htf: boolean; chop: boolean; rvol: boolean; funding: boolean };
  adminRequired: boolean;
  regimeEnabled: boolean;
  digestEnabled: boolean;
  protection: ProtectionConfig;
}

export interface LearningInfo {
  ok: true;
  baselineWinRatePercent: number;
  totalResolved: number;
  perTag: TagLearningStat[];
  biases: Record<string, number>;
  lessons: LearningLesson[];
}
export interface BotLogEntry {
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  at: number;
}

export interface DexPairInfo {
  chainId: string;
  dexId: string;
  pairUrl: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPercent: number | null;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const json = (await res.json().catch(() => ({ ok: false, error: `رد غير صالح (HTTP ${res.status})` }))) as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new Error(String(json.error || `HTTP ${res.status}`));
  }
  return json as T;
}

export const api = {
  health: () => j<HealthInfo>('/api/health'),
  summary: () => j<{ ok: true; assets: TickerSummary[] }>('/api/market/summary'),
  klines: (asset: SupportedAsset, interval: '1h' | '4h', limit = 300) =>
    j<{ ok: true; candles: Candle[] }>(`/api/market/klines?asset=${asset}&interval=${interval}&limit=${limit}`),
  signal: (asset: SupportedAsset) => j<{ ok: true; signal: Signal }>(`/api/signal/${asset}`),
  signals: (limit = 60) => j<{ ok: true; signals: StoredSignal[] }>(`/api/signals?limit=${limit}`),
  attribution: () => j<{ ok: true; summary: AttributionSummary }>('/api/attribution/summary'),
  learning: () => j<LearningInfo>('/api/learning'),
  logs: () => j<{ ok: true; logs: BotLogEntry[] }>('/api/logs'),
  config: () => j<{ ok: true; config: ConfigInfo }>('/api/config'),
  saveConfig: (body: {
    scanIntervalSeconds?: number;
    telegramEnabled?: boolean;
    telegramToken?: string;
    telegramChatId?: string;
    regimeEnabled?: boolean;
    digestEnabled?: boolean;
    gates?: { htf: boolean; chop: boolean; rvol: boolean; funding: boolean };
    protection?: Partial<ProtectionConfig>;
  }) => j<{ ok: true }>('/api/config', { method: 'POST', body: JSON.stringify(body) }),
  telegramTest: () => j<{ ok: boolean; error?: string }>('/api/telegram/test', { method: 'POST', body: '{}' }),
  liquidity: () => j<{ ok: true; regime: LiquidityRegime }>('/api/liquidity-regime'),
  dexPairs: (q: string) => j<{ ok: true; pairs: DexPairInfo[] }>(`/api/dex/pairs?asset=${encodeURIComponent(q)}`),
  providers: () => j<{ ok: true; providers: ProviderHealthInfo[] }>('/api/providers'),
  backtest: (asset: SupportedAsset, days = 365, robustness = false, walkForward = false) =>
    j<{ ok: true; result?: BacktestResult; robustness?: RobustnessCell[]; walkforward?: WalkForwardResult }>('/api/backtest', {
      method: 'POST',
      body: JSON.stringify({ asset, days, robustness, walkforward: walkForward }),
    }),
};
