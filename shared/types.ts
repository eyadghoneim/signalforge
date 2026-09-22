// أنواع مشتركة بين السيرفر والواجهة — مصدر واحد للحقيقة
export type SupportedAsset = 'BTC' | 'ETH' | 'PAXG' | 'SOL';
export const SUPPORTED_ASSETS: SupportedAsset[] = ['BTC', 'ETH', 'PAXG', 'SOL'];

export const ASSET_LABELS_AR: Record<SupportedAsset, string> = {
  BTC: 'البيتكوين',
  ETH: 'الإيثريوم',
  PAXG: 'الذهب الرقمي (PAXG)',
  SOL: 'سولانا',
};

export interface Candle {
  time: number; // epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type RegimeGateStatus =
  | 'CLEAR'
  | 'HTF_BLOCKED'
  | 'CHOP_BLOCKED'
  | 'RVOL_BLOCKED'
  | 'SQUEEZE_BLOCKED';

export type SignalType = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' | 'NO_TRADE';
export type SpotAction = 'SPOT_BUY' | 'SPOT_HOLD' | 'SPOT_SELL_ALL';

export type ReasonTag =
  | 'TREND'
  | 'MACD'
  | 'RSI'
  | 'ADX'
  | 'RVOL'
  | 'MOMENTUM'
  | 'FUNDING'
  | 'BOLLINGER'
  | 'HTF'
  | 'SMC'
  | 'LIQUIDITY'
  | 'OI'
  | 'FNG'
  | 'WHALE'
  | 'PATTERN';

export interface SignalReason {
  tag: ReasonTag;
  adjustment: number;
  textAr: string;
}

/** Aggregated deterministic contribution shown in the entry-quality panel. */
export interface SignalQualityComponent {
  tag: ReasonTag;
  adjustment: number;
}

export interface Signal {
  asset: SupportedAsset;
  engineSignature: string;
  convictionScore: number;
  /** Same 0..100 deterministic score, named explicitly for the UI quality panel. */
  entryQuality?: number;
  qualityBreakdown?: SignalQualityComponent[];
  signalType: SignalType;
  spotAction: SpotAction;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskRewardRatio: number;
  regimeGateStatus: RegimeGateStatus;
  blockReasonAr?: string;
  reasons: SignalReason[];
  summaryAr: string;
  generatedAt: number;
  dedupHash: string;
  dataSource: 'LIVE' | 'STALE';
  learningBias?: number;
  htfAvailable: boolean;
  // ─── إضافات v2.0 ───
  entryZone?: { low: number; high: number; basisAr: string; priceInside: boolean } | null;
  chaseWarning?: boolean;
  smc?: SmcSnapshot | null;
  liquidity?: { adjustment: number; verdict: string; summaryAr: string; summaryEn?: string } | null;
  dailyTrend?: 'BULLISH' | 'BEARISH' | 'UNKNOWN';
}

export type AttributionWindow = 'h4' | 'h24' | 'h72';

export interface WindowOutcome {
  mfePercent: number; // أقصى صعود لصالحنا
  maePercent: number; // أقصى تراجع ضدنا (سالب)
  hitTp1BeforeSl: boolean | null; // null = لم يُحسم داخل النافذة أو غامض
}

export interface SignalOutcomes {
  windows: Record<AttributionWindow, WindowOutcome>;
  resolution: 'TP1_FIRST' | 'SL_FIRST' | 'OPEN' | 'EXPIRED';
  resolvedAt?: number;
}

export interface StoredSignal extends Signal {
  id: string;
  isGateBlocked: boolean;
  telegramSent: boolean;
  outcomes: SignalOutcomes;
}

export interface BotConfig {
  scanIntervalSeconds: number;
  telegramEnabled: boolean;
  telegramToken: string;
  telegramChatId: string;
  gates: { htf: boolean; chop: boolean; rvol: boolean; funding: boolean };
  adminToken: string;
  regimeEnabled: boolean;
  protection: ProtectionConfig;
  digestEnabled: boolean;
  paperAlertsEnabled: boolean;
  telegramLang: 'ar' | 'en';
  paperEnginePaused: boolean;
}

// ─── تقارير الأداء والباك تست (مشتركة بين السيرفر والواجهة) ───

export interface TagStat {
  tag: string;
  wins: number;
  losses: number;
  total: number;
  winRatePercent: number | null;
}

export interface AttributionSummary {
  actionableSignals: number;
  resolved: number;
  tp1First: number;
  slFirst: number;
  expired: number;
  winRatePercent: number | null;
  avgMfePercent: number | null;
  avgMaePercent: number | null;
  perTag: TagStat[];
  noteAr: string;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  entry: number;
  exitAvgPrice: number;
  qty: number;
  pnlUsd: number;
  exitReason: 'SL' | 'TP1_SL' | 'TP2_SL' | 'TP3' | 'SELL_SIGNAL' | 'END';
  signalScore: number;
}

/** تعريف موحّد واحد لمئينات مونتي كارلو — كان معرّفاً مرتين بأشكال مختلفة سابقاً. */
export interface MonteCarloPercentiles {
  p5: number;
  p50: number;
  p95: number;
  worst: number;
  best: number;
}

export interface MonteCarloStats {
  simulations: number;
  seed: number;
  bestMaxDrawdownPercent: number;
  worstMaxDrawdownPercent: number;
  maxDrawdownPercentiles: MonteCarloPercentiles;
  minimumEquityPercentiles: MonteCarloPercentiles;
  capitalDipProbabilityPercent: number;
}

export interface BacktestResult {
  asset: SupportedAsset;
  period: { from: number; to: number; candles: number };
  startEquity: number;
  finalEquity: number;
  buyHoldFinal: number;
  totalTrades: number;
  wins: number;
  winRatePercent: number;
  profitFactor: number | null;
  maxDrawdownPercent: number;
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number; buyHold: number }[];
  verdictAr: string;
  limitsAr: string[];
  monthlyStats: MonthlyStat[];
  performance?: PerformanceStats;
  monteCarlo: MonteCarloStats | null;
}

