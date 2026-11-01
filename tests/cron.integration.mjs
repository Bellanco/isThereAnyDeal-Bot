import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cron integration: `wrangler dev --test-scheduled` with REAL local D1 (Miniflare) and the
 * in-memory ITAD/OAuth/Telegram simulation (APP_MODE=local-integration). Loopback only,
 * temporary HOME/state, no credentials, no remote resources, no real network calls.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const config = path.join(root, 'wrangler.local-integration.jsonc');
const database = 'itad-local-integration';
let temporary;
let persist;
let child;
let baseUrl;
let childOutput = '';
/** Successful Telegram sends reported by every cycle summary (all worker sessions). */
let reportedSends = 0;

function localEnvironment() {
  const allowed = new Set(['path', 'systemroot', 'windir', 'temp', 'tmp']);
  const environment = Object.fromEntries(
    Object.entries(globalThis.process.env).filter(([key]) => allowed.has(key.toLowerCase())),
  );
  environment.TEMP ??= os.tmpdir();
  environment.TMP ??= os.tmpdir();
  environment.HOME = temporary;
  environment.USERPROFILE = temporary;
  environment.APPDATA = temporary;
  environment.LOCALAPPDATA = temporary;
  environment.WRANGLER_HIDE_BANNER = 'true';
  environment.WRANGLER_SEND_METRICS = 'false';
  return environment;
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('port_unavailable'));
      const { port } = address;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function cliRun(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [cli, ...args], {
      cwd: root, windowsHide: true, env: localEnvironment(),
    });
    let output = '';
    process.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    process.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
    process.once('error', reject);
    process.once('exit', code => {
      if (code === 0) resolve(output);
      else reject(new Error(`wrangler_exit_${code}: ${output.slice(-4000)}`));
    });
  });
}

async function query(sql) {
  const output = await cliRun([
    'd1', 'execute', database, '--local', '--persist-to', persist, '--config', config, '--json', '--command', sql,
  ]);
  const start = output.indexOf('[');
  const parsed = JSON.parse(output.slice(start));
  return parsed[0].results;
}

function stopWorker() {
  if (!child) return Promise.resolve();
  const current = child;
  child = undefined;
  reportedSends += summaries(childOutput).reduce((total, item) => total + (item.sent ?? 0), 0);
  if (current.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    current.once('exit', () => resolve());
    current.kill();
    setTimeout(() => {
      if (current.exitCode === null) current.kill('SIGKILL');
    }, 5000).unref();
  });
}

function localGet(pathname, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const request = httpRequest({
      hostname: '127.0.0.1', port: Number(url.port), path: `${url.pathname}${url.search}`, method: 'GET', timeout,
    }, response => {
      let data = '';
      response.setEncoding('utf8').on('data', chunk => { data += chunk; });
      response.once('end', () => resolve({ status: response.statusCode, body: data }));
    });
    request.once('timeout', () => request.destroy(new Error('local_worker_timeout')));
    request.once('error', reject);
    request.end();
  });
}

