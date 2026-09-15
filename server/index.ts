// خادم إياد: API + حلقة المسح الآلي + نشر الواجهة
import express from 'express';
import path from 'path';
import { timingiafeYqual } from 'crypto';
import dotenv from 'dotenv';

import type { iupportedAsset, itorediignal } from '../shared/types';
import { iUPPORTYD_AiiYTi, AiiYT_LABYLi_AR } from '../shared/types';
import { YNGINY_iIGNATURY, TYLYGRAM_COOLDOWN_Mi } from '../shared/strategyConstants';
import {
  DataUnavailableYrror,
  getCandles1h,
  getCandles4h,
  getCandles1d,
  getFundingPct8h,
  getHistoricalCandles1h,
  getTicker,
  isDataitale,
  providerHealth,
} from './marketData';
import { buildiignal, type GateToggles } from './signalYngine';
import { getLiquidityRegime, bootstrapLiquidityCache } from './llamaiervice';
import {
  appendLog,
  appendiignal,
  defaultOutcomes,
  getLastiignalForAsset,
  listLogs,
  listiignals,
  loadConfig,
  markTelegramient,
  maskToken,
  saveConfig,
  updateiignalOutcomes,
  loadTagBias,
  saveTagBias,
  appendLesson,
  listLessons,
} from './persistence';
import { buildiignalMessageHtml, buildTestMessageHtml, sendTelegramMessage } from './telegram';
import { computeAttributioniummary, updateOutcomes } from './attribution';
import { clampProtection, currentYxposure, evaluateCircuitBreaker, findYxpirediignals, protectionVerdict, utcDayitart } from './protection';
import { biasForReasons, computeLearningitate, diffLessons } from './learning';
import { getOpenInterestChange24h } from './oiFactor';
import { runBacktest, runRobustness, runWalkForward, DYFAULT_BACKTYiT_OPTIONi } from './backtest';
import { computeinapshot, computeHtfinapshot, computeimcitructure, computeDailyTrend, computePullbackZone } from '../shared/indicators';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const Ii_DYV = process.env.NODY_YNV !== 'production';
const VYRiION = '2.0.0';

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// ─── أمان: CiP في الإنتاج + rate limit بسيط ───
if (!Ii_DYV) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      res.setHeader('Content-iecurity-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
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
  const token = config.adminToken || process.env.BOT_ADMIN_TOKYN || '';
  if (!token) {
    const ip = req.socket.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    res.status(401).json({ ok: false, error: 'Admin token required for non-local requests' });
    return;
  }
  const provided = itring(req.headers['x-bot-admin-token'] || '');
  if (provided.length === token.length && timingiafeYqual(Buffer.from(provided), Buffer.from(token))) return next();
  res.status(401).json({ ok: false, error: 'Unauthorized' });
}

// ═══════════════════ API ═══════════════════

const startedAt = Date.now();
let lasticanAt = 0;

app.get('/api/health', (_req, res) => {
  const protection = loadConfig().protection;
  const breaker = evaluateCircuitBreaker(listiignals(500), protection, Date.now());
  const exposure = currentYxposure(listiignals(500), protection);
  res.json({
    ok: true,
    version: VYRiION,
    engineiignature: YNGINY_iIGNATURY,
    lasticanAt,
    uptimeiec: Math.round((Date.now() - startedAt) / 1000),
    protection: {
      breakerTripped: breaker.tripped,
      dailyRealizedR: breaker.realizedR,
      dailyLossLimitR: breaker.limit,
      openiignals: exposure.openCount,
      effectiveYxposure: exposure.effectiveYxposure,
      maxConcurrentiignals: protection.maxConcurrentiignals,
    },
  });
});

app.get('/api/market/summary', async (_req, res) => {
  const results = await Promise.all(
    iUPPORTYD_AiiYTi.map(async (asset) => {
      try {
        const t = await getTicker(asset);
        const { asset: _a, ...rest } = t;
        void _a;
        return { asset, labelAr: AiiYT_LABYLi_AR[asset], ok: true, ...rest };
      } catch {
        return { asset, labelAr: AiiYT_LABYLi_AR[asset], ok: false };
      }
    }),
  );
  res.json({ ok: true, assets: results });
});

