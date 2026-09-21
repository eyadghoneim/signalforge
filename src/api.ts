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
  PaperTradeOutcome,
  ProtectionConfig,
  TagLearningStat,
  LearningLesson,
  MonteCarloResult,
  MonteCarloPercentiles,
  PerformanceStats,
  ElliottWaveAnalysis,
  MacroCalendarResponse,
  MacroEvent,
  OrderBookDepth,
  OrderBookTier,
  OrderBookWall,
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
  PaperTradeOutcome,
  ProtectionConfig,
  TagLearningStat,
  LearningLesson,
  MonteCarloResult,
  MonteCarloPercentiles,
  PerformanceStats,
  ElliottWaveAnalysis,
  MacroCalendarResponse,
  MacroEvent,
  OrderBookDepth,
  OrderBookTier,
  OrderBookWall,
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
  persistence?: 'postgres' | 'local_json';
  lastScanAt: number;
  uptimeSec: number;
  protection?: {
    breakerTripped: boolean;
    dailyRealizedR: number;
    dailyLossLimitR: number;
    openSignals: number;
    effectiveExposure: number;
    maxConcurrentSignals: number;
    choppyCooldown?: {
      active: boolean;
      consecutiveLosses: number;
      cooldownUntil: number | null;
    };
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
  paperAlertsEnabled: boolean;
  paperEnginePaused: boolean;
  telegramLang: 'ar' | 'en';
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

export interface PaperPositionInfo {
  id: string;
  asset: SupportedAsset;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  qty: number;
  qtyOpen: number;
  feesPaid?: number;
  pnlAccum: number;
  openedAtSec: number;
  tp1Taken: boolean;
  tp2Taken: boolean;
}

export interface PaperTradeInfo {
  id: string;
  asset: SupportedAsset;
  openedAt: number;
  closedAt: number;
  entry: number;
  exitAvg: number;
  qty: number;
  pnlUsd: number;
  feesUsd?: number;
  reason: 'TP3' | 'SL' | 'SELL_SIGNAL' | 'TIME';
  outcome?: PaperTradeOutcome;
}

export interface PaperAccountInfo {
  paused?: boolean;
  startingEquity: number;
  cash: number;
  realizedPnl: number;
  open: PaperPositionInfo[];
  closed: PaperTradeInfo[];
  equityCurve: { time: number; equity: number }[];
  updatedAt: number;
}

export interface LiquidationEventInfo {
  time: number;
  posSide: 'long' | 'short';
  side: 'buy' | 'sell';
  price: number;
  sizeUsd: number;
}

export interface LiquidationRadar {
  asset: SupportedAsset;
  longCount: number;
  shortCount: number;
  longSizeUsd: number;
  shortSizeUsd: number;
  tilt: number;
  events: LiquidationEventInfo[];
  source: string;
  noteAr: string;
}

export interface DexPairInfo {
  chainId: string;
  dexId: string;
  pairUrl: string;
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPercent: number | null;
}

export interface DuneAssetMetric {
  asset: SupportedAsset;
  blockchain: string;
  volume24hUsd: number;
  tradeCount: number;
  whaleTradeCount: number;
  whaleVolume24hUsd: number;
  largestTradeUsd: number | null;
}

export interface DuneInfo {
  ok: boolean;
  enabled: boolean;
  source: 'DUNE';
  windowHours?: number;
  fetchedAt: number | null;
  assets?: DuneAssetMetric[];
  noteAr?: string;
  noteEn?: string;
  error?: string;
}

export interface DuneWhaleTrade {
  block_time: string;
  project: string;
  token_bought_symbol: string;
  token_sold_symbol: string;
  amount_usd: number;
}

export interface DuneTopToken {
  token_bought_symbol: string;
  trades: number;
  total_usd: number;
}

export interface DailyReportData {
  ok: boolean;
  generatedAt: string;
  timestamp: number;
  engine: {
    signature: string;
    version: string;
    breakerTripped: boolean;
    protection: ProtectionConfig;
  };
  market: {
    fearAndGreed: { value: number; classification: string } | null;
    duneConnected: boolean;
  };
  signals: {
    asset: SupportedAsset;
    labelAr: string;
    signalType: string;
    spotAction: string;
    convictionScore: number | null;
    entryPrice: number | null;
    stopLoss: number | null;
    target1: number | null;
    target2: number | null;
    target3: number | null;
    regimeGateStatus: string;
    reasons: string[];
    generatedAt: number | null;
  }[];
  paperTrading: {
    initialBalance: number;
    cash: number;
    equity: number;
    totalRealizedPnlUsd: number;
    winRatePercent: number;
    openPositionsCount: number;
    closedTradesCount: number;
    openPositions: PaperAccountInfo['open'];
    recentClosedTrades: PaperAccountInfo['closed'];
  };
  recentMegaWhaleSwaps: DuneWhaleTrade[];
}

const ADMIN_TOKEN_KEY = 'sf_admin_token';

export function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  if (token.trim()) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token.trim());
  } else {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(token ? { 'x-bot-admin-token': token } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, {
    ...init,
    headers,
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
    paperAlertsEnabled?: boolean;
    telegramLang?: 'ar' | 'en';
    gates?: { htf: boolean; chop: boolean; rvol: boolean; funding: boolean };
    protection?: Partial<ProtectionConfig>;
  }) => j<{ ok: true }>('/api/config', { method: 'POST', body: JSON.stringify(body) }),
  telegramTest: () => j<{ ok: boolean; error?: string }>('/api/telegram/test', { method: 'POST', body: '{}' }),
  liquidity: () => j<{ ok: true; regime: LiquidityRegime }>('/api/liquidity-regime'),
  dune: async (): Promise<DuneInfo> => {
    const res = await fetch('/api/dune', { headers: { 'content-type': 'application/json' } });
    return (await res.json()) as DuneInfo;
  },
  duneStatus: () => j<{ ok: true; available: boolean; tier: string; researchOnly: true }>('/api/dune/status'),
  duneWhaleTrades: () => j<{ ok: true; available: true; trades: DuneWhaleTrade[] }>('/api/dune/whale-trades'),
  duneTopTokens: () => j<{ ok: true; available: true; tokens: DuneTopToken[] }>('/api/dune/top-tokens'),
  duneRunSql: (sql: string) =>
    j<{ ok: true; rows: Record<string, unknown>[]; executionTimeMs: number; researchOnly: true }>('/api/dune/sql', {
      method: 'POST',
      body: JSON.stringify({ sql }),
    }),
  dexPairs: (q: string) => j<{ ok: true; pairs: DexPairInfo[] }>(`/api/dex/pairs?asset=${encodeURIComponent(q)}`),
  providers: () => j<{ ok: true; providers: ProviderHealthInfo[] }>('/api/providers'),
  paper: () => j<{
    ok: true;
    account: PaperAccountInfo;
    initialEquity: number;
    execution?: { feeRate: number; slippageRate: number; mode: string };
  }>('/api/paper'),
  resetPaper: () => j<{ ok: true }>('/api/paper/reset', { method: 'POST', body: '{}' }),
  liquidations: (asset: SupportedAsset) => j<{ ok: true; radar: LiquidationRadar | null }>(`/api/liquidations/${asset}`),
  dailyReport: () => j<DailyReportData>('/api/report/daily'),
  macroCalendar: () => j<{ ok: true } & MacroCalendarResponse>('/api/market/macro-events'),
  depth: (asset: SupportedAsset) => j<{ ok: true; depth: OrderBookDepth }>(`/api/market/depth?asset=${asset}`),
  elliott: (asset: SupportedAsset) => j<{ ok: true; analysis: ElliottWaveAnalysis }>(`/api/market/elliott?asset=${asset}`),
  backtest: (asset: SupportedAsset, days = 365, robustness = false, walkForward = false) =>
    j<{ ok: true; result?: BacktestResult; robustness?: RobustnessCell[]; walkforward?: WalkForwardResult }>('/api/backtest', {
      method: 'POST',
      body: JSON.stringify({ asset, days, robustness, walkforward: walkForward }),
    }),
};
