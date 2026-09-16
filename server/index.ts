// خادم SignalForge: API + حلقة المسح الآلي + نشر الواجهة
import express from 'express';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import dotenv from 'dotenv';

import type { SupportedAsset, StoredSignal } from '../shared/types';
import { SUPPORTED_ASSETS, ASSET_LABELS_AR } from '../shared/types';
import { ENGINE_SIGNATURE, TELEGRAM_COOLDOWN_MS } from '../shared/strategyConstants';
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
} from './persistence';
import { buildSignalMessageHtml, buildTestMessageHtml, sendTelegramMessage } from './telegram';
import { computeAttributionSummary, updateOutcomes } from './attribution';
import { clampProtection, currentExposure, evaluateCircuitBreaker, findExpiredSignals, protectionVerdict, utcDayStart } from './protection';
import { computeLearningState, diffLessons } from './learning';
import { getOpenInterestChange24h } from './oiFactor';
import { getFearGreedIndex } from './fng';
import { getWhaleNetflow } from './whaleAlert';
import { invalidateCandleCache } from './marketData';
import { runBacktest, runRobustness, runWalkForward, DEFAULT_BACKTEST_OPTIONS } from './backtest';
import { computeSnapshot, computeHtfSnapshot, computeSmcStructure, computeDailyTrend, computePullbackZone } from '../shared/indicators';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_DEV = process.env.NODE_ENV !== 'production';
const VERSION = '2.0.0';

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// ─── أمان: CSP في الإنتاج + rate limit بسيط ───
if (!IS_DEV) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    }
    next();
  });
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
app.use('/api', (req, res, next) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  bucket.count++;
  if (bucket.count > 240) return res.status(429).json({ ok: false, error: 'Too many requests' });
  next();
});

// ─── أدمن: توكن صريح أو ثقة محلية (localhost فقط) ───
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const config = loadConfig();
  const token = config.adminToken || process.env.BOT_ADMIN_TOKEN || '';
  if (!token) {
    const ip = req.socket.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    res.status(401).json({ ok: false, error: 'Admin token required for non-local requests' });
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
  const breaker = evaluateCircuitBreaker(listSignals(500), protection, Date.now());
  const exposure = currentExposure(listSignals(500), protection);
  res.json({
    ok: true,
    version: VERSION,
    engineSignature: ENGINE_SIGNATURE,
    lastScanAt,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    protection: {
      breakerTripped: breaker.tripped,
      dailyRealizedR: breaker.realizedR,
      dailyLossLimitR: breaker.limit,
      openSignals: exposure.openCount,
      effectiveExposure: exposure.effectiveExposure,
      maxConcurrentSignals: protection.maxConcurrentSignals,
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
  let candles1h = await getCandles1h(asset, 500);
  if (refresh) candles1h = await getCandles1h(asset, 500);
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
    change24h: ticker.change24h,
    dataSource: isDataStale(candles1h, 3600) ? 'STALE' : 'LIVE',
    gates: config.gates,
    smc,
    liquidity,
    daily,
    entryZone,
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
  const days = Math.min(365, Math.max(90, Number(body.days) || 365));
  try {
    const candles = await getHistoricalCandles1h(asset, Math.min(10000, days * 24));
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
let lastBreakerAlertDay = 0;
let backgroundTimer: NodeJS.Timeout | null = null;

async function runScanCycle(): Promise<void> {
  if (scanning) return;
  scanning = true;
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
        });

        const gateBlocked = signal.regimeGateStatus !== 'CLEAR';
        const eligible = signal.spotAction === 'SPOT_BUY' || signal.spotAction === 'SPOT_SELL_ALL';
        if (!eligible && !gateBlocked) continue;

        // Capital protection: refuse BUY candidates when breaker tripped or exposure cap is full.
        if (eligible && signal.spotAction === 'SPOT_BUY' && !gateBlocked) {
          const verdict = protectionVerdict(signalsNow, protection, asset, Date.now());
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

        // إشعار تليجرام للإشارات القابلة للتنفيذ فقط
        const token = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN || '';
        const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
        const now = Date.now();
        const lastSent = lastTelegramSentAt.get(asset) || 0;
        if (config.telegramEnabled && eligible && token && chatId && now - lastSent > TELEGRAM_COOLDOWN_MS) {
          const sendResult = await sendTelegramMessage(token, chatId, buildSignalMessageHtml(signal));
          markTelegramSent(stored.id, sendResult.ok);
          if (sendResult.ok) lastTelegramSentAt.set(asset, now);
          appendLog(sendResult.ok ? 'INFO' : 'WARN', `Telegram ${asset}: ${sendResult.ok ? 'sent' : sendResult.error}`);
        }
      } catch (e) {
        appendLog('WARN', `Scan ${asset}: ${e instanceof Error ? e.message : String(e)}`);
      }
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
  const recent = listSignals(15);
  const actionable = recent.filter((s) => !s.isGateBlocked);
  const blocked = recent.filter((s) => s.isGateBlocked);
  const lines = [
    '📊 <b>[التقرير اليومي — SignalForge]</b>',
    '',
    `<b>آخر 24 ساعة:</b> ${actionable.length} إشارة قابلة للتنفيذ، ${blocked.length} محجوبة ببوابات المخاطر`,
  ];
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

// ═══════════════════ الواجهة ═══════════════════

async function main(): Promise<void> {
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

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  app.listen(PORT, () => {
    console.log(`╔════════════════════════════════════════════╗`);
    console.log(`║  SignalForge — منصة الإشارات الكمية          ║`);
    console.log(`║  ${ENGINE_SIGNATURE}`);
    console.log(`║  يعمل الآن على: http://localhost:${PORT}`);
    console.log(`╚════════════════════════════════════════════╝`);
    appendLog('INFO', `Server started (port ${PORT}, ${IS_DEV ? 'dev' : 'production'})`);
    bootstrapLiquidityCache();
    scheduleNextScan(30_000);
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