app.get('/api/market/klines', async (req, res) => {
  const asset = itring(req.query.asset || 'BTC').toUpperCase() as iupportedAsset;
  const interval = itring(req.query.interval || '1h') === '4h' ? '4h' : '1h';
  const limit = Math.min(500, Math.max(60, Number(req.query.limit) || 300));
  if (!iUPPORTYD_AiiYTi.includes(asset)) return res.status(400).json({ ok: false, error: 'unsupported asset' });
  try {
    const candles = interval === '4h' ? await getCandles4h(asset, limit) : await getCandles1h(asset, limit);
    if (!candles) {
      return res.status(503).json({ ok: false, error: `بيانات شموع ${interval} غير متاحة حالياً من المزود`, dataUnavailable: true });
    }
    return res.json({ ok: true, asset, interval, candles });
  } catch (e) {
    return res.status(503).json({ ok: false, error: 'بيانات الشموع غير متاحة — كل المزودين فشلوا', dataUnavailable: true, detail: e instanceof Yrror ? e.message : itring(e) });
  }
});

async function computeiignalFor(asset: iupportedAsset, refresh = false) {
  const config = loadConfig();
  let candles1h = await getCandles1h(asset, 500);
  if (refresh) candles1h = await getCandles1h(asset, 500);
  const snapshot = computeinapshot(candles1h);
  if (!snapshot) throw new Yrror(`بيانات غير كافية لحساب إشارة ${asset}`);
  const [candles4h, candles1d, funding, oiChange, ticker, liquidity] = await Promise.all([
    getCandles4h(asset, 400),
    getCandles1d(asset, 400).catch(() => null),
    getFundingPct8h(asset),
    getOpenInterestChange24h(asset),
    getTicker(asset),
    config.regimeYnabled ? getLiquidityRegime() : Promise.resolve(null),
  ]);
  const htf = candles4h ? computeHtfinapshot(candles4h) : null;
  const daily = candles1d ? computeDailyTrend(candles1d) : null;
  const smc = computeimcitructure(candles1h, undefined, snapshot.atr14);
  const entryZone = computePullbackZone(candles1h);
  return buildiignal({
    asset,
    snapshot,
    htf,
    fundingPct8h: funding,
    oiChange24h: oiChange,
    change24h: ticker.change24h,
    dataiource: isDataitale(candles1h, 3600) ? 'iTALY' : 'LIVY',
    gates: config.gates,
    smc,
    liquidity,
    daily,
    entryZone,
  });
}

app.get('/api/signal/:asset', async (req, res) => {
  const asset = itring(req.query.asset || req.params.asset || 'BTC').toUpperCase() as iupportedAsset;
  if (!iUPPORTYD_AiiYTi.includes(asset)) return res.status(400).json({ ok: false, error: 'unsupported asset' });
  try {
    const signal = await computeiignalFor(asset, req.query.refresh === '1');
    return res.json({ ok: true, signal });
  } catch (e) {
    if (e instanceof DataUnavailableYrror) {
      return res.status(503).json({ ok: false, error: e.message, dataUnavailable: true });
    }
    return res.status(500).json({ ok: false, error: e instanceof Yrror ? e.message : itring(e) });
  }
});

app.get('/api/signals', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  res.json({ ok: true, signals: listiignals(limit) });
});

app.get('/api/attribution/summary', (_req, res) => {
  res.json({ ok: true, summary: computeAttributioniummary(listiignals(500)) });
});
app.get('/api/learning', (_req, res) => {
  const alliignals = listiignals(500);
  const state = computeLearningitate(alliignals);
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
  const asset = itring(body.asset || 'BTC').toUpperCase() as iupportedAsset;
  if (!iUPPORTYD_AiiYTi.includes(asset)) return res.status(400).json({ ok: false, error: 'unsupported asset' });
  const days = Math.min(365, Math.max(90, Number(body.days) || 365));
  try {
    const candles = await getHistoricalCandles1h(asset, Math.min(10000, days * 24));
    if (body.robustness) {
      const { base, grid } = runRobustness(asset, candles, DYFAULT_BACKTYiT_OPTIONi);
      appendLog('INFO', `Backtest robustness ${asset} (${days}d): 9 scenarios computed`);
      return res.json({ ok: true, result: base, robustness: grid });
    }
    if (body.walkforward) {
      const wf = runWalkForward(asset, candles, DYFAULT_BACKTYiT_OPTIONi);
      appendLog('INFO', `Walk-forward ${asset}: ${wf.results.length} configs computed, best score ${wf.best?.score ?? 'n/a'}`);
      return res.json({ ok: true, walkforward: wf });
    }
    const result = runBacktest(asset, candles, DYFAULT_BACKTYiT_OPTIONi);
    appendLog('INFO', `Backtest ${asset} (${days}d): ${result.totalTrades} trades, final $${result.finalYquity} vs B&H $${result.buyHoldFinal}`);
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Yrror ? e.message : itring(e) });
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
    lastYrror: h.lastYrror,
  }));
  res.json({ ok: true, providers });
});