async function scheduled() {
  const before = childOutput.length;
  // Local cron is every minute (I6): ITAD is queried only when the durable gate is due.
  const response = await localGet('/__scheduled?cron=*+*+*+*+*');
  // Allow the sanitized summary line to reach stdout.
  for (let i = 0; i < 40 && !/"event":"bridge_cycle/.test(childOutput.slice(before)); i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { status: response.status, log: childOutput.slice(before) };
}

function summaries(log) {
  return [...log.matchAll(/\{"event":"bridge_cycle[^\n]*\}/g)].map(match => JSON.parse(match[0]));
}

async function startWorker(vars = []) {
  const port = await allocatePort();
  childOutput = '';
  child = spawn(globalThis.process.execPath, [
    cli, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--test-scheduled',
    '--persist-to', persist, '--config', config, ...vars.flatMap(item => ['--var', item]),
  ], { cwd: root, windowsHide: true, env: localEnvironment() });
  child.stdout.setEncoding('utf8').on('data', chunk => { childOutput += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { childOutput += chunk; });
  child.once('error', error => { childOutput += String(error); });
  baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler_dev_exited: ${childOutput.slice(-4000)}`);
    try {
      // The fetch handler stays the mock contract: local-integration config is rejected with 503.
      const health = await localGet('/', 2000);
      if (health.status === 503) return;
    } catch { /* Retry only the local startup readiness probe. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`wrangler_dev_not_ready: ${childOutput.slice(-4000)}`);
}

function assertSanitized(log) {
  assert.doesNotMatch(log, /local-sim-(access|refresh)|local-simulation-api-key|Juego simulado|Bundle simulado|Juego de bundle|example\.invalid|sendMessage|sendRichMessage|rich_message|1:local-simulation/);
}

/** Local time travel of the durable gate only (no lease held): the next tick is due. */
async function makePollDue() {
  await query("UPDATE poll_gate SET next_poll_at = 0 WHERE gate_key = 'itad_poll' AND owner IS NULL");
}

/** Same for the hourly bundle check (the poll gate must be due too for it to run). */
async function makeBundlesDue() {
  await query("UPDATE bundle_state SET next_check_at = 0 WHERE state_key = 'bundles'");
}

/** Every request to ITAD or its OAuth endpoint in one cycle (everything except Telegram). */
const ITAD_CALLS = item => Object.entries(item.calls)
  .filter(([name]) => name !== 'telegramSend')
  .reduce((total, [, value]) => total + value, 0);

async function counts() {
  const [row] = await query(`SELECT
    (SELECT COUNT(*) FROM known_notifications WHERE source = 'baseline' AND notification_id NOT LIKE 'bundle:%') AS baseline,
    (SELECT COUNT(*) FROM known_notifications WHERE source = 'new' AND notification_id NOT LIKE 'bundle:%') AS discovered,
    (SELECT COUNT(*) FROM known_notifications WHERE source = 'baseline' AND notification_id LIKE 'bundle:%') AS bundleBaseline,
    (SELECT COUNT(*) FROM known_notifications WHERE source = 'new' AND notification_id LIKE 'bundle:%') AS bundlesNew,
    (SELECT COUNT(*) FROM bundle_state) AS bundleMarker,
    (SELECT COUNT(*) FROM delivery_parts WHERE format <> 'rich_html') AS textParts,
    (SELECT COUNT(*) FROM delivery_parts WHERE status = 'confirmed') AS confirmed,
    (SELECT COUNT(DISTINCT receipt) FROM delivery_parts WHERE status = 'confirmed') AS receipts,
    (SELECT COUNT(*) FROM delivery_parts WHERE status <> 'confirmed') AS open,
    (SELECT COUNT(*) FROM delivery_parts WHERE blocked_category IS NOT NULL) AS blocked,
    (SELECT COUNT(*) FROM bridge_flags) AS flags,
    (SELECT session_version FROM oauth_credentials) AS session,
    (SELECT COUNT(*) FROM oauth_credentials WHERE ciphertext LIKE '%local-sim%') AS plaintext`);
  return row;
}

async function main() {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'itad-cron-i6-'));
  persist = path.join(temporary, 'state');
  await cliRun(['d1', 'migrations', 'apply', database, '--local', '--persist-to', persist, '--config', config]);
  const [seeded] = await query("SELECT next_poll_at, owner FROM poll_gate WHERE gate_key = 'itad_poll'");
  assert.deepEqual({ ...seeded }, { next_poll_at: 0, owner: null }, 'migration 0004 seeds a due gate');

  // 1. First tick: gate due, atomic baseline, no historical sends, OAuth rotated into the envelope.
  await startWorker();
  const first = await scheduled();
  assert.equal(first.status, 200, first.log.slice(-2000));
  const [baseline] = summaries(first.log);
  assert.equal(baseline.poll, 'baseline_initialized');
  assert.equal(baseline.pollGate, 'claimed');
  assert.equal(baseline.sent, 0);
  assert.equal(baseline.oauthRefreshed, true);
  assert.ok(baseline.nextPollInSeconds > 230 && baseline.nextPollInSeconds <= 300, JSON.stringify(baseline));
  // The first bundle listing is recorded the same way: known, never notified, no Waitlist/Collection reads.
  assert.equal(baseline.ok, true, JSON.stringify(baseline.errors));
  assert.deepEqual(baseline.bundles, { state: 'baseline_initialized', listed: 2, baselineRecorded: 2, seen: 0, planned: 0, invalid: 0 });
  assert.equal(baseline.calls.itadBundles, 1);
  assert.equal(baseline.calls.itadWaitlistGames + baseline.calls.itadCollection, 0);
  assertSanitized(first.log);

  // 2. Immediate next tick: not due -> no OAuth read/refresh, no ITAD list/detail/bundles at all.
  const idle = summaries((await scheduled()).log)[0];
  assert.equal(idle.poll, 'not_due');
  assert.equal(idle.bundles.state, 'idle');
  assert.equal(ITAD_CALLS(idle), 0, JSON.stringify(idle));

  // 3. Due tick discovers simulated notice 1 (single part); next due tick discovers notice 2 (20 parts).
  await makePollDue();
  const small = summaries((await scheduled()).log)[0];
  assert.equal(small.poll, 'listed');
  assert.equal(small.calls.itadList, 1);
  assert.equal(small.detailsPlanned, 1);
  assert.equal(small.calls.itadWaitlistGames, 1, 'banners need the Waitlist once');
  assert.equal(small.bundles.state, 'not_due', 'the hourly bundle gate is separate from the five-minute poll');
  assert.equal(small.calls.itadBundles, 0);
  await makePollDue();
  const progress = [];
  let started = Date.now();
  for (let tick = 0; tick < 12; tick++) {
    const t0 = Date.now();
    const result = await scheduled();
    assert.equal(result.status, 200, result.log.slice(-2000));
    assertSanitized(result.log);
    const [item] = summaries(result.log);
    progress.push({
      tick: tick + 1, poll: item.poll, calls: item.calls, sent: item.sent,
      pendingParts: item.queue.pendingParts, wallMs: Date.now() - t0,
    });
    if (item.queue.pendingParts === 0) break;
  }
  const drainMs = Date.now() - started;
  assert.equal(progress[0].poll, 'listed');
  assert.equal(progress[0].calls.itadDetail, 1);
  assert.equal(progress[0].calls.itadWaitlistGames, 1);
  assert.deepEqual(progress.map(item => item.sent), [3, 3, 3, 3, 3, 3, 2], JSON.stringify(progress));
  for (const item of progress.slice(1)) {
    assert.equal(item.poll, 'not_due');
    assert.equal(ITAD_CALLS(item), 0, 'drain ticks never query ITAD/OAuth');
  }
  console.log(`I6 local cron 20-part progress (ticks triggered back to back, ${drainMs} ms total): ${JSON.stringify(progress)}`);
  await stopWorker();
  let state = await counts();
  assert.equal(state.baseline, 2);
  assert.equal(state.discovered, 2);
  assert.equal(state.bundleMarker, 1);
  assert.equal(state.bundleBaseline, 2);
  assert.equal(state.bundlesNew, 0, 'the bundle baseline is never notified');
  assert.equal(state.textParts, 0, 'every planned part is Rich HTML');
  assert.equal(state.plaintext, 0);
  assert.equal(state.session, 2);
  assert.equal(state.open, 0, JSON.stringify(state));
  assert.equal(state.receipts, state.confirmed, 'every confirmed part has its own Telegram receipt');
  assert.equal(reportedSends, state.confirmed, 'every successful send was confirmed exactly once');
  const [banner] = await query("SELECT text FROM delivery_parts WHERE notification_id = '00000000-0000-4000-a000-000000000001' AND part_index = 0");
  assert.match(banner.text, /<img[^>]*banner-1-0\.jpg/, 'the Waitlist banner reaches the stored Rich HTML');

  // 4. Restart (new isolate, same local D1): gate state survives; no baseline repetition, no resend.
  await startWorker();
  const before = state.confirmed;
  const restarted = summaries((await scheduled()).log)[0];
  assert.equal(restarted.poll, 'not_due', 'the durable gate (not memory) decides after a restart');
  assert.equal(ITAD_CALLS(restarted), 0);
  // The restarted simulation lists notices 1..n-1 again; due ticks until notice 5 (20 parts) is planned.
  // Runs 0 and 1 also force the hourly bundle check: the restarted bundle feed first lists only the
  // baseline bundles (nothing is new, no baseline again), then adds bundle 9101 (Waitlist + Collection game).
  for (let run = 0; run < 6; run++) {
    await makePollDue();
    if (run < 2) await makeBundlesDue();
    const result = await scheduled();
    assert.equal(result.status, 200, result.log.slice(-2000));
    assertSanitized(result.log);
    const [item] = summaries(result.log);
    assert.equal(item.pollGate, 'claimed');
    assert.notEqual(item.poll, 'baseline_initialized');
    assert.equal(item.ok, true, JSON.stringify(item.errors));
    if (run === 0) {
      assert.deepEqual(item.bundles, { state: 'checked', listed: 2, baselineRecorded: 0, seen: 0, planned: 0, invalid: 0 });
      assert.equal(item.calls.itadBundles, 1);
      assert.equal(item.calls.itadWaitlistGames + item.calls.itadCollection, 0, 'nothing new: no Waitlist/Collection reads');
      assert.equal(item.sent, 0);
    } else if (run === 1) {
      assert.deepEqual(item.bundles, { state: 'checked', listed: 3, baselineRecorded: 0, seen: 0, planned: 1, invalid: 0 });
      assert.equal(item.calls.itadBundles, 1);
      assert.equal(item.calls.itadWaitlistGames, 1);
      assert.equal(item.calls.itadCollection, 1);
      assert.deepEqual(item.warnings, []);
      assert.equal(item.sent, 1, 'the bundle notice is one Rich part');
    } else {
      assert.equal(item.bundles.state, 'not_due', 'the next bundle check is an hour away');
      assert.equal(item.calls.itadBundles, 0);
    }
  }
  // 5. Overlapping ticks at a due instant: one gate owner; shared leases and durable throttle.
  await makePollDue();
  const mark = childOutput.length;
  const overlapping = await Promise.all([scheduled(), scheduled(), scheduled()]);
  for (const item of overlapping) assert.ok([200, 500].includes(item.status));
  for (let i = 0; i < 40 && summaries(childOutput.slice(mark)).length < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const concurrent = summaries(childOutput.slice(mark));
  assert.equal(concurrent.length, 3);
  assert.equal(concurrent.filter(item => item.pollGate === 'claimed').length, 1, JSON.stringify(concurrent));
  assert.equal(concurrent.reduce((total, item) => total + item.calls.itadList, 0), 1);
  assert.equal(concurrent.reduce((total, item) => total + item.calls.itadBundles, 0), 0, 'the hourly bundle gate is not due');
  await stopWorker();
  state = await counts();
  assert.ok(state.confirmed > before, JSON.stringify(state));
  assert.ok(state.open > 0, 'parts of notice 5 remain pending for the next ticks');
  assert.equal(state.receipts, state.confirmed, 'no part confirmed twice');
  assert.equal(reportedSends, state.confirmed, 'overlapping runs never sent a part twice');
  assert.equal(state.blocked, 0);
  assert.equal(state.flags, 0);
  // Bundles survive restarts: one marker, the baseline untouched, only 9101 notified, exactly once.
  assert.equal(state.bundleMarker, 1);
  assert.equal(state.bundleBaseline, 2);
  assert.equal(state.bundlesNew, 1);
  assert.equal(state.textParts, 0);
  const bundleParts = await query("SELECT part_index, status, format, text FROM delivery_parts WHERE notification_id = 'bundle:9101' ORDER BY part_index");
  assert.equal(bundleParts.length, 1);
  const [bundlePart] = bundleParts;
  assert.deepEqual({ status: bundlePart.status, format: bundlePart.format }, { status: 'confirmed', format: 'rich_html' });
  assert.ok(bundlePart.text.includes('Juego de bundle 9101.1</a></p><p>en tu lista de deseos · en tu Colección</p>'), bundlePart.text);
  assert.ok(bundlePart.text.includes('Juego de bundle 9101.2</a></p>'), 'the other game has no marks');
  assert.ok(bundlePart.text.includes('url="https://example.invalid/sim/bundle-9101?ref=affiliate-sim&amp;tier=1"'), 'the store link keeps its affiliate parameters');
  const [throttle] = await query("SELECT next_allowed_at FROM chat_throttle WHERE chat_key = 'telegram'");
  assert.ok(Number.isSafeInteger(throttle.next_allowed_at));
  const [gate] = await query("SELECT owner, lease_expires_at, last_outcome FROM poll_gate WHERE gate_key = 'itad_poll'");
  assert.deepEqual({ ...gate }, { owner: null, lease_expires_at: null, last_outcome: 'listed' });

  // 6. Simulated Telegram 429 on a drain tick: explicit failure, retry_after persisted, nothing lost.
  await startWorker(['SIMULATION_TELEGRAM_FAILURE:rate-limit', 'SIMULATION_FAIL_AT:1']);
  const limited = await scheduled();
  assert.equal(limited.status, 500, 'a failed cycle is surfaced, never a silent success');
  const [limitedSummary] = summaries(limited.log);
  assert.equal(limitedSummary.ok, false);
  assert.equal(limitedSummary.poll, 'not_due');
  assert.equal(limitedSummary.deliveryStop, 'rate_limited');
  assert.ok(limitedSummary.errors.some(item => item.startsWith('telegram_rate_limit')));
  assertSanitized(limited.log);
  await new Promise(resolve => setTimeout(resolve, 3500));
  const recovered = await scheduled();
  assert.equal(recovered.status, 200, recovered.log.slice(-2000));
  await stopWorker();
  const [deferred] = await query("SELECT COUNT(*) AS n FROM delivery_parts WHERE last_category = 'rate_limit' AND attempts = 0");
  assert.ok(deferred.n >= 1);

  // 7. Simulated 403: delivery halted with an explicit flag, part kept pending.
  await startWorker(['SIMULATION_TELEGRAM_FAILURE:forbidden', 'SIMULATION_FAIL_AT:1']);
  const forbidden = await scheduled();
  assert.equal(forbidden.status, 500);
  await stopWorker();
  const flags = await query('SELECT flag_key, category FROM bridge_flags');
  assert.deepEqual(flags.map(row => ({ ...row })), [{ flag_key: 'delivery_halt', category: 'telegram_forbidden' }]);
  state = await counts();
  assert.ok(state.open > 0, 'halted delivery keeps parts pending');
  assert.equal(reportedSends, state.confirmed);

  console.log('Cron local: 1 suite passed; seeded gate, baseline/no history (notices and bundles), not-due ticks without ITAD/OAuth, Rich 20-part drain in 7 ticks, restart without repeating baselines, hourly bundle notice with Waitlist/Collection marks, overlapping ticks (one gate owner), 429 retry_after and 403 halt checks passed on local D1.');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'cron_integration_failed');
  if (childOutput) console.error(childOutput.slice(-4000));
  process.exitCode = 1;
} finally {
  await stopWorker();
  if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
