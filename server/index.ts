// خادم SignalForge: API + حلقة المسح الآلي + نشر الواجهة
import express from 'express';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import dotenv from 'dotenv';

import type { SupportedAsset, StoredSignal } from '../shared/types';
import { SUPPORTED_ASSETS, ASSET_LABELS_AR } from '../shared/types';
import { ENGINE_SIGNATURE, PAPER_EXECUTION, TELEGRAM_COOLDOWN_MS } from '../shared/strategyConstants';
import {
  DataUnavailableError,
  getCandles1h,
  getCandles4h,
  getCandles1d,
  getFundingPct8h,
  getHistoricalCandles1h,
  getTicker,
  isDataStale,
  providerHealth,
} from './marketData';
import { buildSignal, type GateToggles } from './signalEngine';
import { evaluateLabelHysteresis, type HysteresisState } from './hysteresis';
import { getLiquidityRegime, bootstrapLiquidityCache } from './llamaService';
import {
  appendLog,
  appendSignal,
  defaultOutcomes,
  getLastSignalForAsset,
  listLogs,
  listSignals,
  loadConfig,
  markTelegramSent,
  maskToken,
  saveConfig,
  updateSignalOutcomes,
  loadTagBias,
  saveTagBias,
  appendLesson,
  listLessons,
  initializeDurablePersistence,
  getDurablePersistence,
  closeDurablePersistence,
} from './persistence';
import {
  buildSignalMessageHtml,
  buildTestMessageHtml,
  buildPaperEventHtml,
  sendTelegramMessage,
  sendTelegramDedupedMessage,
  startTelegramPolling,
  stopTelegramPolling,
  verdictOf,
  verdictLabel,
} from './telegram';
import { computeAttributionSummary, updateOutcomes } from './attribution';
import { choppyCooldownState, clampProtection, currentExposure, evaluateCircuitBreaker, findExpiredSignals, protectionVerdict, utcDayStart } from './protection';
import { computeLearningState, diffLessons } from './learning';
import { getOpenInterestChange24h } from './oiFactor';
import { getFearGreedIndex } from './fng';
import { getTopDexPairs } from './dexscreener';
import { closeCcxtExchangePool } from './ccxtProvider';
import { getWhaleNetflow } from './whaleAlert';
import { getLiquidationRadar } from './liquidationRadar';
import { getDuneSnapshot } from './dune';
import { executeDuneSql, getDuneTopTokens24h, getDuneWhaleTrades, isDuneAvailable, validateDuneSql } from './duneService';
import {
  loadPaperAccount,
  savePaperAccount,
  resetPaperAccount,
  markToMarket,
  openBuy,
  closeBySellSignal,
  currentEquity,
  snapshotPaperAccount,
  diffPaperEvents,
  PAPER_INITIAL_EQUITY,
  type PaperAccount,
  type PaperCandle,
} from './paperTrading';
import { invalidateCandleCache } from './marketData';
import { runBacktest, runRobustness, runWalkForward, DEFAULT_BACKTEST_OPTIONS } from './backtest';
import { getHistoricalCandlesDeep } from './marketData';
import { computeSnapshot, computeHtfSnapshot, computeSmcStructure, computeDailyTrend, computePullbackZone } from '../shared/indicators';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_DEV = process.env.NODE_ENV !== 'production';
const VERSION = '3.0.0';

app.disable('x-powered-by');
// خلف البروكسي السحابي (Render وغيره) كل الطلبات توصل من localhost فيظهر أي زائر كأنه
// "محلي". لذلك trust proxy ضروري عشان نعرف عنوان الفعلي للمستخدم من X-Forwarded-For.
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

// ─── أمان: رؤوس CSP عامة في الإنتاج + rate limit بسيط ───
if (!IS_DEV) {
  app.use((req, res, next) => {
    const isApi = req.path.startsWith('/api');
    const csp = isApi
      ? "default-src 'none'; frame-ancestors 'none'; base-uri 'none';"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none';";
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const backtestBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_BUCKETS_MAX = 10_000; // سقف أمان ضد النمو غير المحدود
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 240; // 240 طلب/دقيقة لكل عنوان
const BACKTEST_WINDOW_MS = 10 * 60_000;
const BACKTEST_MAX_STANDARD = 12;
const BACKTEST_MAX_HEAVY = 3;
const duneSqlBuckets = new Map<string, { count: number; resetAt: number }>();
const DUNE_SQL_WINDOW_MS = 10 * 60_000;
const DUNE_SQL_MAX = 3;
app.use('/api', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }
  bucket.count++;
  // رؤوس معلوماتية قياسية — تساعد العملاء على ضبط الإيقاع (freqtrade-style).
  const remaining = Math.max(0, RATE_LIMIT_MAX - bucket.count);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ ok: false, error: 'Too many requests', retryAfterSeconds: retryAfter });
  }
  next();
});
// تنظيف دوري: يمسح الإدخالات المنتهية + يفرض السقف الأقصى — يمنع تسريب الذاكرة
// على السيرفرات الدائمة (Render وغيره) اللي بيفضل شغال أسابيع.
function sweepRateBuckets(): void {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (b.resetAt <= now) rateBuckets.delete(ip);
  }
  for (const [ip, b] of backtestBuckets) {
    if (b.resetAt <= now) backtestBuckets.delete(ip);
  }
  for (const [ip, b] of duneSqlBuckets) {
    if (b.resetAt <= now) duneSqlBuckets.delete(ip);
  }
  if (rateBuckets.size > RATE_BUCKETS_MAX) {
    const oldest = [...rateBuckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [ip] of oldest.slice(0, rateBuckets.size - RATE_BUCKETS_MAX)) rateBuckets.delete(ip);
  }
  if (backtestBuckets.size > RATE_BUCKETS_MAX) {
    const oldest = [...backtestBuckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [ip] of oldest.slice(0, backtestBuckets.size - RATE_BUCKETS_MAX)) backtestBuckets.delete(ip);
  }
  if (duneSqlBuckets.size > RATE_BUCKETS_MAX) {
    const oldest = [...duneSqlBuckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [ip] of oldest.slice(0, duneSqlBuckets.size - RATE_BUCKETS_MAX)) duneSqlBuckets.delete(ip);
  }
}
setInterval(sweepRateBuckets, 60_000).unref();

function allowBacktestRequest(req: express.Request, res: express.Response, heavy: boolean): boolean {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const max = heavy ? BACKTEST_MAX_HEAVY : BACKTEST_MAX_STANDARD;
  const bucket = backtestBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    backtestBuckets.set(key, { count: 1, resetAt: now + BACKTEST_WINDOW_MS });
    return true;
  }
  bucket.count++;
  if (bucket.count <= max) return true;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  res.setHeader('X-Backtest-RateLimit-Limit', String(max));
  res.setHeader('X-Backtest-RateLimit-Remaining', '0');
  res.status(429).json({ ok: false, error: 'Backtest rate limit exceeded', retryAfterSeconds: retryAfter });
  return false;
}