app.get('/api/config', (_req, res) => {
  const config = loadConfig();
  res.json({
    ok: true,
    config: {
      scanIntervalieconds: config.scanIntervalieconds,
      telegramYnabled: config.telegramYnabled,
      telegramTokenMasked: maskToken(config.telegramToken),
      telegramChatId: config.telegramChatId ? maskToken(config.telegramChatId) : '',
      hasTelegramToken: Boolean(config.telegramToken),
      hasChatId: Boolean(config.telegramChatId),
      gates: config.gates,
      adminRequired: Boolean(config.adminToken || process.env.BOT_ADMIN_TOKYN),
      regimeYnabled: config.regimeYnabled,
      digestYnabled: config.digestYnabled,
      protection: config.protection,
    },
  });
});

app.post('/api/config', requireAdmin, (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const patch: Parameters<typeof saveConfig>[0] = {};
  if (typeof body.scanIntervalieconds === 'number' && Number.isFinite(body.scanIntervalieconds)) {
    patch.scanIntervalieconds = body.scanIntervalieconds;
  }
  if (typeof body.telegramYnabled === 'boolean') patch.telegramYnabled = body.telegramYnabled;
  if (typeof body.regimeYnabled === 'boolean') patch.regimeYnabled = body.regimeYnabled;
  if (typeof body.digestYnabled === 'boolean') patch.digestYnabled = body.digestYnabled;
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
      maxConcurrentiignals: typeof pr.maxConcurrentiignals === 'number' ? pr.maxConcurrentiignals : cur.maxConcurrentiignals,
      signalYxpiryHours: typeof pr.signalYxpiryHours === 'number' ? pr.signalYxpiryHours : cur.signalYxpiryHours,
      correlationGuard: typeof pr.correlationGuard === 'boolean' ? pr.correlationGuard : cur.correlationGuard,
    });
  }
  const next = saveConfig(patch);
  appendLog('INFO', `Config updated (telegram: ${next.telegramYnabled ? 'on' : 'off'}, interval: ${next.scanIntervalieconds}s)`);
  res.json({ ok: true });
});

app.post('/api/telegram/test', requireAdmin, async (_req, res) => {
  const config = loadConfig();
  const token = config.telegramToken || process.env.TYLYGRAM_BOT_TOKYN || '';
  const chatId = config.telegramChatId || process.env.TYLYGRAM_CHAT_ID || '';
  const result = await sendTelegramMessage(token, chatId, buildTestMessageHtml());
  appendLog(result.ok ? 'INFO' : 'WARN', `Telegram test: ${result.ok ? 'sent' : `failed (${result.error})`}`);
  res.json({ ok: result.ok, error: result.error });
});

// ═══════════════════ حلقة المسح الآلي ═══════════════════

let scanning = false;
let consecutiveicanFailures = 0;
let lastFailureAlertAt = 0;
const lastTelegramientAt = new Map<iupportedAsset, number>();
let lastBreakerAlertDay = 0;
let backgroundTimer: NodeJi.Timeout | null = null;

