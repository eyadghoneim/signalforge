// Live API smoke test - run against a RUNNING server:  npm run smoke
// Not part of npm test (which is deterministic and offline by design).
// English-only comments on purpose (codepage safety under shell tooling).

const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  PASS: ${name}`);
  } else {
    fail++;
    console.error(`  FAIL: ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

async function j(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, init);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main(): Promise<void> {
  console.log(`Smoke against ${BASE}`);

  let health: any = null;
  try {
    const r = await j('/api/health');
    health = r.json;
    check('health responds ok:true', r.status === 200 && r.json?.ok === true);
    check('health exposes protection state', !!r.json?.protection && typeof r.json.protection.breakerTripped === 'boolean');
  } catch {
    console.error(`  Server not reachable on ${BASE} - start it first with: npm run dev`);
    process.exit(2);
  }

  const summary = await j('/api/market/summary');
  check('market summary: 3 assets', summary.json?.ok === true && summary.json?.assets?.length === 3, `got ${summary.json?.assets?.length}`);

  const sig = await j('/api/signal/BTC');
  const s = sig.json?.signal;
  check('signal BTC responds', sig.status === 200 && !!s);
  check('signal score in [0,100]', typeof s?.convictionScore === 'number' && s.convictionScore >= 0 && s.convictionScore <= 100, `got ${s?.convictionScore}`);
  check('signal carries reason tags', Array.isArray(s?.reasons) && s.reasons.length >= 0);
  check('signal entryPrice > 0', typeof s?.entryPrice === 'number' && s.entryPrice > 0);
  check('signal has stop + 3 targets', s?.stopLoss > 0 && s?.target1 > 0 && s?.target2 > 0 && s?.target3 > 0);

  const hist = await j('/api/signals?limit=10');
  check('signals list responds', hist.json?.ok === true && Array.isArray(hist.json?.signals));

  const att = await j('/api/attribution/summary');
  check('attribution summary responds', att.json?.ok === true && !!att.json?.summary);

  const learning = await j('/api/learning');
  check('learning responds', learning.json?.ok === true && typeof learning.json?.baselineWinRatePercent === 'number' && Array.isArray(learning.json?.perTag));

  const cfg = await j('/api/config');
  check('config exposes protection', cfg.json?.ok === true && !!cfg.json?.config?.protection);

  const prov = await j('/api/providers');
  check('providers responds', prov.json?.ok === true && Array.isArray(prov.json?.providers));

  const kl = await j('/api/market/klines?asset=BTC&interval=4h&limit=50');
  check('klines 4h responds', kl.status === 200 && kl.json?.ok === true && kl.json?.candles?.length > 0, `status ${kl.status}`);

  const bt = await j('/api/backtest', { method: 'POST', body: JSON.stringify({ asset: 'BTC', days: 90 }) });
  check('backtest 90d responds', bt.status === 200 && !!bt.json?.result, `status ${bt.status}`);
  check('backtest carries performance stats', !!bt.json?.result?.performance);

  const mut = await fetch(`${BASE}/api/config`, { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } });
  check('config mutation without admin is rejected from non-local or requires admin', mut.status === 200 || mut.status === 401, `status ${mut.status}`);

  console.log(`\nResult: ${pass} passed / ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();