function allowDuneSqlRequest(req: express.Request, res: express.Response): boolean {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = duneSqlBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    duneSqlBuckets.set(key, { count: 1, resetAt: now + DUNE_SQL_WINDOW_MS });
    return true;
  }
  bucket.count++;
  if (bucket.count <= DUNE_SQL_MAX) return true;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  res.setHeader('X-Dune-SQL-RateLimit-Limit', String(DUNE_SQL_MAX));
  res.setHeader('X-Dune-SQL-RateLimit-Remaining', '0');
  res.status(429).json({ ok: false, error: 'Dune SQL rate limit exceeded', retryAfterSeconds: retryAfter });
  return false;
}

// ─── أدمن: توكن صريح أو ثقة محلية (localhost فقط) ───
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const config = loadConfig();
  const token = config.adminToken || process.env.BOT_ADMIN_TOKEN || '';
  // الثقة المحلية (بدون توكين) مسموحة في وضع التطوير فقط — خلف بروكسي سحابي
  // (الإنتاج) لازم توكين admin صريح حتى من localhost، وإلا أي زائر هيتعامل "محلي".
  if (!token && IS_DEV && (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1')) {
    return next();
  }
  if (!token) {
    res.status(401).json({ ok: false, error: 'Admin token required' });
    return;
  }
  const provided = String(req.headers['x-bot-admin-token'] || '');
  if (provided.length === token.length && timingSafeEqual(Buffer.from(provided), Buffer.from(token))) return next();
  res.status(401).json({ ok: false, error: 'Unauthorized' });
}

// ═══════════════════ API ═══════════════════

const startedAt = Date.now();
let lastScanAt = 0;

app.get('/api/health', (_req, res) => {
  const protection = loadConfig().protection;
  const signals = listSignals(500);
  const now = Date.now();
  const breaker = evaluateCircuitBreaker(signals, protection, now);
  const exposure = currentExposure(signals, protection);
  const choppy = choppyCooldownState(paperAccount.closed, protection.choppyLossStreak, protection.choppyCooldownHours, now);
  res.json({
    ok: true,
    version: VERSION,
    engineSignature: ENGINE_SIGNATURE,
    persistence: getDurablePersistence() ? 'postgres' : 'local_json',
    lastScanAt,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    protection: {
      breakerTripped: breaker.tripped,
      dailyRealizedR: breaker.realizedR,
      dailyLossLimitR: breaker.limit,
      openSignals: exposure.openCount,
      effectiveExposure: exposure.effectiveExposure,
      maxConcurrentSignals: protection.maxConcurrentSignals,
      choppyCooldown: {
        active: choppy.active,
        consecutiveLosses: choppy.consecutiveLosses,
        cooldownUntil: choppy.cooldownUntil,
      },
    },
  });
});

app.get('/api/market/summary', async (_req, res) => {
  const results = await Promise.all(
    SUPPORTED_ASSETS.map(async (asset) => {
      try {
        const t = await getTicker(asset);
        const { asset: _a, ...rest } = t;
        void _a;
        return { asset, labelAr: ASSET_LABELS_AR[asset], ok: true, ...rest };
      } catch {
        return { asset, labelAr: ASSET_LABELS_AR[asset], ok: false };
      }
    }),
  );
  res.json({ ok: true, assets: results });
});