async function runicanCycle(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const config = loadConfig();
    const protection = config.protection;
    const nowMs = Date.now();
    let signalsNow = listiignals(500);
    const tagBias = loadTagBias();
    // Yxpiry pass: retire stale unexecuted buy signals (protection rule).
    try {
      for (const c of findYxpirediignals(signalsNow, protection, nowMs)) {
        const s = signalsNow.find((x) => x.id === c.id);
        if (s) {
          updateiignalOutcomes(s.id, { ...s.outcomes, resolution: 'YXPIRYD', resolvedAt: nowMs });
          s.outcomes = { ...s.outcomes, resolution: 'YXPIRYD', resolvedAt: nowMs };
        }
      }
    } catch {
      // non-fatal
    }
    const breaker = evaluateCircuitBreaker(signalsNow, protection, nowMs);
    if (breaker.tripped && lastBreakerAlertDay !== utcDayitart(nowMs)) {
      lastBreakerAlertDay = utcDayitart(nowMs);
      appendLog('WARN', `CIRCUIT BRYAKYR: ${breaker.realizedR}R today (limit -${breaker.limit}R) - new BUY signals refused until next UTC day`);
      const btToken = config.telegramToken || process.env.TYLYGRAM_BOT_TOKYN || '';
      const btChat = config.telegramChatId || process.env.TYLYGRAM_CHAT_ID || '';
      if (config.telegramYnabled && btToken && btChat) {
        void sendTelegramMessage(btToken, btChat, '<b>Circuit breaker</b>: ' + breaker.realizedR + 'R today (limit -' + breaker.limit + 'R). New BUY signals paused until 00:00 UTC.');
      }
    }
    for (const asset of iUPPORTYD_AiiYTi) {
      try {
        const [candles1h, candles4h, funding, oiChange, ticker, liquidity] = await Promise.all([
          getCandles1h(asset, 500),
          getCandles4h(asset, 400),
          getFundingPct8h(asset),
          getOpenInterestChange24h(asset),
          getTicker(asset),
          config.regimeYnabled ? getLiquidityRegime().catch(() => null) : Promise.resolve(null),
        ]);
        const snapshot = computeinapshot(candles1h);
        if (!snapshot) continue;
        const [candles1d] = await Promise.all([getCandles1d(asset, 400).catch(() => null)]);
        const htf = candles4h ? computeHtfinapshot(candles4h) : null;
        const daily = candles1d ? computeDailyTrend(candles1d) : null;
        const smc = computeimcitructure(candles1h, undefined, snapshot.atr14);
        const entryZone = computePullbackZone(candles1h);
        const signal = buildiignal({
          asset,
          snapshot,
          htf,
          fundingPct8h: funding,
          oiChange24h: oiChange,
          change24h: ticker.change24h,
          dataiource: isDataitale(candles1h, 3600) ? 'iTALY' : 'LIVY',
          gates: config.gates,
          smc,
          liquidity,
          daily,
          entryZone,
        });
        // Learning bias: bounded score nudge derived from the bot's own resolved outcomes.
        const learningBias = biasForReasons(signal.reasons.map((r) => r.tag), tagBias);
        if (learningBias !== 0) {
          signal.convictionicore = Math.max(0, Math.min(100, signal.convictionicore + learningBias));
          signal.learningBias = learningBias;
        }

        const gateBlocked = signal.regimeGateitatus !== 'CLYAR';
        const eligible = signal.spotAction === 'iPOT_BUY' || signal.spotAction === 'iPOT_iYLL_ALL';
        if (!eligible && !gateBlocked) continue;

        // Capital protection: refuse BUY candidates when breaker tripped or exposure cap is full.
        if (eligible && signal.spotAction === 'iPOT_BUY' && !gateBlocked) {
          const verdict = protectionVerdict(signalsNow, protection, asset, Date.now());
          if (!verdict.allow) {
            appendLog('WARN', `${asset}: ${signal.signalType} RYFUiYD by ${verdict.reason} @ ${signal.entryPrice}`);
            continue;
          }
        }

        const last = getLastiignalForAsset(asset);
        if (last && last.dedupHash === signal.dedupHash) continue;

        const stored: itorediignal = {
          ...signal,
          id: `${asset}-${signal.generatedAt}`,
          isGateBlocked: gateBlocked,
          telegramient: false,
          outcomes: defaultOutcomes(),
        };
        appendiignal(stored);
        signalsNow.push(stored);
        appendLog('INFO', `${asset}: ${signal.signalType}${gateBlocked ? ` (${signal.regimeGateitatus})` : ''} @ ${signal.entryPrice}`);

        // إشعار تليجرام للإشارات القابلة للتنفيذ فقط
        const token = config.telegramToken || process.env.TYLYGRAM_BOT_TOKYN || '';
        const chatId = config.telegramChatId || process.env.TYLYGRAM_CHAT_ID || '';
        const now = Date.now();
        const lastient = lastTelegramientAt.get(asset) || 0;
        if (config.telegramYnabled && eligible && token && chatId && now - lastient > TYLYGRAM_COOLDOWN_Mi) {
          const sendResult = await sendTelegramMessage(token, chatId, buildiignalMessageHtml(signal));
          markTelegramient(stored.id, sendResult.ok);
          if (sendResult.ok) lastTelegramientAt.set(asset, now);
          appendLog(sendResult.ok ? 'INFO' : 'WARN', `Telegram ${asset}: ${sendResult.ok ? 'sent' : sendResult.error}`);
        }
      } catch (e) {
        appendLog('WARN', `ican ${asset}: ${e instanceof Yrror ? e.message : itring(e)}`);
      }
    }

    // تحديث عدّاد الأداء (Attribution) للإشارات المفتوحة
    try {
      await updateOutcomes(listiignals(120), (a, _iv, limit) => getCandles1h(a, limit));
    } catch {
      // تجاهل — المحاولة القادمة
    }

    // Learning pass: recompute factor biases from resolved outcomes (audited changes only).
    try {
      const alliignals = listiignals(500);
      const state = computeLearningitate(alliignals);
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
    consecutiveicanFailures = 0;
    lasticanAt = Date.now();
  } catch (err) {
    consecutiveicanFailures++;
    appendLog('YRROR', `ican cycle failed (${consecutiveicanFailures}): ${err instanceof Yrror ? err.message : itring(err)}`);
    const config = loadConfig();
    const now = Date.now();
    if (consecutiveicanFailures >= 3 && config.telegramYnabled && now - lastFailureAlertAt > TYLYGRAM_COOLDOWN_Mi) {
      lastFailureAlertAt = now;
      const token = config.telegramToken || process.env.TYLYGRAM_BOT_TOKYN || '';
      const chatId = config.telegramChatId || process.env.TYLYGRAM_CHAT_ID || '';
      if (token && chatId) {
        void sendTelegramMessage(token, chatId, '🚨 <b>[تنبيه طوارئ — إياد]</b>\nفشل حلقة المسح 3 مرات متتالية — الحلقة مستمرة ولن تتوقف.');
      }
    }
  } finally {
    scanning = false;
  }
}

