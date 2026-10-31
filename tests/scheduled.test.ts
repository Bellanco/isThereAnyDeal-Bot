import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { D1Storage } from '../src/d1-storage';
import worker, { createWorker } from '../src/index';
import { LOCAL_SIMULATION } from '../src/local-simulation';
import { createTestDatabase } from './sqlite-d1';

const event = { cron: '*/5 * * * *', scheduledTime: 0 };
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const TOKEN = '123456:fake-token-for-tests-only-0000000000';
const BASE = Date.UTC(2026, 9, 31, 12);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden in tests'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function harness() {
  const logs: string[] = [];
  const clock = { t: BASE };
  const instance = createWorker({
    now: () => clock.t, sleep: async ms => { clock.t += ms; }, log: line => logs.push(line),
  });
  return { logs, clock, instance };
}

describe('scheduled entry point', () => {
  it('is a logged no-op in mock mode and keeps the mock fetch contract', async () => {
    const { logs, instance } = harness();
    await instance.scheduled(event, { APP_MODE: 'mock' });
    expect(logs).toEqual([JSON.stringify({ event: 'bridge_cycle', mode: 'mock', skipped: 'scheduled_disabled_in_mock' })]);
    const response = await worker.fetch(new Request('http://127.0.0.1/'), { APP_MODE: 'local-integration', DB: {} });
    expect(response.status).toBe(503);
  });

  it.each([
    ['unknown mode', { APP_MODE: 'real' }],
    ['missing mode', {}],
    ['local without DB', { APP_MODE: 'local-integration' }],
    ['local with credentials', { APP_MODE: 'local-integration', DB: createTestDatabase(), TELEGRAM_BOT_TOKEN: TOKEN }],
    ['local bad failure', { APP_MODE: 'local-integration', DB: createTestDatabase(), SIMULATION_TELEGRAM_FAILURE: 'x' }],
    ['production without opt-in', {
      APP_MODE: 'production', DB: createTestDatabase(), TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42',
      OAUTH_CLIENT_ID: 'client', OAUTH_REDIRECT_URI: 'http://127.0.0.1:8976/callback', OAUTH_TOKEN_KEY: KEY,
      OAUTH_TOKEN_KEY_VERSION: 'v1',
    }],
    ['production group chat', {
      APP_MODE: 'production', LIVE_DELIVERY: 'enabled', DB: createTestDatabase(), TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_CHAT_ID: '-1001', OAUTH_CLIENT_ID: 'client', OAUTH_REDIRECT_URI: 'http://127.0.0.1:8976/callback',
      OAUTH_TOKEN_KEY: KEY, OAUTH_TOKEN_KEY_VERSION: 'v1',
    }],
    ['production bad key', {
      APP_MODE: 'production', LIVE_DELIVERY: 'enabled', DB: createTestDatabase(), TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_CHAT_ID: '42', OAUTH_CLIENT_ID: 'client', OAUTH_REDIRECT_URI: 'http://127.0.0.1:8976/callback',
      OAUTH_TOKEN_KEY: 'short', OAUTH_TOKEN_KEY_VERSION: 'v1',
    }],
    ['production missing token', {
      APP_MODE: 'production', LIVE_DELIVERY: 'enabled', DB: createTestDatabase(), TELEGRAM_CHAT_ID: '42',
      OAUTH_CLIENT_ID: 'client', OAUTH_REDIRECT_URI: 'http://127.0.0.1:8976/callback', OAUTH_TOKEN_KEY: KEY,
      OAUTH_TOKEN_KEY_VERSION: 'v1',
    }],
  ])('fails closed for %s without any transport call', async (_name, env) => {
    const transport = vi.fn(async () => new Response('{}'));
    const logs: string[] = [];
    const instance = createWorker({ liveTransport: transport, log: line => logs.push(line) });
    await expect(instance.scheduled(event, env)).rejects.toThrow('bridge_cycle_failed:configuration_rejected');
    expect(transport).not.toHaveBeenCalled();
    expect(logs.join('\n')).not.toContain(TOKEN);
    expect(logs.join('\n')).not.toContain(KEY);
  });

  it('runs local integration: baseline first, then delivers a new notice to the simulated chat', async () => {
    const { logs, clock, instance } = harness();
    const db = createTestDatabase();
    const env = { APP_MODE: 'local-integration', DB: db };
    await instance.scheduled(event, env);
    const first = JSON.parse(logs[0]!);
    expect(first).toMatchObject({ event: 'bridge_cycle', mode: 'local-integration', ok: true, poll: 'baseline_initialized', sent: 0, oauthRefreshed: true });
    clock.t += 5 * 60_000;
    await instance.scheduled(event, env);
    expect(JSON.parse(logs[1]!)).toMatchObject({ ok: true, poll: 'listed', detailsPlanned: 1, sent: 1 });
    const storage = await D1Storage.create(db, LOCAL_SIMULATION.tokenKey, LOCAL_SIMULATION.keyVersion);
    expect(await storage.queueStatus()).toMatchObject({ confirmedParts: 1, pendingParts: 0 });
    const all = logs.join('\n');
    expect(all).not.toMatch(/local-sim-(access|refresh)|Juego simulado|example\.invalid|api\.telegram\.org|sendMessage/);
    expect(all).not.toContain(LOCAL_SIMULATION.botToken);
  });

  it('throws (never silent success) when a simulated Telegram failure keeps work pending', async () => {
    const { logs, clock, instance } = harness();
    const env = { APP_MODE: 'local-integration', DB: createTestDatabase(), SIMULATION_TELEGRAM_FAILURE: 'rate-limit' };
    await instance.scheduled(event, env);
    clock.t += 5 * 60_000;
    await expect(instance.scheduled(event, env)).rejects.toThrow(/bridge_cycle_failed:.*telegram_rate_limit/);
    expect(JSON.parse(logs[1]!)).toMatchObject({ ok: false, deferred: 1, deliveryStop: 'rate_limited' });
    clock.t += 5 * 60_000;
    await instance.scheduled(event, env);
    // Retry after retry_after: notice 1 plus the next simulated notices, within the batch limit.
    expect(JSON.parse(logs[2]!)).toMatchObject({ ok: true, deferred: 0, sent: 3 });
  });

  it('composes production only with an injected transport and validated configuration', async () => {
    const db = createTestDatabase();
    const now = BASE;
    const seed = await D1Storage.create(db, KEY, 'v1');
    await seed.initializeOAuthTokens({ accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: now + 30 * 86_400_000, scope: 'notifications' });
    const urls: string[] = [];
    const transport = vi.fn(async (request: Request) => {
      urls.push(new URL(request.url).pathname);
      return Response.json([]);
    });
    const logs: string[] = [];
    const instance = createWorker({ liveTransport: transport, now: () => now, log: line => logs.push(line) });
    await instance.scheduled(event, {
      APP_MODE: 'production', LIVE_DELIVERY: 'enabled', DB: db, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42',
      OAUTH_CLIENT_ID: 'client', OAUTH_REDIRECT_URI: 'http://127.0.0.1:8976/callback', OAUTH_TOKEN_KEY: KEY,
      OAUTH_TOKEN_KEY_VERSION: 'v1',
    });
    expect(urls).toEqual(['/notifications/v1']);
    expect(JSON.parse(logs[0]!)).toMatchObject({ ok: true, poll: 'baseline_initialized', baselineRecorded: 0 });
    expect(logs.join('\n')).not.toMatch(/fake-(access|refresh)|123456:/);
  });

  it('production minute ticks: no transport call until the durable poll gate is due again', async () => {
    const db = createTestDatabase();
    const clock = { t: BASE };
    const seed = await D1Storage.create(db, KEY, 'v1');
    await seed.initializeOAuthTokens({ accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: BASE + 30 * 86_400_000, scope: 'notifications' });
    const urls: string[] = [];
    const transport = vi.fn(async (request: Request) => {
      urls.push(new URL(request.url).pathname);
      return Response.json([]);
    });
    const logs: string[] = [];
    // A second isolate (different instance) shares only D1: no in-memory gate.
    const make = () => createWorker({ liveTransport: transport, now: () => clock.t, log: line => logs.push(line) });
    const env = {
      APP_MODE: 'production', LIVE_DELIVERY: 'enabled', DB: db, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42',
      OAUTH_CLIENT_ID: 'client', OAUTH_REDIRECT_URI: 'http://127.0.0.1:8976/callback', OAUTH_TOKEN_KEY: KEY,
      OAUTH_TOKEN_KEY_VERSION: 'v1',
    };
    const minute = { cron: '* * * * *', scheduledTime: 0 };
    await make().scheduled(minute, env);
    for (let tick = 1; tick <= 4; tick++) {
      clock.t = BASE + tick * 60_000;
      await make().scheduled(minute, env);
      expect(JSON.parse(logs[tick]!)).toMatchObject({ ok: true, poll: 'not_due', calls: { itadList: 0, telegramSend: 0 } });
    }
    expect(urls).toEqual(['/notifications/v1']);
    clock.t = BASE + 5 * 60_000;
    await make().scheduled(minute, env);
    expect(urls).toEqual(['/notifications/v1', '/notifications/v1']);
    expect(JSON.parse(logs[5]!)).toMatchObject({ ok: true, poll: 'listed', pollGate: 'claimed' });
  });
});

