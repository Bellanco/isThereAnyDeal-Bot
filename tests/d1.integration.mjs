import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const config = path.join(root, 'wrangler.d1-test.jsonc');
const migrations = ['0001_i4_storage.sql', '0002_i5_delivery.sql', '0003_i6_detail_claims.sql', '0004_i6_poll_gate.sql'].map(name => path.join(root, 'migrations', name));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = 1_800_000_000_000;
let temporary;
let persist;
let child;
let baseUrl;
let childOutput = '';

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
      cwd: root, windowsHide: true,
      env: localEnvironment(),
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

function stopWorker() {
  if (!child) return Promise.resolve();
  const current = child;
  child = undefined;
  if (current.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    current.once('exit', () => resolve());
    current.kill();
    setTimeout(() => {
      if (current.exitCode === null) current.kill('SIGKILL');
    }, 5000).unref();
  });
}

function localPost(value) {
  return new Promise((resolve, reject) => {
    const url = new URL('/__d1-test', baseUrl);
    const payload = JSON.stringify(value);
    const request = httpRequest({
      hostname: '127.0.0.1', port: Number(url.port), path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 5000,
    }, response => {
      let data = '';
      response.setEncoding('utf8').on('data', chunk => { data += chunk; });
      response.once('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error('invalid_local_worker_response')); }
      });
    });
    request.once('timeout', () => request.destroy(new Error('local_worker_timeout')));
    request.once('error', reject);
    request.end(payload);
  });
}