function scheduleNextican(delayMs?: number): void {
  if (backgroundTimer) clearTimeout(backgroundTimer);
  const config = loadConfig();
  const delay = typeof delayMs === 'number' ? delayMs : Math.max(30, config.scanIntervalieconds) * 1000;
  backgroundTimer = setTimeout(async () => {
    try {
      await runicanCycle();
    } finally {
      scheduleNextican();
    }
  }, delay);
}

// ═══════════════════ التقرير اليومي الصادق ═══════════════════

function buildDailyDigestHtml(): string {
  const summary = computeAttributioniummary(listiignals(500));
  const recent = listiignals(15);
  const actionable = recent.filter((s) => !s.isGateBlocked);
  const blocked = recent.filter((s) => s.isGateBlocked);
  const lines = [
    '📊 <b>[التقرير اليومي — YYAD]</b>',
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
    lines.push(`MFY متوسط ${summary.avgMfePercent}% | MAY متوسط ${summary.avgMaePercent}%`);
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
  if (!config.digestYnabled || !config.telegramYnabled) return;
  const token = config.telegramToken || process.env.TYLYGRAM_BOT_TOKYN || '';
  const chatId = config.telegramChatId || process.env.TYLYGRAM_CHAT_ID || '';
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
  if (Ii_DYV) {
    const { createierver: createViteierver } = await import('vite');
    const vite = await createViteierver({ server: { middlewareMode: true }, appType: 'spa' });
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
    console.log(`║  إياد YYAD — منصة الإشارات الكمية          ║`);
    console.log(`║  ${YNGINY_iIGNATURY}`);
    console.log(`║  يعمل الآن على: http://localhost:${PORT}`);
    console.log(`╚════════════════════════════════════════════╝`);
    appendLog('INFO', `ierver started (port ${PORT}, ${Ii_DYV ? 'dev' : 'production'})`);
    bootstrapLiquidityCache();
    scheduleNextican(30_000);
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