// رادار التصفية — بيانات حقيقية من OKX (بدون أرقام وهمية)
app.get('/api/liquidations/:asset?', async (req, res) => {
  const asset = String(req.query.asset || req.params.asset || 'BTC').toUpperCase() as SupportedAsset;
  if (!SUPPORTED_ASSETS.includes(asset)) return res.status(400).json({ ok: false, error: 'unsupported asset' });
  try {
    const radar = await getLiquidationRadar(asset);
    return res.json({ ok: true, radar });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── المحفظة الورقية: قراءة الحالة الحية ───
app.get('/api/paper', (_req, res) => {
  res.json({
    ok: true,
    account: {
      paused: paperEnginePaused,
      startingEquity: paperAccount.startingEquity,
      cash: paperAccount.cash,
      realizedPnl: paperAccount.realizedPnl,
      open: paperAccount.open,
      closed: paperAccount.closed.slice(-30).reverse(),
      equityCurve: paperAccount.equityCurve,
      updatedAt: paperAccount.updatedAt,
    },
    initialEquity: PAPER_INITIAL_EQUITY,
    execution: {
      feeRate: PAPER_EXECUTION.FEE_RATE,
      slippageRate: PAPER_EXECUTION.SLIPPAGE_RATE,
      mode: 'PAPER_ONLY',
    },
  });
});

// إعادة ضبط الحساب الورقي (إجراء أدمن لأنه يمحو السجل)
app.post('/api/paper/reset', requireAdmin, (_req, res) => {
  paperAccount = resetPaperAccount();
  appendLog('INFO', 'Paper trading account reset to $10,000');
  res.json({ ok: true });
});

// خارطة السوق: كل الأصول في نظرة واحدة (سعر + تغير + توصية + تصفية سريعة)
app.get('/api/market/map', async (_req, res) => {
  const rows = await Promise.all(
    SUPPORTED_ASSETS.map(async (asset) => {
      try {
        const t = await getTicker(asset);
        return {
          asset,
          labelAr: ASSET_LABELS_AR[asset],
          ok: true,
          price: t.price,
          change24h: t.change24h,
          source: t.source,
        };
      } catch {
        return { asset, labelAr: ASSET_LABELS_AR[asset], ok: false };
      }
    }),
  );
  res.json({ ok: true, rows });
});

app.get('/api/market/klines', async (req, res) => {
  const asset = String(req.query.asset || 'BTC').toUpperCase() as SupportedAsset;
  const interval = String(req.query.interval || '1h') === '4h' ? '4h' : '1h';
  const limit = Math.min(500, Math.max(60, Number(req.query.limit) || 300));
  if (!SUPPORTED_ASSETS.includes(asset)) return res.status(400).json({ ok: false, error: 'unsupported asset' });
  try {
    const candles = interval === '4h' ? await getCandles4h(asset, limit) : await getCandles1h(asset, limit);
    if (!candles) {
      return res.status(503).json({ ok: false, error: `بيانات شموع ${interval} غير متاحة حالياً من المزود`, dataUnavailable: true });
    }
    return res.json({ ok: true, asset, interval, candles });
  } catch (e) {
    return res.status(503).json({ ok: false, error: 'بيانات الشموع غير متاحة — كل المزودين فشلوا', dataUnavailable: true, detail: e instanceof Error ? e.message : String(e) });
  }
});

async function computeSignalFor(asset: SupportedAsset, refresh = false) {
  const config = loadConfig();
  const tagBias = loadTagBias();
  if (refresh) invalidateCandleCache(asset); // forced refresh → bypass TTL caches for this asset
  const candles1h = await getCandles1h(asset, 500);
  const snapshot = computeSnapshot(candles1h);
  if (!snapshot) throw new Error(`بيانات غير كافية لحساب إشارة ${asset}`);
  const [candles4h, candles1d, funding, oiChange, fng, whale, ticker, liquidity] = await Promise.all([
    getCandles4h(asset, 400),
    getCandles1d(asset, 400).catch(() => null),
    getFundingPct8h(asset),
    getOpenInterestChange24h(asset),
    getFearGreedIndex(),
    getWhaleNetflow(asset),
    getTicker(asset),
    config.regimeEnabled ? getLiquidityRegime() : Promise.resolve(null),
  ]);
  const htf = candles4h ? computeHtfSnapshot(candles4h) : null;
  const daily = candles1d ? computeDailyTrend(candles1d) : null;
  const smc = computeSmcStructure(candles1h, undefined, snapshot.atr14);
  const entryZone = computePullbackZone(candles1h);
  return buildSignal({
    asset,
    snapshot,
    htf,
    fundingPct8h: funding,
    oiChange24h: oiChange,
    fng,
    whale,
    change24h: ticker.change24h,
    dataSource: isDataStale(candles1h, 3600) ? 'STALE' : 'LIVE',
    gates: config.gates,
    smc,
    liquidity,
    daily,
    entryZone,
    candles: candles1h,
    tagBias,
  });
}

app.get('/api/signal/:asset', async (req, res) => {
  const asset = String(req.query.asset || req.params.asset || 'BTC').toUpperCase() as SupportedAsset;
  if (!SUPPORTED_ASSETS.includes(asset)) return res.status(400).json({ ok: false, error: 'unsupported asset' });
  try {
    const signal = await computeSignalFor(asset, req.query.refresh === '1');
    return res.json({ ok: true, signal });
  } catch (e) {
    if (e instanceof DataUnavailableError) {
      return res.status(503).json({ ok: false, error: e.message, dataUnavailable: true });
    }
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/signals', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  res.json({ ok: true, signals: listSignals(limit) });
});

app.get('/api/attribution/summary', (_req, res) => {
  res.json({ ok: true, summary: computeAttributionSummary(listSignals(500)) });
});
app.get('/api/learning', (_req, res) => {
  const allSignals = listSignals(500);
  const state = computeLearningState(allSignals);
  res.json({
    ok: true,
    baselineWinRatePercent: state.baselineWinRatePercent,
    totalResolved: state.totalResolved,
    perTag: state.perTag,
    biases: loadTagBias(),
    lessons: listLessons(50),
  });
});

app.get('/api/logs', (_req, res) => {
  res.json({ ok: true, logs: listLogs(60) });
});

app.post('/api/backtest', async (req, res) => {
  const body = (req.body || {}) as { asset?: string; days?: number; robustness?: boolean; walkforward?: boolean };
  const asset = String(body.asset || 'BTC').toUpperCase() as SupportedAsset;
  if (!SUPPORTED_ASSETS.includes(asset)) return res.status(400).json({ ok: false, error: 'unsupported asset' });
  if (!allowBacktestRequest(req, res, Boolean(body.robustness || body.walkforward))) return;
  const days = Math.min(1095, Math.max(90, Number(body.days) || 365));
  try {
    const candles = await getHistoricalCandlesDeep(asset, Math.min(30000, days * 24));
    if (body.robustness) {
      const { base, grid } = runRobustness(asset, candles, DEFAULT_BACKTEST_OPTIONS);
      appendLog('INFO', `Backtest robustness ${asset} (${days}d): 9 scenarios computed`);
      return res.json({ ok: true, result: base, robustness: grid });
    }
    if (body.walkforward) {
      const wf = runWalkForward(asset, candles, DEFAULT_BACKTEST_OPTIONS);
      appendLog('INFO', `Walk-forward ${asset}: ${wf.results.length} configs computed, best score ${wf.best?.score ?? 'n/a'}`);
      return res.json({ ok: true, walkforward: wf });
    }
    const result = runBacktest(asset, candles, DEFAULT_BACKTEST_OPTIONS);
    appendLog('INFO', `Backtest ${asset} (${days}d): ${result.totalTrades} trades, final $${result.finalEquity} vs B&H $${result.buyHoldFinal}`);
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/liquidity-regime', async (_req, res) => {
  try {
    const regime = await getLiquidityRegime();
    res.json({ ok: true, regime });
  } catch {
    res.status(503).json({ ok: false, error: 'طبقة السيولة غير متاحة حالياً' });
  }
});

app.get('/api/dune', async (_req, res) => {
  const snapshot = await getDuneSnapshot();
  res.json(snapshot);
});

// ─── Dune Analytics research tab ───
// These endpoints are read-only, asset-scoped where possible, and never feed scoring.
app.get('/api/dune/status', (_req, res) => {
  res.json({ ok: true, available: isDuneAvailable(), tier: isDuneAvailable() ? 'Plus' : 'disabled', researchOnly: true });
});

app.get('/api/dune/whale-trades', async (_req, res) => {
  if (!isDuneAvailable()) return res.status(503).json({ ok: false, available: false, error: 'DUNE_API_KEY is not configured' });
  try {
    const trades = await getDuneWhaleTrades(25);
    return res.json({ ok: true, available: true, trades });
  } catch (e) {
    return res.status(503).json({ ok: false, available: true, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/dune/top-tokens', async (_req, res) => {
  if (!isDuneAvailable()) return res.status(503).json({ ok: false, available: false, error: 'DUNE_API_KEY is not configured' });
  try {
    const tokens = await getDuneTopTokens24h(10);
    return res.json({ ok: true, available: true, tokens });
  } catch (e) {
    return res.status(503).json({ ok: false, available: true, error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/dune/sql', async (req, res) => {
  if (!allowDuneSqlRequest(req, res)) return;
  const sql = String(req.body?.sql || '').trim();
  const validationError = validateDuneSql(sql, true);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  if (!isDuneAvailable()) return res.status(503).json({ ok: false, error: 'DUNE_API_KEY is not configured' });
  try {
    const result = await executeDuneSql(sql);
    if (!result.ok) return res.status(503).json({ ok: false, error: result.error });
    return res.json({ ok: true, rows: result.rows, executionTimeMs: result.executionTimeMs, researchOnly: true });
  } catch (e) {
    return res.status(503).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Daily Comprehensive Terminal Report ───
app.get('/api/report/daily', async (_req, res) => {
  try {
    const config = loadConfig();
    const paper = snapshotPaperAccount(paperAccount);
    const winRate = paper.closed.length > 0
      ? (paper.closed.filter((t) => t.pnlUsd > 0).length / paper.closed.length) * 100
      : 0;
    const totalPnl = paper.closed.reduce((acc, t) => acc + t.pnlUsd, 0);

    const fng = await getFearGreedIndex().catch(() => null);
    const whaleTrades = isDuneAvailable() ? await getDuneWhaleTrades(6).catch(() => []) : [];

    const signals = SUPPORTED_ASSETS.map((asset) => {
      const last = getLastSignalForAsset(asset);
      return {
        asset,
        labelAr: ASSET_LABELS_AR[asset],
        signalType: last?.signalType || 'HOLD',
        spotAction: last?.spotAction || 'SPOT_HOLD',
        convictionScore: last?.convictionScore ?? null,
        entryPrice: last?.entryPrice ?? null,
        stopLoss: last?.stopLoss ?? null,
        target1: last?.target1 ?? null,
        target2: last?.target2 ?? null,
        target3: last?.target3 ?? null,
        regimeGateStatus: last?.regimeGateStatus ?? 'CLEAR',
        reasons: last?.reasons?.map((r) => `${r.tag}: ${r.textAr}`) ?? [],
        generatedAt: last?.generatedAt ?? null,
      };
    });

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      timestamp: Date.now(),
      engine: {
        signature: ENGINE_SIGNATURE,
        version: '3.0.0',
        breakerTripped: evaluateCircuitBreaker(listSignals(100), config.protection, Date.now()).tripped,
        protection: config.protection,
      },
      market: {
        fearAndGreed: fng,
        duneConnected: isDuneAvailable(),
      },
      signals,
      paperTrading: {
        initialBalance: paper.startingEquity,
        cash: Math.round(paper.cash * 100) / 100,
        equity: Math.round((paper.cash + paper.open.reduce((acc, p) => acc + (p.entry * p.qty) + p.pnlAccum, 0)) * 100) / 100,
        totalRealizedPnlUsd: Math.round(totalPnl * 100) / 100,
        winRatePercent: Math.round(winRate * 10) / 10,
        openPositionsCount: paper.open.length,
        closedTradesCount: paper.closed.length,
        openPositions: paper.open,
        recentClosedTrades: paper.closed.slice(-5),
      },
      recentMegaWhaleSwaps: whaleTrades,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/dex/pairs', async (req, res) => {
  const raw = String(req.query.asset || 'BTC');
  // حد أمان: مصطلح البحث أقصاه 30 حرف — يمنع نص عشوائي طويل يتكدس في الكاش
  const asset = raw.trim().toUpperCase().slice(0, 30);
  try {
    const pairs = await getTopDexPairs(asset);
    res.json({ ok: true, pairs: pairs ?? [] });
  } catch {
    res.status(503).json({ ok: false, pairs: [] });
  }
});
app.get('/api/providers', (_req, res) => {
  const providers = [...providerHealth.entries()].map(([provider, h]) => ({
    provider,
    lastOkAt: h.lastOkAt,
    lastFailAt: h.lastFailAt,
    lastError: h.lastError,
  }));
  res.json({ ok: true, providers });
});

app.get('/api/config', (_req, res) => {
  const config = loadConfig();
  res.json({
    ok: true,
    config: {
      scanIntervalSeconds: config.scanIntervalSeconds,
      telegramEnabled: config.telegramEnabled,
      telegramTokenMasked: maskToken(config.telegramToken),
      telegramChatId: config.telegramChatId ? maskToken(config.telegramChatId) : '',
      hasTelegramToken: Boolean(config.telegramToken),
      hasChatId: Boolean(config.telegramChatId),
      gates: config.gates,
      adminRequired: Boolean(config.adminToken || process.env.BOT_ADMIN_TOKEN),
      regimeEnabled: config.regimeEnabled,
      digestEnabled: config.digestEnabled,
      paperAlertsEnabled: config.paperAlertsEnabled,
      paperEnginePaused: config.paperEnginePaused,
      telegramLang: config.telegramLang,
      protection: config.protection,
    },
  });
});

app.post('/api/config', requireAdmin, (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const patch: Parameters<typeof saveConfig>[0] = {};
  if (typeof body.scanIntervalSeconds === 'number' && Number.isFinite(body.scanIntervalSeconds)) {
    patch.scanIntervalSeconds = body.scanIntervalSeconds;
  }
  if (typeof body.telegramEnabled === 'boolean') patch.telegramEnabled = body.telegramEnabled;
  if (typeof body.regimeEnabled === 'boolean') patch.regimeEnabled = body.regimeEnabled;
  if (typeof body.digestEnabled === 'boolean') patch.digestEnabled = body.digestEnabled;
  if (typeof body.paperAlertsEnabled === 'boolean') patch.paperAlertsEnabled = body.paperAlertsEnabled;
  if (body.telegramLang === 'ar' || body.telegramLang === 'en') patch.telegramLang = body.telegramLang;
  if (typeof body.telegramToken === 'string' && body.telegramToken.trim()) patch.telegramToken = body.telegramToken.trim();
  if (typeof body.telegramChatId === 'string' && body.telegramChatId.trim()) patch.telegramChatId = body.telegramChatId.trim();
  if (body.gates && typeof body.gates === 'object') {
    const g = body.gates as Partial<GateToggles>;
    patch.gates = {
      htf: typeof g.htf === 'boolean' ? g.htf : loadConfig().gates.htf,
      chop: typeof g.chop === 'boolean' ? g.chop : loadConfig().gates.chop,
      rvol: typeof g.rvol === 'boolean' ? g.rvol : loadConfig().gates.rvol,
      funding: typeof g.funding === 'boolean' ? g.funding : loadConfig().gates.funding,
    };
  }
  if (body.protection && typeof body.protection === 'object') {
    const pr = body.protection as Record<string, unknown>;
    const cur = loadConfig().protection;
    patch.protection = clampProtection({
      dailyLossLimitR: typeof pr.dailyLossLimitR === 'number' ? pr.dailyLossLimitR : cur.dailyLossLimitR,
      maxConcurrentSignals: typeof pr.maxConcurrentSignals === 'number' ? pr.maxConcurrentSignals : cur.maxConcurrentSignals,
      signalExpiryHours: typeof pr.signalExpiryHours === 'number' ? pr.signalExpiryHours : cur.signalExpiryHours,
      correlationGuard: typeof pr.correlationGuard === 'boolean' ? pr.correlationGuard : cur.correlationGuard,
      stoplossGuardMax: typeof pr.stoplossGuardMax === 'number' ? pr.stoplossGuardMax : cur.stoplossGuardMax,
      stoplossGuardHours: typeof pr.stoplossGuardHours === 'number' ? pr.stoplossGuardHours : cur.stoplossGuardHours,
      lossCooldownHours: typeof pr.lossCooldownHours === 'number' ? pr.lossCooldownHours : cur.lossCooldownHours,
      choppyLossStreak: typeof pr.choppyLossStreak === 'number' ? pr.choppyLossStreak : cur.choppyLossStreak,
      choppyCooldownHours: typeof pr.choppyCooldownHours === 'number' ? pr.choppyCooldownHours : cur.choppyCooldownHours,
      paperMaxHoldHours: typeof pr.paperMaxHoldHours === 'number' ? pr.paperMaxHoldHours : cur.paperMaxHoldHours,
    });
  }
  const next = saveConfig(patch);
  appendLog('INFO', `Config updated (telegram: ${next.telegramEnabled ? 'on' : 'off'}, interval: ${next.scanIntervalSeconds}s)`);
  res.json({ ok: true });
});

app.post('/api/telegram/test', requireAdmin, async (_req, res) => {
  const config = loadConfig();
  const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
  const result = await sendTelegramMessage(token, chatId, buildTestMessageHtml());
  appendLog(result.ok ? 'INFO' : 'WARN', `Telegram test: ${result.ok ? 'sent' : `failed (${result.error})`}`);
  res.json({ ok: result.ok, error: result.error });
});

// ═══════════════════ حلقة المسح الآلي ═══════════════════

let scanning = false;
let consecutiveScanFailures = 0;
let lastFailureAlertAt = 0;
const lastTelegramSentAt = new Map<SupportedAsset, number>();
// آخر توصية تم الإعلان عنها لكل عملة — نعلن فقط عند تغيّر الصورة، فلا تتكرر الرسائل سدى.
const lastAnnouncedVerdict = new Map<SupportedAsset, import('./telegram').VerdictClass>();
let lastBreakerAlertDay = 0;
let backgroundTimer: NodeJS.Timeout | null = null;

// Label hysteresis state (per asset) + scan cycle counter (see server/hysteresis.ts).
const hysteresisState = new Map<SupportedAsset, HysteresisState>();
let scanCycle = 0;

// ─── المحفظة الورقية: حالة حية تُحمَّل من القرص عند الإقلاع ───
let paperAccount: PaperAccount = loadPaperAccount();
// آخر شموع 1h مكتملة لكل أصل (لتسيير الصفقات بدون تسرب داخل نفس الشمعة)
const lastPaperCandles = new Map<SupportedAsset, PaperCandle>();
let paperEnginePaused = false;

function telegramRuntimeConfig(): { enabled: boolean; token: string; chatId: string } {
  const config = loadConfig();
  return {
    enabled: config.telegramEnabled,
    token: config.telegramToken || process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '',
  };
}

async function getOpenPaperPrices(): Promise<Partial<Record<SupportedAsset, number>>> {
  const prices: Partial<Record<SupportedAsset, number>> = {};
  await Promise.all(
    paperAccount.open.map(async (position) => {
      try {
        const ticker = await getTicker(position.asset);
        if (Number.isFinite(ticker.price) && ticker.price > 0) prices[position.asset] = ticker.price;
      } catch {
        // A missing ticker is reported as unavailable; it must not be invented.
      }
    }),
  );
  return prices;
}

function formatPaperUsd(value: number): string {
  return Number.isFinite(value) ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—';
}

async function buildPaperStatusMessage(includePositions = true): Promise<string> {
  const prices = await getOpenPaperPrices();
  const equity = currentEquity(paperAccount, prices);
  const lines = [
    '📊 <b>SignalForge Paper Trading</b>',
    `الحالة / Status: <b>${paperEnginePaused ? 'متوقف مؤقتًا / PAUSED' : 'يعمل / RUNNING'}</b>`,
    `القيمة / Equity: <b>${formatPaperUsd(equity)}</b>`,
    `الكاش / Cash: ${formatPaperUsd(paperAccount.cash)}`,
    `المحقق / Realized PnL: ${formatPaperUsd(paperAccount.realizedPnl)}`,
    `المراكز / Open positions: ${paperAccount.open.length}`,
  ];
  if (includePositions && paperAccount.open.length > 0) {
    lines.push('', '<b>المراكز الحالية / Current positions:</b>');
    for (const position of paperAccount.open) {
      const mark = prices[position.asset];
      const gross = Number.isFinite(mark) ? (mark! - position.entry) * position.qty : Number.NaN;
      lines.push(
        `• ${ASSET_LABELS_AR[position.asset]}: qty ${position.qty.toFixed(6)} | entry ${formatPaperUsd(position.entry)} | mark ${formatPaperUsd(mark ?? Number.NaN)} | PnL ${formatPaperUsd(gross)}`,
      );
    }
  } else if (includePositions) {
    lines.push('', 'لا توجد مراكز مفتوحة / No open positions.');
  }
  lines.push('', '<i>Paper-only — لا يتم إرسال أوامر لبورصة.</i>');
  return lines.join('\n');
}

async function handlePaperPanic(): Promise<string> {
  paperEnginePaused = true;
  saveConfig({ paperEnginePaused: true });
  const positions = [...paperAccount.open];
  if (positions.length === 0) {
    return '🛑 <b>/panic</b>\nلا توجد مراكز ورقية مفتوحة. تم إبقاء المحرك متوقفًا مؤقتًا.\nNo open paper positions; engine remains paused.';
  }

  const closed: string[] = [];
  const failed: string[] = [];
  const handled = new Set<SupportedAsset>();
  for (const position of positions) {
    if (handled.has(position.asset)) continue;
    handled.add(position.asset);
    try {
      const ticker = await getTicker(position.asset);
      if (!Number.isFinite(ticker.price) || ticker.price <= 0) throw new Error('invalid market price');
      paperAccount = closeBySellSignal(paperAccount, position.asset, ticker.price, Date.now());
      closed.push(`${ASSET_LABELS_AR[position.asset]} @ ${formatPaperUsd(ticker.price)}`);
    } catch {
      failed.push(ASSET_LABELS_AR[position.asset]);
    }
  }
  savePaperAccount(paperAccount);
  const lines = [
    '🛑 <b>/panic — Paper only</b>',
    `تم إغلاق ${closed.length} مركز/مراكز بالسعر السوقي الأخير. / Closed ${closed.length} position(s) at the latest market price.`,
    ...closed.map((item) => `✅ ${item}`),
    ...failed.map((asset) => `⚠️ تعذر الإغلاق / Could not close: ${asset}`),
    'المحرك متوقف مؤقتًا؛ استخدم /resume لإعادة التشغيل. / Engine paused; use /resume to restart.',
  ];
  appendLog('WARN', `Paper panic: closed ${closed.length}, failed ${failed.length}`);
  return lines.join('\n');
}

async function runScanCycle(): Promise<void> {
  if (scanning) return;
  scanning = true;
  scanCycle++;
  try {
    const config = loadConfig();
    const protection = config.protection;
    const nowMs = Date.now();
    let signalsNow = listSignals(500);
    const tagBias = loadTagBias();
    // Expiry pass: retire stale unexecuted buy signals (protection rule).
    try {
      for (const c of findExpiredSignals(signalsNow, protection, nowMs)) {
        const s = signalsNow.find((x) => x.id === c.id);
        if (s) {
          updateSignalOutcomes(s.id, { ...s.outcomes, resolution: 'EXPIRED', resolvedAt: nowMs });
          s.outcomes = { ...s.outcomes, resolution: 'EXPIRED', resolvedAt: nowMs };
        }
      }
    } catch {
      // non-fatal
    }
    const breaker = evaluateCircuitBreaker(signalsNow, protection, nowMs);
    if (breaker.tripped && lastBreakerAlertDay !== utcDayStart(nowMs)) {
      lastBreakerAlertDay = utcDayStart(nowMs);
      appendLog('WARN', `CIRCUIT BREAKER: ${breaker.realizedR}R today (limit -${breaker.limit}R) - new BUY signals refused until next UTC day`);
      const btToken = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN || '';
      const btChat = config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
      if (config.telegramEnabled && btToken && btChat) {
        void sendTelegramMessage(btToken, btChat, '<b>Circuit breaker</b>: ' + breaker.realizedR + 'R today (limit -' + breaker.limit + 'R). New BUY signals paused until 00:00 UTC.');
      }
    }
    // لقطة المحفظة قبل تغييرات هذه الدورة — لنشتق أحداث فتح/جني/قفل بدقة.
    const paperBefore = snapshotPaperAccount(paperAccount);
    const paperSizingPrices = !paperEnginePaused && paperAccount.open.length > 0 ? await getOpenPaperPrices() : {};
    for (const asset of SUPPORTED_ASSETS) {
      try {
        const [candles1h, candles4h, funding, oiChange, fng, whale, ticker, liquidity] = await Promise.all([
          getCandles1h(asset, 500),
          getCandles4h(asset, 400),
          getFundingPct8h(asset),
          getOpenInterestChange24h(asset),
          getFearGreedIndex(),
          getWhaleNetflow(asset),
          getTicker(asset),
          config.regimeEnabled ? getLiquidityRegime().catch(() => null) : Promise.resolve(null),
        ]);
        // Keep the latest completed candle fresh even when no new signal is
        // emitted; open paper positions must still receive stop/TP evaluation.
        const lastClosed = candles1h[candles1h.length - 2] ?? candles1h[candles1h.length - 1];
        if (lastClosed) {
          lastPaperCandles.set(asset, {
            open: lastClosed.open,
            high: lastClosed.high,
            low: lastClosed.low,
            close: lastClosed.close,
            time: lastClosed.time,
          });
        }
        const snapshot = computeSnapshot(candles1h);
        if (!snapshot) continue;
        const [candles1d] = await Promise.all([getCandles1d(asset, 400).catch(() => null)]);
        const htf = candles4h ? computeHtfSnapshot(candles4h) : null;
        const daily = candles1d ? computeDailyTrend(candles1d) : null;
        const smc = computeSmcStructure(candles1h, undefined, snapshot.atr14);
        const entryZone = computePullbackZone(candles1h);
        const signal = buildSignal({
          asset,
          snapshot,
          htf,
          fundingPct8h: funding,
          oiChange24h: oiChange,
          fng,
          whale,
          change24h: ticker.change24h,
          dataSource: isDataStale(candles1h, 3600) ? 'STALE' : 'LIVE',
          gates: config.gates,
          smc,
          liquidity,
          daily,
          entryZone,
          tagBias,
          candles: candles1h,
        });

        const gateBlocked = signal.regimeGateStatus !== 'CLEAR';
        const eligible = signal.spotAction === 'SPOT_BUY' || signal.spotAction === 'SPOT_SELL_ALL';
        if (!eligible && !gateBlocked) continue;
        // Label hysteresis: a NEW actionable BUY label must hold its score above
        // the BUY threshold on 2 consecutive scan cycles before it is promoted
        // (stored + Telegram). Gate-blocked BUYs still confirm the label and are
        // stored as before (transparency); SELL/exit labels are never delayed.
        // Pure state machine -> engine and backtests stay deterministic. State
        // resets on restart (first candidate then waits one cycle - safe default).
        const isBuyLabel = signal.spotAction === 'SPOT_BUY';
        const hyst = evaluateLabelHysteresis(hysteresisState.get(asset) ?? { lastBuyCycle: null }, isBuyLabel, scanCycle);
        hysteresisState.set(asset, hyst.nextState);
        if (isBuyLabel && !gateBlocked && !hyst.promote) {
          appendLog('INFO', `${asset}: ${signal.signalType} @ ${signal.entryPrice} hysteresis 1/2 (score ${signal.convictionScore} held - waiting for next scan)`);
          continue;
        }

        // Capital protection: refuse BUY candidates when breaker tripped or exposure cap is full.
        if (eligible && signal.spotAction === 'SPOT_BUY' && !gateBlocked) {
          const verdict = protectionVerdict(signalsNow, protection, asset, Date.now(), paperAccount.closed);
          if (!verdict.allow) {
            appendLog('WARN', `${asset}: ${signal.signalType} REFUSED by ${verdict.reason} @ ${signal.entryPrice}`);
            continue;
          }
        }

        const last = getLastSignalForAsset(asset);
        if (last && last.dedupHash === signal.dedupHash) continue;

        const stored: StoredSignal = {
          ...signal,
          id: `${asset}-${signal.generatedAt}`,
          isGateBlocked: gateBlocked,
          telegramSent: false,
          outcomes: defaultOutcomes(),
        };
        appendSignal(stored);
        signalsNow.push(stored);
        appendLog('INFO', `${asset}: ${signal.signalType}${gateBlocked ? ` (${signal.regimeGateStatus})` : ''} @ ${signal.entryPrice}`);

        // ─── المحفظة الورقية: فتح شراء / قفل على بيع ───
        // نقيّم على آخر شمعة مكتملة فقط (نستبعد الشمعة الجارية لتجنب تسرب زمني).
        if (!paperEnginePaused) {
          if (!gateBlocked && signal.spotAction === 'SPOT_BUY') {
            paperAccount = openBuy(
              paperAccount,
              signal,
              snapshot.atr14,
              Date.now(),
              protection.maxConcurrentSignals,
              { ...paperSizingPrices, [asset]: ticker.price },
            );
          } else if (!gateBlocked && signal.spotAction === 'SPOT_SELL_ALL') {
            paperAccount = closeBySellSignal(paperAccount, asset, ticker.price, Date.now());
          }
          savePaperAccount(paperAccount);
        }

        // إشعار تليجرام الذكي: نُعلن فقط عندما تتغيّر الصورة القابلة للتنفيذ
        // (توصية جديدة أو مختلفة عن آخر ما أُعلن)، لا مع كل مسح يتكرر نفس الحال.
        const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN || '';
        const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
        const now = Date.now();
        const lastSent = lastTelegramSentAt.get(asset) || 0;
        const vNow = verdictOf(signal);
        const vPrev = lastAnnouncedVerdict.get(asset) ?? null;
        const verdictChanged = vPrev !== vNow;
        const cooldownOk = now - lastSent > TELEGRAM_COOLDOWN_MS;
        // نُعلن دائمًا عن توصية قابلة للتنفيذ (BUY/SELL) إن تغيّرت؛ أما البوابات
        // والتكرار فيخضعان لفحص التغيّر + التهدئة.
        const shouldSend =
          config.telegramEnabled &&
          token &&
          chatId &&
          verdictChanged &&
          (eligible ? true : cooldownOk); // gate-blocked transitions also respect cooldown
        if (shouldSend) {
          const sendResult = await sendTelegramMessage(token, chatId, buildSignalMessageHtml(signal, vPrev));
          markTelegramSent(stored.id, sendResult.ok);
          if (sendResult.ok) {
            lastTelegramSentAt.set(asset, now);
            lastAnnouncedVerdict.set(asset, vNow);
          }
          appendLog(sendResult.ok ? 'INFO' : 'WARN', `Telegram ${asset}: ${sendResult.ok ? 'sent' : sendResult.error}`);
        }
      } catch (e) {
        appendLog('WARN', `Scan ${asset}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ─── المحفظة الورقية: تسيير المراكز المفتوحة بآخر الأسعار والشموع المكتملة ───
    try {
      if (!paperEnginePaused && paperAccount.open.length > 0) {
        const prices: Partial<Record<SupportedAsset, number>> = {};
        for (const p of paperAccount.open) {
          try {
            const t = await getTicker(p.asset);
            prices[p.asset] = t.price;
          } catch {
            // فشل مزود → نُبقي آخر سعر معروف
          }
        }
        const candleMap: Partial<Record<SupportedAsset, PaperCandle>> = {};
        for (const a of lastPaperCandles.keys()) {
          candleMap[a] = lastPaperCandles.get(a) as PaperCandle;
        }
        paperAccount = markToMarket(paperAccount, prices, candleMap, Date.now(), protection.paperMaxHoldHours);
        savePaperAccount(paperAccount);
      }
    } catch {
      // غير قاتل — المحاولة القادمة
    }

    // ─── إشعارات أحداث المحفظة الورقية (فتح / جني TP / قفل) ───
    try {
      const paperAfter = snapshotPaperAccount(paperAccount);
      const events = diffPaperEvents(paperBefore, paperAfter);
      if (events.length > 0 && config.paperAlertsEnabled) {
        const pwToken = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN || '';
        const pwChat = config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
        if (config.telegramEnabled && pwToken && pwChat) {
          const tgLang = config.telegramLang ?? 'ar';
          for (const ev of events) {
            let html = '';
            if (ev.kind === 'OPENED') {
              html = buildPaperEventHtml(
                { kind: 'OPENED', asset: ev.asset, qty: ev.pos.qty, entry: ev.pos.entry, feesUsd: ev.pos.feesPaid },
                tgLang,
              );
            } else if (ev.kind === 'TP1' || ev.kind === 'TP2') {
              html = buildPaperEventHtml(
                { kind: ev.kind, asset: ev.asset, entry: ev.pos.entry, pnlUsd: ev.pos.pnlAccum, feesUsd: ev.pos.feesPaid },
                tgLang,
              );
            } else {
              html = buildPaperEventHtml(
                {
                  kind: 'CLOSED',
                  asset: ev.asset,
                  exitAvg: ev.trade?.exitAvg,
                  pnlUsd: ev.trade?.pnlUsd,
                  feesUsd: ev.trade?.feesUsd,
                  reason: ev.trade?.reason,
                },
                tgLang,
              );
            }
            const eventIdentity =
              ev.kind === 'CLOSED'
                ? ev.trade?.id ?? ev.posBefore?.id ?? `${ev.asset}:${paperAfter.updatedAt}`
                : ev.pos.id;
            const pwResult = await sendTelegramDedupedMessage(pwToken, pwChat, html, `paper:${ev.kind}:${ev.asset}:${eventIdentity}`);
            if (!pwResult.ok) {
              appendLog('WARN', `Paper alert ${ev.kind} ${ev.asset}: ${pwResult.error ?? 'failed'}`);
            }
          }
        }
      }
    } catch {
      // إشعارات المحفظة غير قاتلة — لا توقف المسح
    }

    // تحديث عدّاد الأداء (Attribution) للإشارات المفتوحة
    try {
      await updateOutcomes(listSignals(120), (a, _iv, limit) => getCandles1h(a, limit));
    } catch {
      // تجاهل — المحاولة القادمة
    }

    // Learning pass: recompute factor biases from resolved outcomes (audited changes only).
    try {
      const allSignals = listSignals(500);
      const state = computeLearningState(allSignals);
      const oldBiases = loadTagBias();
      const lessons = diffLessons(oldBiases, state.biases, state.perTag, state.baselineWinRatePercent, Date.now());
      if (lessons.length > 0) {
        saveTagBias(state.biases);
        for (const l of lessons) appendLesson(l);
        appendLog('INFO', `Learning: bias updated for ${lessons.map((l) => l.tag).join(', ')}`);
      }
    } catch {
      // non-fatal
    }

    consecutiveScanFailures = 0;
    lastScanAt = Date.now();
  } catch (err) {
    consecutiveScanFailures++;
    appendLog('ERROR', `Scan cycle failed (${consecutiveScanFailures}): ${err instanceof Error ? err.message : String(err)}`);
    const config = loadConfig();
    const now = Date.now();
    if (consecutiveScanFailures >= 3 && config.telegramEnabled && now - lastFailureAlertAt > TELEGRAM_COOLDOWN_MS) {
      lastFailureAlertAt = now;
      const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN || '';
      const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
      if (token && chatId) {
        void sendTelegramMessage(token, chatId, '🚨 <b>[تنبيه طوارئ — SignalForge]</b>\nفشل حلقة المسح 3 مرات متتالية — الحلقة مستمرة ولن تتوقف.');
      }
    }
  } finally {
    scanning = false;
  }
}

function scheduleNextScan(delayMs?: number): void {
  if (backgroundTimer) clearTimeout(backgroundTimer);
  const config = loadConfig();
  const delay = typeof delayMs === 'number' ? delayMs : Math.max(30, config.scanIntervalSeconds) * 1000;
  backgroundTimer = setTimeout(async () => {
    try {
      await runScanCycle();
    } finally {
      scheduleNextScan();
    }
  }, delay);
}

// ═══════════════════ التقرير اليومي الصادق ═══════════════════

function buildDailyDigestHtml(): string {
  const summary = computeAttributionSummary(listSignals(500));
  const all = listSignals(500);
  const lines = [
    '📊 <b>[التقرير اليومي — SignalForge]</b>',
    '',
    '<b>الموقف الحالي لكل أصل:</b>',
  ];
  // آخر إشارة محفوظة لكل أصل = موقفه الحالي (توصية صريحة).
  for (const asset of SUPPORTED_ASSETS) {
    const last = all.find((s) => s.asset === asset);
    if (!last) {
      lines.push(`• ${ASSET_LABELS_AR[asset]}: — لا توجد إشارات بعد`);
      continue;
    }
    const v = verdictOf(last);
    const gate = v === 'GATED' ? ` (${last.regimeGateStatus.replace(/_/g, ' ')})` : '';
    lines.push(`• ${ASSET_LABELS_AR[asset]}: ${verdictLabel(v)}${gate} @ ${last.entryPrice ? `$${last.entryPrice.toLocaleString('en-US')}` : '—'}`);
  }
  const actionableToday = all.filter((s) => !s.isGateBlocked && s.spotAction !== 'SPOT_HOLD').length;
  lines.push('', `<b>إشارات قابلة للتنفيذ في السجل:</b> ${actionableToday}`);
  if (summary.resolved > 0) {
    lines.push(
      `<b>الإجمالي المُتتبع:</b> ${summary.resolved} محسومة — نجاح ${summary.winRatePercent ?? 0}% (TP1 قبل الوقف: ${summary.tp1First}، وقف أولاً: ${summary.slFirst})`,
    );
  } else {
    lines.push('<b>الإجمالي المُتتبع:</b> لسه مفيش إشارات محسومة — العدّاد بيجمع');
  }
  if (summary.avgMfePercent !== null) {
    lines.push(`MFE متوسط ${summary.avgMfePercent}% | MAE متوسط ${summary.avgMaePercent}%`);
  }
  const topTags = summary.perTag.slice(0, 3);
  if (topTags.length) {
    lines.push('', '<b>أقوى العوامل:</b>');
    for (const t of topTags) {
      lines.push(`• ${t.tag}: ${t.winRatePercent ?? '—'}% نجاح (${t.total} محسومة)`);
    }
  }
  lines.push('', '<i>أداة بحثية — ليست نصيحة استثمارية.</i>');
  return lines.join('\n');
}

async function sendDailyDigestIfDue(): Promise<void> {
  const config = loadConfig();
  if (!config.digestEnabled || !config.telegramEnabled) return;
  const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chatId) return;
  const last = new Date(lastDigestAt);
  const now = new Date();
  const isNewDay = last.getFullYear() !== now.getFullYear() || last.getMonth() !== now.getMonth() || last.getDate() !== now.getDate();
  if (!isNewDay) return;
  const result = await sendTelegramMessage(token, chatId, buildDailyDigestHtml());
  if (result.ok) {
    lastDigestAt = Date.now();
    appendLog('INFO', 'Daily digest sent');
  }
}

let lastDigestAt = 0;

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (backgroundTimer) clearTimeout(backgroundTimer);
  stopTelegramPolling();
  await closeCcxtExchangePool();
  appendLog('INFO', `Server stopped (${signal})`);
  await closeDurablePersistence();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

// Keep unknown API requests from falling through to Vite's SPA middleware in development.
app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ═══════════════════ الواجهة ═══════════════════

async function main(): Promise<void> {
  const durable = await initializeDurablePersistence();
  if (durable) {
    // Reload after migration so the running process uses the remote paper state,
    // not the JSON snapshot that existed before the database was initialized.
    paperAccount = loadPaperAccount();
    appendLog('INFO', 'Durable PostgreSQL storage enabled');
  } else if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) {
    appendLog('WARN', 'DATABASE_URL was provided but durable storage could not start; local JSON fallback is active');
  }
  paperEnginePaused = loadConfig().paperEnginePaused;

  if (IS_DEV) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`╔════════════════════════════════════════════╗`);
    console.log(`║  SignalForge — منصة الإشارات الكمية          ║`);
    console.log(`║  ${ENGINE_SIGNATURE}`);
    console.log(`║  يعمل الآن على: http://localhost:${PORT}`);
    console.log(`╚════════════════════════════════════════════╝`);
    appendLog('INFO', `Server started (port ${PORT}, ${IS_DEV ? 'dev' : 'production'})`);
    bootstrapLiquidityCache();
    scheduleNextScan(30_000);
    startTelegramPolling(telegramRuntimeConfig, {
      status: () => buildPaperStatusMessage(true),
      balance: () => buildPaperStatusMessage(false),
      pause: () => {
        paperEnginePaused = true;
        saveConfig({ paperEnginePaused: true });
        appendLog('WARN', 'Paper engine paused from Telegram');
        return '⏸️ <b>Paper engine paused</b>\nتم إيقاف محرك التداول الورقي مؤقتًا. / Paper execution is paused.';
      },
      resume: () => {
        paperEnginePaused = false;
        saveConfig({ paperEnginePaused: false });
        appendLog('INFO', 'Paper engine resumed from Telegram');
        return '▶️ <b>Paper engine resumed</b>\nتم استئناف محرك التداول الورقي. / Paper execution is active again.';
      },
      panic: handlePaperPanic,
    });
    // التقرير اليومي: فحص كل ساعة، يُرسل مرة واحدة يومياً عند أول فحص بعد منتصف الليل
    setInterval(() => {
      void sendDailyDigestIfDue().catch(() => {});
    }, 60 * 60 * 1000);
    // أول فحص بعد 5 دقائق من الإقلاع
    setTimeout(() => {
      void sendDailyDigestIfDue().catch(() => {});
    }, 5 * 60 * 1000);
  });
}

void main();