async function call(action, fields = {}, expectedStatus = 200) {
  const result = await localPost({ action, ...fields });
  assert.equal(result.status, expectedStatus, `${action}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function startWorker() {
  const port = await allocatePort();
  childOutput = '';
  child = spawn(globalThis.process.execPath, [
    cli, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', persist, '--config', config,
  ], {
    cwd: root, windowsHide: true,
    env: localEnvironment(),
  });
  child.stdout.setEncoding('utf8').on('data', chunk => { childOutput += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { childOutput += chunk; });
  child.once('error', error => { childOutput += String(error); });
  baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler_dev_exited: ${childOutput.slice(-4000)}`);
    try {
      const health = await localPost({ action: 'health' });
      if (health.status === 200 && health.body.ready === true) return;
    } catch { /* Retry only the local startup readiness probe. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`wrangler_dev_not_ready: ${childOutput.slice(-4000)}`);
}

function detail(id) {
  return {
    id,
    timestamp: '2026-10-31T12:00:00Z',
    read: '2026-10-31T12:05:00Z',
    games: [
      { id: 'fake-game-1', slug: 'fixture-game-one', title: 'Juego ficticio ñ', type: 'game',
        mature: false, historyLow: null, lastPrice: null,
        deals: [{ shop: { id: 1, name: 'Tienda ficticia' },
          price: { amount: 1.25, amountInt: 125, currency: 'EUR' },
          regular: { amount: 10, amountInt: 1000, currency: 'EUR' }, cut: 88,
          voucher: null, storeLow: null, flag: null, drm: [], platforms: [],
          timestamp: '2026-10-31T12:00:00Z', expiry: null,
          url: 'https://example.invalid/deal?a=affiliate-fixture' }] },
      { id: 'fake-game-2', slug: 'fixture-game-two', title: 'Otro juego ficticio',
        type: 'package', mature: false, historyLow: null, lastPrice: null,
        deals: [{ shop: { id: 2, name: 'Otra tienda ficticia' },
          price: { amount: 2, amountInt: 200, currency: 'USD' },
          regular: { amount: 20, amountInt: 2000, currency: 'USD' }, cut: 90,
          voucher: 'FIXTURE', storeLow: null, flag: 'H', drm: [], platforms: [],
          timestamp: '2026-10-31T12:01:00Z', expiry: null,
          url: 'https://example.invalid/another?ref=fixture' }] },
    ],
  };
}

async function main() {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'itad-d1-i4-'));
  persist = path.join(temporary, 'state');
  for (const migration of migrations) {
    await cliRun([
      'd1', 'execute', 'itad-i4-test', '--local', '--yes', '--persist-to', persist,
      '--config', config, '--file', migration,
    ]);
  }
  await startWorker();

  const baselineA = uuid(1);
  const baselineB = uuid(2);
  const badBaseline = uuid(3);
  await call('failBaselineOnId', { id: badBaseline });
  const rolledBackBaseline = await localPost({ action: 'baseline', ids: [baselineA, badBaseline], now });
  assert.notEqual(rolledBackBaseline.status, 200, 'baseline batch failure must reject');
  assert.equal((await call('baselineComplete')).complete, false);
  assert.deepEqual((await call('knownNotifications')).notifications, [], 'failed baseline inserts no IDs');
  await call('clearBaselineFailure');
  assert.equal((await call('baseline', { ids: [baselineA, baselineB], now })).result, 'initialized');
  assert.equal((await call('baselineComplete')).complete, true);
  const baselineRows = [
    { notification_id: baselineA, source: 'baseline' },
    { notification_id: baselineB, source: 'baseline' },
  ];
  assert.deepEqual((await call('knownNotifications')).notifications, baselineRows);
  assert.equal((await call('baseline', { ids: [uuid(99)], now })).result, 'already-initialized');
  assert.deepEqual((await call('knownNotifications')).notifications, baselineRows, 'restart or repeat never extends baseline');
  assert.deepEqual((await call('discover', { ids: [baselineA], now: now + 1 })).pending, []);

  const newId = uuid(10);
  const failedDetailId = uuid(11);
  assert.deepEqual((await call('discover', { ids: [newId], now: now + 2 })).pending, [newId]);
  assert.deepEqual((await call('discover', { ids: [newId, newId], now: now + 3 })).pending, [newId]);
  assert.deepEqual((await call('discover', { ids: [failedDetailId], now: now + 4 })).pending, [failedDetailId]);
  assert.deepEqual((await call('pendingDetails')).ids, [failedDetailId, newId].sort());
  const fullDetail = detail(newId);
  const parts = ['Parte 1 completa ñ', 'Parte 2 con todos sus juegos y ofertas', 'Parte 3 con enlace https://example.invalid/x?a=1'];
  await call('failPlanAtPart', { index: 1 });
  const failedPlan = await localPost({ action: 'savePlan', id: newId, detail: fullDetail, parts });
  assert.notEqual(failedPlan.status, 200, 'plan batch failure must reject');
  assert.deepEqual((await call('pendingDetails')).ids, [failedDetailId, newId].sort(), 'failed detail plan remains pending');
  assert.equal((await call('plan', { id: newId })).plan, null);
  assert.deepEqual((await call('parts', { id: newId })).parts, []);
  await call('clearPlanFailure');
  await call('savePlan', { id: newId, detail: fullDetail, parts });
  await call('savePlan', { id: newId, detail: fullDetail, parts });
  assert.deepEqual((await call('plan', { id: newId })).plan, { detail: fullDetail, parts });
  assert.equal((await call('parts', { id: newId })).parts.length, parts.length);
  assert.deepEqual((await call('pendingDetails')).ids, [failedDetailId]);

  const contenders = await Promise.all([
    call('claimPart', { id: newId, index: 0, owner: 'worker-a', now: now + 10 }),
    call('claimPart', { id: newId, index: 0, owner: 'worker-b', now: now + 10 }),
  ]);
  assert.equal(contenders.filter(item => item.status === 'claimed').length, 1);
  assert.equal(contenders.filter(item => item.status === 'busy').length, 1);
  const firstClaim = contenders.find(item => item.status === 'claimed').claim;
  assert.equal(firstClaim.expiresAt, now + 10 + 120_000);
  assert.equal(await (await localPost({
    action: 'confirmPart', claim: firstClaim, receipt: 'receipt-fixture-1', now: now + 11,
  })).body.confirmed, true);
  assert.equal((await call('claimPart', { id: newId, index: 0, owner: 'worker-c', now: now + 12 })).status, 'confirmed');

  const expiring = (await call('claimPart', {
    id: newId, index: 1, owner: 'old-worker', now: now + 100,
  })).claim;
  assert.equal((await call('confirmPart', {
    claim: expiring, receipt: 'too-late', now: expiring.expiresAt,
  })).confirmed, false);
  const replacement = (await call('claimPart', {
    id: newId, index: 1, owner: 'old-worker', now: expiring.expiresAt,
  })).claim;
  assert.ok(replacement.version > expiring.version);
  assert.equal((await call('confirmPart', {
    claim: expiring, receipt: 'stale-receipt', now: expiring.expiresAt - 1,
  })).confirmed, false);
  assert.equal((await call('releasePart', {
    claim: expiring, now: expiring.expiresAt - 1,
  })).released, false);
  assert.equal((await call('releasePart', {
    claim: replacement, now: replacement.expiresAt - 1,
  })).released, true);
  const expiringAgain = (await call('claimPart', {
    id: newId, index: 1, owner: 'expiry-worker', now: now + 500,
  })).claim;
  const afterExpiry = (await call('claimPart', {
    id: newId, index: 1, owner: 'recovery-worker', now: expiringAgain.expiresAt,
  })).claim;
  assert.ok(afterExpiry.version > expiringAgain.version);
  assert.equal((await call('releasePart', {
    claim: afterExpiry, now: afterExpiry.expiresAt - 1,
  })).released, true);

  // I6: one durable owner per detail query on local D1 (CAS, eligibility/backoff, stale owners).
  const detailOwners = ['detail-a', 'detail-b', 'detail-c', 'detail-d', 'detail-e'];
  const detailContenders = await Promise.all(detailOwners.map(owner =>
    call('claimDetail', { id: failedDetailId, owner, now: now + 600 })));
  assert.equal(detailContenders.filter(item => item.status === 'claimed').length, 1);
  assert.equal(detailContenders.filter(item => item.status === 'busy').length, 4);
  const detailClaim = detailContenders.find(item => item.status === 'claimed').claim;
  assert.equal(detailClaim.expiresAt, now + 600 + 120_000);
  assert.deepEqual((await call('detailWork', { now: now + 601, limit: 10 })).ids, [], 'reserved detail is not offered');
  const detailFailure = { category: 'network', nextAt: now + 60_600, countAttempt: true, permanent: false, maxAttempts: 5 };
  assert.equal((await call('recordDetailFailure', { claim: detailClaim, now: now + 601, options: detailFailure })).outcome, 'deferred');
  assert.equal((await call('recordDetailFailure', { claim: detailClaim, now: now + 602, options: detailFailure })).outcome, 'stale',
    'a released claim cannot consume a second attempt');
  assert.equal((await call('claimDetail', { id: failedDetailId, owner: 'detail-f', now: now + 602 })).status, 'waiting');
  const crashedDetail = (await call('claimDetail', { id: failedDetailId, owner: 'detail-crashed', now: now + 60_600 })).claim;
  assert.ok(crashedDetail.version > detailClaim.version);

  const mockTokens = {
    accessToken: 'mock-access-token-not-real',
    refreshToken: 'mock-refresh-token-not-real',
    expiresAt: now + 3_600_000,
    scope: 'notifications',
  };
  await call('invalidKey', {}, 409);
  assert.equal((await call('initOAuth', { tokens: mockTokens })).result, 'stored');
  assert.equal((await call('initOAuth', { tokens: mockTokens })).result, 'already-stored');
  await call('initOAuthWrongKey', { tokens: mockTokens }, 409);
  await call('initOAuth', {
    tokens: { ...mockTokens, accessToken: 'mock-different-access-not-real' },
  }, 409);
  let raw = (await call('rawOAuth')).row;
  const initialNonce = raw.nonce;
  assert.ok(raw && raw.ciphertext && raw.nonce);
  for (const secret of [mockTokens.accessToken, mockTokens.refreshToken, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=']) {
    assert.equal(JSON.stringify(raw).includes(secret), false, 'D1 must not contain OAuth plaintext or key');
  }

  const refreshClaims = await Promise.all([
    call('claimOAuth', { owner: 'refresh-a', now: now + 1000 }),
    call('claimOAuth', { owner: 'refresh-b', now: now + 1000 }),
  ]);
  assert.equal(refreshClaims.filter(item => item.status === 'claimed').length, 1);
  assert.equal(refreshClaims.filter(item => item.status === 'busy').length, 1);
  const refreshClaim = refreshClaims.find(item => item.status === 'claimed').claim;
  assert.equal(refreshClaim.expiresAt, now + 1000 + 120_000);
  assert.deepEqual(refreshClaim.tokens, mockTokens);
  const rotatedTokens = {
    accessToken: 'mock-rotated-access-token-not-real',
    refreshToken: 'mock-rotated-refresh-token-not-real',
    expiresAt: now + 7_200_000,
    scope: 'notifications',
  };
  assert.equal((await call('commitOAuth', {
    claim: refreshClaim, tokens: rotatedTokens, now: now + 1001,
  })).committed, true);
  assert.equal((await call('commitOAuth', {
    claim: refreshClaim, tokens: mockTokens, now: now + 1002,
  })).committed, false);

  await stopWorker();
  await startWorker();
  assert.equal((await call('baseline', { ids: [uuid(100)], now: now + 2000 })).result, 'already-initialized');
  assert.deepEqual((await call('discover', { ids: [newId], now: now + 2001 })).pending, []);
  assert.deepEqual((await call('plan', { id: newId })).plan, { detail: fullDetail, parts });
  const partStates = (await call('parts', { id: newId })).parts;
  assert.equal(partStates[0].status, 'confirmed');
  assert.equal(partStates[0].receipt, 'receipt-fixture-1');
  assert.equal(partStates[1].status, 'pending');
  const afterRestart = await call('claimOAuth', { owner: 'refresh-after-restart', now: now + 3000 });
  assert.equal(afterRestart.status, 'claimed');
  assert.deepEqual(afterRestart.claim.tokens, rotatedTokens);
  assert.equal(afterRestart.claim.sessionVersion, refreshClaim.sessionVersion + 1);
  raw = (await call('rawOAuth')).row;
  assert.equal(raw.session_version, refreshClaim.sessionVersion + 1);
  assert.notEqual(raw.nonce, initialNonce);
  assert.equal(JSON.stringify(raw).includes(rotatedTokens.refreshToken), false);
  assert.deepEqual((await call('pendingDetails')).ids, [failedDetailId]);
  assert.deepEqual((await call('discover', { ids: [failedDetailId], now: now + 2002 })).pending, [failedDetailId]);
  const retryDetail = detail(failedDetailId);
  const retryParts = ['Detalle recuperado despues del fallo, sin perder datos'];
  // The crashed owner's detail reservation survives the restart and is recovered only after expiry.
  assert.equal((await call('claimDetail', {
    id: failedDetailId, owner: 'detail-recovery', now: crashedDetail.expiresAt - 1,
  })).status, 'busy');
  const recoveredDetail = (await call('claimDetail', {
    id: failedDetailId, owner: 'detail-recovery', now: crashedDetail.expiresAt,
  })).claim;
  assert.ok(recoveredDetail.version > crashedDetail.version);
  assert.equal((await call('recordDetailFailure', {
    claim: crashedDetail, now: crashedDetail.expiresAt - 1, options: detailFailure,
  })).outcome, 'stale');
  assert.equal((await call('releaseDetail', { claim: crashedDetail, now: crashedDetail.expiresAt - 1 })).released, false);
  assert.equal((await call('saveClaimedPlan', {
    claim: crashedDetail, detail: retryDetail, parts: retryParts, now: crashedDetail.expiresAt - 1,
  })).saved, false);
  assert.equal((await call('saveClaimedPlan', {
    claim: recoveredDetail, detail: retryDetail, parts: retryParts, now: crashedDetail.expiresAt + 1,
  })).saved, true);

  const reauthorizedTokens = {
    accessToken: 'mock-reauthorized-access-not-real',
    refreshToken: 'mock-reauthorized-refresh-not-real',
    expiresAt: now + 10_800_000,
    scope: 'notifications',
  };
  const beforeReauthorization = (await call('oauthVersion')).version;
  assert.equal((await call('replaceOAuth', {
    expectedVersion: beforeReauthorization, tokens: reauthorizedTokens,
  })).replaced, true);
  assert.equal((await call('releaseOAuth', {
    claim: afterRestart.claim, now: now + 3001,
  })).released, false, 'reauthorization invalidates a stale refresh owner');
  const reauthorizedClaim = await call('claimOAuth', { owner: 'reauthorized-worker', now: now + 3002 });
  assert.equal(reauthorizedClaim.status, 'claimed');
  assert.deepEqual(reauthorizedClaim.claim.tokens, reauthorizedTokens);
  assert.equal(reauthorizedClaim.claim.sessionVersion, beforeReauthorization + 1);
  assert.equal((await call('releaseOAuth', {
    claim: reauthorizedClaim.claim, now: now + 3003,
  })).released, true);
  const expiringRefresh = (await call('claimOAuth', {
    owner: 'same-refresh-owner', now: now + 4000,
  })).claim;
  assert.equal(expiringRefresh.expiresAt, now + 4000 + 120_000);
  const reclaimedRefresh = await call('claimOAuth', {
    owner: 'same-refresh-owner', now: expiringRefresh.expiresAt,
  });
  assert.equal(reclaimedRefresh.status, 'claimed');
  assert.ok(reclaimedRefresh.claim.version > expiringRefresh.version);
  assert.equal((await call('releaseOAuth', {
    claim: expiringRefresh, now: expiringRefresh.expiresAt,
  })).released, false);
  assert.equal((await call('releaseOAuth', {
    claim: reclaimedRefresh.claim, now: expiringRefresh.expiresAt + 1,
  })).released, true);
  const ciphertext = (await call('rawOAuth')).row.ciphertext;
  const changedCiphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
  await call('tamperOAuth', { column: 'ciphertext', value: changedCiphertext });
  await call('claimOAuth', { owner: 'must-fail-on-tamper', now: now + 3002 }, 409);
  await call('tamperOAuth', { column: 'ciphertext', value: ciphertext });
  await call('wrongKey', { now: now + 3003 }, 409);
  await call('tamperOAuth', { column: 'key_version', value: 'test-key-v2' });
  await call('claimOAuth', { owner: 'must-fail-on-tamper', now: now + 3002 }, 409);

  // I6 durable poll gate (migration 0004) on real local D1: one owner, takeover only after expiry.
  const gateAt = now + 10_000;
  const pollClaims = await Promise.all(['poll-a', 'poll-b', 'poll-c'].map(owner => call('claimPoll', { owner, now: gateAt })));
  assert.equal(pollClaims.filter(item => item.status === 'claimed').length, 1, JSON.stringify(pollClaims));
  assert.equal(pollClaims.filter(item => item.status === 'busy').length, 2);
  const pollA = pollClaims.find(item => item.status === 'claimed').claim;
  assert.equal((await call('claimPoll', { owner: 'poll-d', now: gateAt + 119_999 })).status, 'busy');
  const pollD = await call('claimPoll', { owner: 'poll-d', now: gateAt + 120_000 });
  assert.equal(pollD.status, 'claimed');
  assert.equal((await call('renewPoll', { claim: pollA, now: gateAt + 120_001 })).claim, null);
  assert.equal((await call('completePoll', {
    claim: pollA, now: gateAt + 120_001, nextPollAt: gateAt + 1, outcome: 'listed',
  })).completed, false);
  assert.equal((await call('completePoll', {
    claim: pollD.claim, now: gateAt + 120_002, nextPollAt: gateAt + 400_000, outcome: 'listed',
  })).completed, true);
  assert.deepEqual(await call('claimPoll', { owner: 'poll-e', now: gateAt + 399_999 }), {
    status: 'not_due', nextPollAt: gateAt + 400_000,
  });
  assert.equal((await call('claimPoll', { owner: 'poll-e', now: gateAt + 400_000 })).status, 'claimed');
  console.log('D1 local: 1 suite passed; baseline rollback/one-time/restart, durable pending plan/receipts, leases/CAS/expiry, AES-GCM OAuth rotation/tamper and I6 poll gate (one owner, takeover after 120 s, stale complete rejected, not_due) checks passed.');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'D1 local integration failed');
  if (childOutput) console.error(childOutput.slice(-4000));
  globalThis.process.exitCode = 1;
} finally {
  await stopWorker();
  if (temporary) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await rm(temporary, { recursive: true, force: true });
        break;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error &&
            (error.code === 'EBUSY' || error.code === 'EPERM')) || attempt === 19) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
}