export interface MonthlyStat {
  monthKey: string; // YYYY-MM
  trades: number;
  wins: number;
  winRatePercent: number;
  pnlUsd: number;
}

export interface RobustnessCell {
  entryMinScore: number;
  adxFloor: number;
  totalTrades: number;
  winRatePercent: number;
  profitFactor: number | null;
  finalEquity: number;
  maxDrawdownPercent: number;
}

// ─── بنية SMC وطبقة السيولة ───
export interface SmcSnapshot {
  structure: 'BULLISH_BOS' | 'BEARISH_BOS' | 'RANGE';
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  orderBlock: { low: number; high: number; kind: 'BULLISH' | 'BEARISH' } | null;
  nearOrderBlock: boolean;
}

export interface LiquidityRegime {
  totalAdjustment: number; // محدود ±8
  verdict: 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF';
  summaryAr: string;
  summaryEn: string;
  components: { nameAr: string; nameEn?: string; change7dPercent: number | null; adjustment: number }[];
  updatedAt: number;
  sourcesOk: number;
  sourcesTotal: number;
}

export interface ProviderHealthInfo {
  provider: string;
  lastOkAt: number | null;
  lastFailAt: number | null;
  lastError: string | null;
}

export interface DailyTrend {
  close: number;
  ema20: number;
  ema50: number;
  bearish: boolean;
  bullish: boolean;
}

// --- Performance analytics (v3) ---
export interface ScoreBucketStat {
  bucket: string;
  trades: number;
  wins: number;
  winRatePercent: number;
  totalPnlUsd: number;
}

export interface ExitReasonStat {
  reason: string;
  count: number;
  totalPnlUsd: number;
}

export interface MonteCarloResult {
  iterations: number;
  maxDrawdown: MonteCarloPercentiles;
  finalEquity: MonteCarloPercentiles;
  riskOfRuinPercent: number;
  lossProbabilityPercent: number;
  confidenceInterval95: {
    minEquity: number;
    maxEquity: number;
    minDrawdown: number;
    maxDrawdown: number;
  };
}

export interface PerformanceStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePercent: number;
  profitFactor: number | null;
  expectancyR: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  payoffRatio: number | null;
  sharpePerTrade: number | null;
  sortinoPerTrade: number | null;
  sortinoRatio?: number | null;
  calmarRatio: number | null;
  maxDrawdownPercent: number;
  maxDrawdownDurationHours: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  timeInMarketPercent: number | null;
  scoreBuckets: ScoreBucketStat[];
  exitBreakdown: ExitReasonStat[];
  monteCarlo?: MonteCarloResult;
}
// --- Walk-forward optimizer (v3) ---
export interface WalkForwardCell {
  entryMinScore: number;
  adxFloor: number;
  cooldownCandles: number;
  optimizeTrades: number;
  optimizeProfitFactor: number | null;
  optimizeWinRatePercent: number;
  optimizeMaxDrawdownPercent: number;
  optimizeFinalEquity: number;
  validateTrades: number;
  validateProfitFactor: number | null;
  validateWinRatePercent: number;
  validateMaxDrawdownPercent: number;
  validateFinalEquity: number;
  score: number;
}

export interface WalkForwardResult {
  splitIndex: number;
  results: WalkForwardCell[];
  best: WalkForwardCell | null;
}
// --- Paper trade outcomes ---
export type PaperTradeOutcome = 'SL_FIRST' | 'TP1_FIRST' | 'TIME' | 'SELL_SIGNAL';

// --- Capital protection (v3) ---
export interface ProtectionConfig {
  dailyLossLimitR: number;
  maxConcurrentSignals: number;
  signalExpiryHours: number;
  correlationGuard: boolean;
  stoplossGuardMax: number;
  stoplossGuardHours: number;
  lossCooldownHours: number;
  /** Number of consecutive paper losses that starts the choppy-market cooldown. */
  choppyLossStreak: number;
  /** Global paper BUY cooldown after the consecutive-loss threshold is reached. */
  choppyCooldownHours: number;
  /** Maximum age of a paper position before a market-price TIME exit. */
  paperMaxHoldHours: number;
}
// --- Learning system (v3) ---
// الأشكال القانونية الموحّدة (مفتاح "TAG|REGIME") — كانت مكررة هنا وفي server/learning.ts بأشكال مختلفة.
export interface TagLearningStat {
  key: string; // "TAG|REGIME"
  tag: string;
  regime: string;
  /** مرجّح بالزمن (اضمحلال نصف عمر 30 يوم) */
  samples: number;
  /** مرجّح بالزمن */
  wins: number;
  /** مرجّح بالزمن */
  losses: number;
  winRatePercent: number;
  /** realized R مرجّح بالزمن */
  netR: number;
}

export interface LearningLesson {
  at: number;
  key: string;
  tag: string;
  regime: string;
  from: number;
  to: number;
  samples: number;
  tagWinRatePercent: number;
  baselineWinRatePercent: number;
}
// --- Fear & Greed factor (v3) ---
export interface FngPoint {
  value: number;
  classification: string;
  timestamp: number;
}

// ═══════════════ v3.1: أنظمة متقدمة مستوحاة من بوت إياد (NexusQuant) ═══════════════

// 1. موجات إليوت وفيبوناتشي (Elliott Wave & Fibonacci)
export type ElliottWaveId =
  | 'WAVE_1'
  | 'WAVE_2'
  | 'WAVE_3'
  | 'WAVE_4'
  | 'WAVE_5'
  | 'WAVE_A'
  | 'WAVE_B'
  | 'WAVE_C'
  | 'UNDEFINED';

export type ElliottWaveType = 'IMPULSE' | 'CORRECTIVE' | 'TRANSITION';

export interface ElliottFibLevels {
  level0_236: number;
  level0_382: number;
  level0_500: number;
  level0_618: number;
  level0_786: number;
  level1_618: number;
}

export interface ElliottWaveAnalysis {
  asset: SupportedAsset;
  currentWave: ElliottWaveId;
  waveType: ElliottWaveType;
  estimatedTarget: number;
  invalidationPrice: number;
  fibLevels: ElliottFibLevels;
  confidence: number;
  rulesPassed: string[];
  rulesViolated: string[];
  impulseVolumeRatio: number;
  validatedSwingsCount: number;
  explanationAr: string;
  explanationEn: string;
}

// 2. المفكرة الاقتصادية وفترات الحظر (Macro Calendar & Blackout Filter)
export interface MacroEvent {
  id: string;
  name: string;
  nameAr: string;
  category: 'FOMC' | 'CPI' | 'NFP' | 'PPI' | 'GDP' | 'CRYPTO_EVENT';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: number;
  timeFormatted: string;
  previousValue: string;
  forecastValue: string;
  actualValue?: string;
  blackoutHoursBefore: number;
  blackoutHoursAfter: number;
  descriptionAr: string;
  status: 'ACTIVE_BLACKOUT' | 'UPCOMING' | 'PASSED';
}

export interface MacroCalendarResponse {
  isBlackoutActive: boolean;
  activeEvent: MacroEvent | null;
  lockReasonAr: string | null;
  lockReasonEn: string | null;
  /** True: this is a display-only reference rhythm of typical release times, NOT a real calendar. */
  isReferenceSchedule?: boolean;
  noteAr?: string;
  noteEn?: string;
  upcomingEvents: MacroEvent[];
  lastUpdated: number;
}

// 3. دفتر الأوامر وعمق السيولة وجدران الحيتان (Order Book Depth & Whale Walls)
export interface OrderBookTier {
  price: number;
  amount: number;
  total: number;
}

export interface OrderBookWall {
  price: number;
  amount: number;
  distancePercent: number;
}

export interface OrderBookDepth {
  asset: SupportedAsset;
  source: string;
  isSimulated: boolean;
  bids: OrderBookTier[];
  asks: OrderBookTier[];
  spread: number;
  spreadPercent: number;
  midPrice: number;
  imbalancePercent: number;
  buyerPercentage: number;
  sellerPercentage: number;
  bidWall: OrderBookWall | null;
  askWall: OrderBookWall | null;
  rule3Passed: boolean;
  lastUpdated: number;
}
