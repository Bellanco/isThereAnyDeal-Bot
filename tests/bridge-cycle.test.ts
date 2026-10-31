import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVISIONAL_LIMITS, runCycle, runTick, type BridgeLimits } from '../src/bridge';
import { D1Storage, LEASE_MS } from '../src/d1-storage';
import type { NotificationSummary, WaitlistNotification } from '../src/domain';
import { ServiceError } from '../src/itad-http';
import { formatNotification } from '../src/notifications';
import type { OAuthTokens } from '../src/oauth';
import { TelegramError, type TelegramReceipt } from '../src/telegram';
import detailFixture from './fixtures/notifications-waitlist-detail.json';
import { createTestDatabase, type TestDatabase } from './sqlite-d1';

const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const BASE = Date.UTC(2026, 9, 31, 12);
const DAY = 24 * 60 * 60_000;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden in tests'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function notice(notificationId: string, games = 1, minute = 0): WaitlistNotification {
  const base = structuredClone(detailFixture) as WaitlistNotification;
  const game = base.games[0]!;
  return {
    ...base, id: notificationId, timestamp: new Date(BASE + minute * 60_000).toISOString(),
    games: Array.from({ length: games }, (_, index) => ({
      ...structuredClone(game), id: `018d937e-f835-710c-b95b-${String(index).padStart(12, '0')}`,
      title: `${game.title} ${index + 1}`,
      deals: game.deals.map(deal => ({ ...deal, url: `${deal.url}?ref=affiliate-${notificationId.slice(-4)}-${index}` })),
    })),
  };
}

function summary(notificationId: string, minute = 0, read: string | null = null): NotificationSummary {
  return {
    id: notificationId, type: 'waitlist', title: 'x', timestamp: new Date(BASE + minute * 60_000).toISOString(), read,
  };
}

type Step = 'ok' | Error | ((text: string) => Promise<TelegramReceipt | void> | TelegramReceipt | void);

async function setup(options: { tokens?: OAuthTokens | null; limits?: Partial<BridgeLimits> } = {}) {
  const db: TestDatabase = createTestDatabase();
  const storage = await D1Storage.create(db, KEY, 'test-v1');
  const clock = { t: BASE };
  const now = () => clock.t;
  const sleep = vi.fn(async (ms: number) => { clock.t += ms; });
  const listed: NotificationSummary[] = [];
  const details = new Map<string, WaitlistNotification>();
  const listFailures: Error[] = [];
  const detailFailures = new Map<string, Error[]>();
  const itad = {
    list: vi.fn(async (_token: string) => {
      const failure = listFailures.shift();
      if (failure) throw failure;
      return structuredClone(listed);
    }),
    waitlist: vi.fn(async (notificationId: string, _token: string) => {
      const failure = detailFailures.get(notificationId)?.shift();
      if (failure) throw failure;
      const value = details.get(notificationId);
      if (!value) throw new ServiceError('http', 404);
      return structuredClone(value);
    }),
  };
  let generation = 0;
  const oauth = {
    refresh: vi.fn(async (previous: OAuthTokens): Promise<OAuthTokens> => {
      expect(previous.refreshToken).toMatch(/^fake-refresh-/);
      generation++;
      return {
        accessToken: `fake-access-${generation}`, refreshToken: `fake-refresh-${generation}`,
        expiresAt: clock.t + 31 * DAY, scope: 'notifications',
      };
    }),
  };
  const script: Step[] = [];
  const sent: { text: string; at: number }[] = [];
  const telegram = {
    send: vi.fn(async (text: string): Promise<TelegramReceipt> => {
      const step = script.shift() ?? 'ok';
      if (step instanceof Error) throw step;
      if (typeof step === 'function') {
        const result = await step(text);
        if (result) return result;
      }
      sent.push({ text, at: clock.t });
      return { messageId: sent.length };
    }),
  };
  const tokens = options.tokens === undefined
    ? { accessToken: 'fake-access-0', refreshToken: 'fake-refresh-0', expiresAt: BASE + 31 * DAY, scope: 'notifications' }
    : options.tokens;
  if (tokens) await storage.initializeOAuthTokens(tokens);
  let owners = 0;
  const limits = { ...options.limits };
  const run = (extra: Partial<BridgeLimits> = {}) => runCycle({
    storage, itad, oauth, telegram, now, sleep, owner: `worker-${++owners}`, limits: { ...limits, ...extra },
  });
  /** Scheduled tick (durable poll gate), as used by the cron composition. */
  const tick = (extra: Partial<BridgeLimits> = {}) => runTick({
    storage, itad, oauth, telegram, now, sleep, owner: `tick-${++owners}`, limits: { ...limits, ...extra },
  });
  const addNotice = (value: WaitlistNotification, minute = 0, read: string | null = null) => {
    details.set(value.id, value);
    listed.unshift(summary(value.id, minute, read));
  };
  return {
    db, storage, clock, sleep, listed, details, listFailures, detailFailures, itad, oauth, script, sent,
    telegram, run, tick, addNotice,
  };
}

async function baseline(context: Awaited<ReturnType<typeof setup>>, ids = [id(1), id(2)]) {
  context.listed.push(...ids.map(item => summary(item, -100)));
  ids.forEach(item => context.details.set(item, notice(item)));
  const result = await context.run();
  expect(result.poll).toBe('baseline_initialized');
  return result;
}

describe('first scan baseline', () => {
  it('records every listed ID atomically without fetching details or sending history', async () => {
    const context = await setup();
    const result = await baseline(context, [id(1), id(2), id(3)]);
    expect(result).toMatchObject({ ok: true, listed: 3, baselineRecorded: 3, sent: 0, detailsPlanned: 0 });
    expect(context.itad.waitlist).not.toHaveBeenCalled();
    expect(context.telegram.send).not.toHaveBeenCalled();
    const again = await context.run();
    expect(again).toMatchObject({ ok: true, poll: 'listed', sent: 0, pendingDetailInList: 0 });
    // A new storage instance (restart) never repeats the baseline.
    const restarted = await D1Storage.create(context.db, KEY, 'test-v1');
    expect(await restarted.initializeBaseline([id(9)], BASE)).toBe('already-initialized');
  });

  it('does not treat a failed list as an empty baseline', async () => {
    const context = await setup();
    context.listFailures.push(new ServiceError('http', 503));
    const result = await context.run();
    expect(result).toMatchObject({ ok: false, poll: 'failed' });
    expect(result.errors).toContain('itad_http');
    expect(await context.storage.baselineComplete()).toBe(false);
  });
});

describe('new notices to the fixed chat', () => {
  it('delivers every part of a new notice, even if already read in ITAD, exactly as formatted', async () => {
    const context = await setup();
    await baseline(context);
    const value = notice(id(10), 30, 5);
    context.addNotice(value, 5, '2026-10-31T12:06:00Z');
    const expected = formatNotification(value);
    expect(expected.length).toBeGreaterThan(1);
    const result = await context.run({ maxSendsPerRun: 50 });
    expect(result).toMatchObject({ ok: true, detailsPlanned: 1, sent: expected.length, deliveryStop: 'idle' });
    expect(context.sent.map(item => item.text)).toEqual(expected);
    for (const deal of value.games.flatMap(game => game.deals)) {
      expect(context.sent.some(item => item.text.includes(deal.url))).toBe(true);
    }
    const parts = await context.storage.notificationParts(id(10));
    expect(parts.every(part => part.status === 'confirmed' && part.receipt?.startsWith('telegram_message_id:'))).toBe(true);
    expect(await context.run()).toMatchObject({ sent: 0, detailsPlanned: 0 });
    expect(context.telegram.send).toHaveBeenCalledTimes(expected.length);
  });

  it('keeps global spacing of at least one second between sends', async () => {
    const context = await setup();
    await baseline(context);
    context.addNotice(notice(id(10)), 1);
    context.addNotice(notice(id(11)), 2);
    context.addNotice(notice(id(12)), 3);
    await context.run();
    expect(context.sent).toHaveLength(3);
    for (let index = 1; index < context.sent.length; index++) {
      expect(context.sent[index]!.at - context.sent[index - 1]!.at).toBeGreaterThanOrEqual(1000);
    }
    expect(Math.max(...context.sleep.mock.calls.map(call => call[0]))).toBeLessThanOrEqual(PROVISIONAL_LIMITS.maxInlineWaitMs);
  });

  it('bounds each run without dropping anything and keeps notice and part order', async () => {
    const context = await setup({ limits: { maxSendsPerRun: 2, maxDetailsPerRun: 2 } });
    await baseline(context);
    const big = notice(id(10), 30, 1);
    const small = notice(id(11), 1, 2);
    const third = notice(id(12), 2, 3);
    // Listed newest first, as ITAD does; delivery follows notice time.
    context.addNotice(big, 1);
    context.addNotice(small, 2);
    context.addNotice(third, 3);
    const expected = [...formatNotification(big), ...formatNotification(small), ...formatNotification(third)];
    const first = await context.run();
    expect(first).toMatchObject({ detailsPlanned: 2, sent: 2, deliveryStop: 'batch_limit' });
    expect(first.queue).toMatchObject({ pendingDetails: 1 });
    expect(first.queue!.oldestOpenAgeSeconds).toBeGreaterThanOrEqual(0);
    for (let run = 0; run < 20 && context.sent.length < expected.length; run++) {
      context.clock.t += 5 * 60_000;
      await context.run();
    }
    expect(context.sent.map(item => item.text)).toEqual(expected);
    const status = await context.storage.queueStatus();
    expect(status).toMatchObject({ pendingDetails: 0, pendingParts: 0, blockedParts: 0, confirmedParts: expected.length });
  });

  it('never accepts the destination or credentials from ITAD data', async () => {
    const context = await setup();
    await baseline(context);
    const value = notice(id(10)) as WaitlistNotification & Record<string, unknown>;
    Object.assign(value, { chat_id: '999', token: 'evil' });
    context.addNotice(value);
    await context.run();
    expect(context.sent).toHaveLength(1);
    expect(context.sent[0]!.text).not.toContain('evil');
  });
});

describe('Telegram failures', () => {
  async function ready(steps: Step[], games = 1) {
    const context = await setup();
    await baseline(context);
    context.addNotice(notice(id(10), games, 1), 1);
    context.addNotice(notice(id(11), 1, 2), 2);
    context.script.push(...steps);
    return context;
  }

  it('persists retry_after for the part and the chat without a long sleep under lease', async () => {
    const context = await ready([new TelegramError('rate_limit', 'flood', 40, 429)]);
    const result = await context.run();
    expect(result).toMatchObject({ ok: false, sent: 0, deferred: 1, deliveryStop: 'rate_limited' });
    expect(context.sleep.mock.calls.every(call => call[0] <= PROVISIONAL_LIMITS.maxInlineWaitMs)).toBe(true);
    const [part] = await context.storage.notificationParts(id(10));
    expect(part).toMatchObject({ status: 'pending', attempts: 0, last_category: 'rate_limit', next_attempt_at: BASE + 40_000 });
    context.clock.t = BASE + 30_000;
    expect(await context.run()).toMatchObject({ sent: 0 });
    context.clock.t = BASE + 40_000;
    const later = await context.run();
    expect(later.sent).toBe(2);
    expect(context.sent[0]!.at).toBeGreaterThanOrEqual(BASE + 40_000);
  });

  it('blocks after five transient attempts, keeps it visible and lets later notices continue', async () => {
    const transient = () => new TelegramError('transient', 'http_5xx', undefined, 502);
    const context = await ready([transient(), transient(), transient(), transient(), transient()]);
    for (let attempt = 1; attempt <= 5; attempt++) {
      await context.run();
      const [part] = await context.storage.notificationParts(id(10));
      expect(part!.attempts).toBe(attempt);
      context.clock.t += 10 * 60_000;
    }
    const [part] = await context.storage.notificationParts(id(10));
    expect(part).toMatchObject({ status: 'pending', blocked_category: 'transient_exhausted', receipt: null });
    const after = await context.run();
    expect(context.sent.map(item => item.text)).toEqual(formatNotification(context.details.get(id(11))!));
    expect(after.ok).toBe(false);
    expect(after.errors).toContain('blocked_work_present');
    expect(after.queue).toMatchObject({ blockedParts: 1 });
    expect(await context.storage.requeueBlocked(context.clock.t)).toEqual({ parts: 1, details: 0 });
    context.clock.t += 2000;
    expect(await context.run()).toMatchObject({ ok: true, sent: 1 });
  });

  it('blocks a rejected message immediately and does not send its remaining parts', async () => {
    const context = await ready([new TelegramError('rejected', 'bad_request', undefined, 400)], 30);
    const result = await context.run({ maxSendsPerRun: 10 });
    expect(result.blocked).toBe(1);
    const parts = await context.storage.notificationParts(id(10));
    expect(parts[0]).toMatchObject({ blocked_category: 'telegram_bad_request' });
    expect(parts.slice(1).every(part => part.status === 'pending')).toBe(true);
    expect(context.sent.map(item => item.text)).toEqual(formatNotification(context.details.get(id(11))!));
  });

  it.each([
    ['forbidden', new TelegramError('destination', 'forbidden', undefined, 403)],
    ['migrated', new TelegramError('destination', 'migrated', undefined, 400)],
  ])('halts all delivery on destination error %s, keeping the part pending', async (reason, error) => {
    const context = await ready([error]);
    const result = await context.run();
    expect(result).toMatchObject({ ok: false, deliveryStop: 'delivery_halt' });
    expect(await context.storage.flags()).toEqual({ delivery_halt: `telegram_${reason}` });
    const [part] = await context.storage.notificationParts(id(10));
    expect(part).toMatchObject({ status: 'pending', blocked_category: null, attempts: 0 });
    context.clock.t += 5 * 60_000;
    expect(await context.run()).toMatchObject({ sent: 0, deliveryStop: 'delivery_halt' });
    expect(context.telegram.send).toHaveBeenCalledTimes(1);
    expect(await context.storage.clearFlag('delivery_halt')).toBe(true);
    expect(await context.run()).toMatchObject({ ok: true, sent: 2 });
  });

  it('never retries an unverified receipt automatically; operator may confirm it manually', async () => {
    const context = await ready([new TelegramError('unverified', 'message_id', undefined, 200)]);
    const result = await context.run();
    expect(result.blocked).toBe(1);
    expect(context.sent).toHaveLength(1);
    context.clock.t += 60 * 60_000;
    await context.run();
    expect(context.telegram.send).toHaveBeenCalledTimes(2);
    expect(await context.storage.confirmBlockedPartManually(id(10), 0, context.clock.t, true)).toBe(true);
    const [part] = await context.storage.notificationParts(id(10));
    expect(part).toMatchObject({ status: 'confirmed', blocked_category: null });
    expect(part!.receipt).toMatch(/^operator_manual:/);
  });

  it('halts on a receipt for another chat', async () => {
    const context = await ready([new TelegramError('unverified', 'chat_mismatch', undefined, 200)]);
    expect(await context.run()).toMatchObject({ deliveryStop: 'delivery_halt', blocked: 1 });
    expect(await context.storage.flags()).toEqual({ delivery_halt: 'telegram_chat_mismatch' });
  });

  it('retries a partial failure without resending confirmed parts', async () => {
    const context = await ready(['ok', new TelegramError('transient', 'network')], 30);
    const expected = formatNotification(context.details.get(id(10))!);
    await context.run({ maxSendsPerRun: 10 });
    expect(context.sent.map(item => item.text)).toEqual([expected[0]]);
    context.clock.t += 5 * 60_000;
    await context.run({ maxSendsPerRun: 50 });
    expect(context.sent.map(item => item.text)).toEqual([
      ...expected, ...formatNotification(context.details.get(id(11))!),
    ]);
  });

  it('stale owner after 120 s cannot confirm; the new owner may resend (documented duplicate window)', async () => {
    const context = await ready([async () => { context.clock.t += 121_000; }]);
    const stale = await context.run();
    expect(stale).toMatchObject({ ok: false, deliveryStop: 'error' });
    expect(stale.errors).toContain('receipt_not_persisted');
    const [part] = await context.storage.notificationParts(id(10));
    expect(part!.status).toBe('leased');
    const recovered = await context.run();
    expect(recovered.sent).toBe(2);
    expect(context.sent[0]!.text).toBe(context.sent[1]!.text);
  });

  it('keeps the lease when the receipt cannot be written, then resends after expiry', async () => {
    const context = await ready([]);
    context.db.failWhen = sql => sql.includes("SET status = 'confirmed'");
    const result = await context.run();
    expect(result).toMatchObject({ ok: false, deliveryStop: 'error', sent: 0 });
    context.db.failWhen = null;
    expect(context.sent).toHaveLength(1);
    expect(await context.run()).toMatchObject({ deliveryStop: 'busy', sent: 0 });
    context.clock.t += 121_000;
    expect((await context.run()).sent).toBe(2);
    expect(context.sent[0]!.text).toBe(context.sent[1]!.text);
  });

  it('overlapping runs share the durable throttle and never send a part twice', async () => {
    const context = await setup({ limits: { maxSendsPerRun: 50 } });
    await baseline(context);
    context.addNotice(notice(id(10), 30, 1), 1);
    context.addNotice(notice(id(11), 30, 2), 2);
    const expected = [
      ...formatNotification(context.details.get(id(10))!), ...formatNotification(context.details.get(id(11))!),
    ];
    for (let round = 0; round < 10 && context.sent.length < expected.length; round++) {
      await Promise.all([context.run(), context.run(), context.run()]);
      context.clock.t += 5 * 60_000;
    }
    expect(context.sent.map(item => item.text)).toEqual(expected);
    for (let index = 1; index < context.sent.length; index++) {
      expect(context.sent[index]!.at - context.sent[index - 1]!.at).toBeGreaterThanOrEqual(1000);
    }
  });
});

describe('I6 flags fail closed', () => {
  it('does not send when flags cannot be read, even with a persisted delivery_halt; parts stay pending', async () => {
    const context = await setup({ limits: { maxSendsPerRun: 1 } });
    await baseline(context);
    const value = notice(id(10), 30, 1);
    context.addNotice(value, 1);
    const expected = formatNotification(value);
    expect(expected.length).toBeGreaterThan(2);
    expect(await context.run()).toMatchObject({ sent: 1, deliveryStop: 'batch_limit' });
    await context.storage.setFlag('delivery_halt', 'telegram_forbidden', context.clock.t);
    context.clock.t += 5 * 60_000;
    context.itad.list.mockClear();
    let failures = 1;
    context.db.failWhen = sql => sql.includes('FROM bridge_flags') && failures-- > 0;
    const result = await context.run({ maxSendsPerRun: 50 });
    context.db.failWhen = null;
    expect(result).toMatchObject({ ok: false, sent: 0, deliveryStop: 'flags_unavailable', poll: 'failed' });
    expect(result.errors).toEqual(['flags_unavailable', 'unexpected', 'flag_delivery_halt']);
    expect(context.telegram.send).toHaveBeenCalledTimes(1);
    expect(context.itad.list).not.toHaveBeenCalled();
    const parts = await context.storage.notificationParts(id(10));
    expect(parts.filter(part => part.status === 'confirmed')).toHaveLength(1);
    expect(parts.slice(1).every(part => part.status === 'pending' && part.blocked_category === null && part.attempts === 0))
      .toBe(true);
    // Readable again: the persisted halt still applies; nothing was lost.
    expect(await context.run({ maxSendsPerRun: 50 })).toMatchObject({ sent: 0, deliveryStop: 'delivery_halt' });
    expect(await context.storage.clearFlag('delivery_halt')).toBe(true);
    await context.run({ maxSendsPerRun: 50 });
    expect(context.sent.map(item => item.text)).toEqual(expected);
  });

  it('does not poll or send on a flag read failure without any flag either; nothing is lost', async () => {
    const context = await setup();
    await baseline(context);
    const value = notice(id(10));
    context.addNotice(value);
    context.itad.list.mockClear();
    let failures = 1;
    context.db.failWhen = sql => sql.includes('FROM bridge_flags') && failures-- > 0;
    const result = await context.run();
    context.db.failWhen = null;
    expect(result).toMatchObject({ ok: false, sent: 0, detailsPlanned: 0, deliveryStop: 'flags_unavailable' });
    expect(context.itad.list).not.toHaveBeenCalled();
    expect(context.telegram.send).not.toHaveBeenCalled();
    expect(await context.run()).toMatchObject({ ok: true, detailsPlanned: 1, sent: 1 });
    expect(context.sent.map(item => item.text)).toEqual(formatNotification(value));
  });
});

describe('details', () => {
  it('keeps failed details pending with backoff and blocks after five attempts', async () => {
    const context = await setup();
    await baseline(context);
    context.addNotice(notice(id(10)));
    context.detailFailures.set(id(10), Array.from({ length: 5 }, () => new ServiceError('network')));
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await context.run();
      expect(result.errors).toContain('detail_network');
      context.clock.t += 10 * 60_000;
    }
    const status = await context.storage.queueStatus();
    expect(status).toMatchObject({ pendingDetails: 0, blockedDetails: 1 });
    expect(await context.storage.requeueBlocked(context.clock.t)).toEqual({ parts: 0, details: 1 });
    expect(await context.run()).toMatchObject({ ok: true, detailsPlanned: 1, sent: 1 });
  });

  it('blocks a detail whose link cannot fit, without truncating or sending anything', async () => {
    const context = await setup();
    await baseline(context);
    const value = notice(id(10));
    value.games[0]!.deals[0]!.url = `https://example.invalid/${'a'.repeat(4100)}`;
    context.addNotice(value);
    const result = await context.run();
    expect(result).toMatchObject({ detailsBlocked: 1, sent: 0 });
    expect(result.errors).toContain('detail_format_rejected');
    expect(context.telegram.send).not.toHaveBeenCalled();
  });

  it('stops the detail phase on rate limit and keeps work durable', async () => {
    const context = await setup();
    await baseline(context);
    context.addNotice(notice(id(10)), 1);
    context.addNotice(notice(id(11)), 2);
    context.detailFailures.set(id(10), [new ServiceError('rate_limit', 429, 120)]);
    const result = await context.run();
    expect(result).toMatchObject({ detailsPlanned: 0, detailsDeferred: 1 });
    expect(context.itad.waitlist).toHaveBeenCalledTimes(1);
    context.clock.t += 121_000;
    expect(await context.run()).toMatchObject({ detailsPlanned: 2, sent: 2 });
  });
});

describe('I6 durable detail reservation', () => {
  const detailRow = (context: Awaited<ReturnType<typeof setup>>, notificationId: string) =>
    context.db.raw.prepare(
      `SELECT detail_attempts, detail_next_at, detail_blocked, detail_owner, detail_lease_expires_at, status
       FROM notification_work WHERE notification_id = ?`,
    ).get(notificationId) as {
      detail_attempts: number; detail_next_at: number; detail_blocked: string | null;
      detail_owner: string | null; detail_lease_expires_at: number | null; status: string;
    };

  it('five overlapping runs query a failing detail once per due attempt; five total attempts, then blocked', async () => {
    const context = await setup();
    await baseline(context);
    context.addNotice(notice(id(10)));
    context.detailFailures.set(id(10), Array.from({ length: 10 }, () => new ServiceError('network')));
    // Keep each query in flight so the five runs really overlap on the same pending detail.
    const original = context.itad.waitlist.getMockImplementation()!;
    let inFlight = 0;
    let maxInFlight = 0;
    context.itad.waitlist.mockImplementation(async (notificationId: string, token: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise(resolve => setTimeout(resolve, 5));
        return await original(notificationId, token);
      } finally {
        inFlight--;
      }
    });
    // Widen the D1 latency window: every run has read the same due work before any CAS claim.
    const claim = context.storage.claimDetail.bind(context.storage);
    let waiting: (() => void)[] = [];
    vi.spyOn(context.storage, 'claimDetail').mockImplementation(async (...args) => {
      await new Promise<void>(resolve => {
        waiting.push(resolve);
        if (waiting.length === 5) {
          waiting.forEach(release => release());
          waiting = [];
        }
        setTimeout(resolve, 50);
      });
      return claim(...args);
    });
    for (let attempt = 1; attempt <= 5; attempt++) {
      context.itad.list.mockClear();
      vi.mocked(context.storage.claimDetail).mockClear();
      const results = await Promise.all(Array.from({ length: 5 }, () => context.run()));
      expect(context.storage.claimDetail).toHaveBeenCalledTimes(5);
      expect(context.itad.list).toHaveBeenCalledTimes(5);
      expect(context.itad.waitlist).toHaveBeenCalledTimes(attempt);
      expect(results.filter(result => result.errors.includes('detail_network'))).toHaveLength(1);
      expect(results.every(result => !result.errors.includes('detail_lease_lost'))).toBe(true);
      const row = detailRow(context, id(10));
      expect(row).toMatchObject({ detail_attempts: attempt, detail_owner: null, detail_lease_expires_at: null });
      if (attempt < 5) {
        expect(row).toMatchObject({ detail_blocked: null, detail_next_at: context.clock.t + PROVISIONAL_LIMITS.detailBackoffMs });
        // Same logical instant, backoff not yet due: no run may query again.
        await Promise.all(Array.from({ length: 5 }, () => context.run()));
        expect(context.itad.waitlist).toHaveBeenCalledTimes(attempt);
      } else {
        expect(row.detail_blocked).toBe('detail_retries_exhausted');
      }
      context.clock.t += PROVISIONAL_LIMITS.detailBackoffMs;
    }
    expect(maxInFlight).toBe(1);
    await Promise.all(Array.from({ length: 5 }, () => context.run()));
    expect(context.itad.waitlist).toHaveBeenCalledTimes(5);
    expect(await context.storage.queueStatus()).toMatchObject({ pendingDetails: 0, blockedDetails: 1 });
  });

  it('overlapping runs plan a successful detail once and deliver all its parts once', async () => {
    const context = await setup({ limits: { maxSendsPerRun: 50 } });
    await baseline(context);
    const value = notice(id(10), 30, 1);
    context.addNotice(value, 1);
    for (let round = 0; round < 5; round++) {
      await Promise.all(Array.from({ length: 5 }, () => context.run()));
      context.clock.t += 5 * 60_000;
    }
    expect(context.itad.waitlist).toHaveBeenCalledTimes(1);
    expect(context.sent.map(item => item.text)).toEqual(formatNotification(value));
  });

  it('an expired owner cannot record, release or save over the new owner; restart recovers the lease', async () => {
    const context = await setup();
    const { storage } = context;
    await storage.initializeBaseline([id(1)], BASE);
    await storage.discover([id(10)], BASE);
    const first = await storage.claimDetail(id(10), 'owner-a', BASE);
    expect(first.status).toBe('claimed');
    if (first.status !== 'claimed') return;
    const a = first.claim;
    expect(await storage.claimDetail(id(10), 'owner-b', BASE + 1)).toEqual({ status: 'busy' });
    expect(await storage.detailWork(BASE + 1, 10)).toEqual([]);
    // Simulated crash of A: a new adapter instance (restart) takes over only after expiry.
    const restarted = await D1Storage.create(context.db, KEY, 'test-v1');
    expect(await restarted.claimDetail(id(10), 'owner-b', BASE + LEASE_MS - 1)).toEqual({ status: 'busy' });
    const after = BASE + LEASE_MS;
    expect(await restarted.detailWork(after, 10)).toEqual([id(10)]);
    const second = await restarted.claimDetail(id(10), 'owner-b', after);
    expect(second.status).toBe('claimed');
    if (second.status !== 'claimed') return;
    const b = second.claim;
    expect(b.version).toBeGreaterThan(a.version);
    const failure = { category: 'network', nextAt: after + 60_000, countAttempt: true, permanent: false, maxAttempts: 5 };
    // Expired A (at any clock) never mutates: no attempt, no backoff, no release, no plan.
    for (const at of [after, BASE + 1]) {
      expect(await storage.recordDetailFailure(a, at, failure)).toBe('stale');
      expect(await storage.releaseDetail(a, at)).toBe(false);
      expect(await storage.saveClaimedNotificationPlan(a, notice(id(10)), formatNotification(notice(id(10))), at))
        .toBe(false);
    }
    expect(detailRow(context, id(10))).toMatchObject({
      status: 'pending_detail', detail_attempts: 0, detail_next_at: 0, detail_owner: 'owner-b',
      detail_lease_expires_at: b.expiresAt,
    });
    expect(await storage.notificationParts(id(10))).toEqual([]);
    // The valid owner completes the plan; the claim is cleared.
    const value = notice(id(10));
    expect(await restarted.saveClaimedNotificationPlan(b, value, formatNotification(value), after + 1)).toBe(true);
    expect(detailRow(context, id(10))).toMatchObject({ status: 'planned', detail_owner: null });
    expect(await storage.recordDetailFailure(b, after + 2, failure)).toBe('stale');
    expect(await storage.claimDetail(id(10), 'owner-c', after + 3)).toEqual({ status: 'planned' });
  });

  it('a claim does not survive its own expiry for the owner either', async () => {
    const context = await setup();
    const { storage } = context;
    await storage.initializeBaseline([id(1)], BASE);
    await storage.discover([id(10)], BASE);
    const reservation = await storage.claimDetail(id(10), 'owner-a', BASE);
    if (reservation.status !== 'claimed') throw new Error('expected claim');
    const failure = { category: 'network', nextAt: BASE + 60_000, countAttempt: true, permanent: false, maxAttempts: 5 };
    expect(await storage.recordDetailFailure(reservation.claim, BASE + LEASE_MS, failure)).toBe('stale');
    expect(detailRow(context, id(10))).toMatchObject({ detail_attempts: 0, detail_next_at: 0 });
  });

  it('a 401 on detail releases only its own reservation without counting an attempt', async () => {
    const context = await setup();
    await baseline(context);
    context.addNotice(notice(id(10)));
    context.detailFailures.set(id(10), [new ServiceError('http', 401)]);
    const result = await context.run();
    expect(result.errors).toContain('detail_http');
    expect(detailRow(context, id(10))).toMatchObject({ detail_attempts: 0, detail_owner: null, status: 'pending_detail' });
    expect(await context.run()).toMatchObject({ detailsPlanned: 1, sent: 1 });
  });
});

describe('I6 official DRM/platform lists', () => {
  it('delivers a notice with 101 DRM and 101 platform entries completely', async () => {
    const context = await setup({ limits: { maxSendsPerRun: 50 } });
    await baseline(context);
    const value = notice(id(10));
    const deal = value.games[0]!.deals[0]!;
    deal.drm = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `DRM-${index}` }));
    deal.platforms = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `Platform-${index}` }));
    context.addNotice(value);
    const result = await context.run();
    expect(result).toMatchObject({ ok: true, detailsPlanned: 1 });
    const text = context.sent.map(item => item.text.slice(item.text.indexOf('\n') + 1)).join('');
    expect(text).toContain(`DRM: ${deal.drm.map(item => item.name).join(', ')}\n`);
    expect(text).toContain(`Plataformas: ${deal.platforms.map(item => item.name).join(', ')}\n`);
    const plan = await context.storage.notificationPlan(id(10));
    expect(plan!.detail.games[0]!.deals[0]!.drm).toHaveLength(101);
    expect(plan!.detail.games[0]!.deals[0]!.platforms).toHaveLength(101);
  });
});

describe('OAuth tokens in D1', () => {
  it('refreshes ahead of expiry, rotates the encrypted envelope and stores no plaintext', async () => {
    const context = await setup({
      tokens: { accessToken: 'fake-access-0', refreshToken: 'fake-refresh-0', expiresAt: BASE + 60 * 60_000, scope: 'notifications' },
    });
    const result = await baseline(context);
    expect(result.oauthRefreshed).toBe(true);
    expect(context.oauth.refresh).toHaveBeenCalledTimes(1);
    expect(context.itad.list).toHaveBeenCalledWith('fake-access-1');
    const stored = await context.storage.currentOAuth();
    expect(stored).toMatchObject({ sessionVersion: 2, tokens: { refreshToken: 'fake-refresh-1' } });
    const dump = JSON.stringify(context.db.raw.prepare('SELECT * FROM oauth_credentials').all());
    expect(dump).not.toMatch(/fake-(access|refresh)/);
    await context.run();
    expect(context.oauth.refresh).toHaveBeenCalledTimes(1);
  });

  it('overlapping runs refresh once', async () => {
    const context = await setup({
      tokens: { accessToken: 'fake-access-0', refreshToken: 'fake-refresh-0', expiresAt: BASE + 60 * 60_000, scope: 'notifications' },
    });
    context.listed.push(summary(id(1)));
    await Promise.all([context.run(), context.run(), context.run()]);
    expect(context.oauth.refresh).toHaveBeenCalledTimes(1);
    expect(await context.storage.oauthSessionVersion()).toBe(2);
  });

  it('flags reauthorization on invalid_grant, stops polling, keeps delivering, and clears on reauthorization', async () => {
    const context = await setup();
    await baseline(context);
    context.addNotice(notice(id(10)));
    context.listFailures.push(new ServiceError('http', 401));
    context.oauth.refresh.mockRejectedValueOnce(new ServiceError('oauth', 400, undefined, 'invalid_grant'));
    const result = await context.run();
    expect(result).toMatchObject({ ok: false, poll: 'reauth_required' });
    expect(await context.storage.flags()).toEqual({ oauth_reauth: 'oauth_invalid_grant' });
    context.itad.list.mockClear();
    const next = await context.run();
    expect(next.poll).toBe('reauth_required');
    expect(context.itad.list).not.toHaveBeenCalled();
    const version = (await context.storage.oauthSessionVersion())!;
    expect(await context.storage.replaceOAuthTokensAfterReauthorization(version, {
      accessToken: 'fake-access-new', refreshToken: 'fake-refresh-new', expiresAt: BASE + 31 * DAY, scope: 'notifications',
    })).toBe(true);
    expect(await context.storage.flags()).toEqual({});
    expect(await context.run()).toMatchObject({ ok: true, poll: 'listed', sent: 1 });
  });

  it('makes a lost refresh persistence visible as a reauthorization flag', async () => {
    const context = await setup({
      tokens: { accessToken: 'fake-access-0', refreshToken: 'fake-refresh-0', expiresAt: BASE + 60 * 60_000, scope: 'notifications' },
    });
    context.listed.push(summary(id(1)));
    context.db.failWhen = sql => sql.includes('UPDATE oauth_credentials SET session_version');
    const result = await context.run();
    context.db.failWhen = null;
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('oauth_refresh_not_persisted');
    expect(await context.storage.flags()).toEqual({ oauth_reauth: 'refresh_not_persisted' });
    expect(await context.storage.oauthSessionVersion()).toBe(1);
  });

  it('keeps using a still-valid token when refresh fails transiently, without a flag', async () => {
    const context = await setup({
      tokens: { accessToken: 'fake-access-0', refreshToken: 'fake-refresh-0', expiresAt: BASE + 60 * 60_000, scope: 'notifications' },
    });
    context.listed.push(summary(id(1)));
    context.oauth.refresh.mockRejectedValueOnce(new ServiceError('network'));
    const result = await context.run();
    expect(result).toMatchObject({ poll: 'baseline_initialized', ok: false });
    expect(result.errors).toContain('oauth_refresh_network');
    expect(await context.storage.flags()).toEqual({});
    expect(context.itad.list).toHaveBeenCalledWith('fake-access-0');
  });

  it('flags access_rejected when a forced refresh still gets 401', async () => {
    const context = await setup();
    context.listFailures.push(new ServiceError('http', 401), new ServiceError('http', 401));
    const result = await context.run();
    expect(result.poll).toBe('reauth_required');
    expect(context.oauth.refresh).toHaveBeenCalledTimes(1);
    expect(await context.storage.flags()).toEqual({ oauth_reauth: 'access_rejected' });
  });

  it('reports missing authorization explicitly and still delivers durable work', async () => {
    const context = await setup({ tokens: null });
    const result = await context.run();
    expect(result).toMatchObject({ ok: false, poll: 'authorization_missing' });
    expect(context.itad.list).not.toHaveBeenCalled();
  });
});

describe('I6 minute ticks with the durable ITAD poll gate', () => {
  const MINUTE = 60_000;
  const at = (context: Awaited<ReturnType<typeof setup>>, ms: number) => {
    // Cron fires at absolute times; in-tick sleeps never move a later tick earlier.
    context.clock.t = Math.max(context.clock.t, BASE + ms);
  };
  const noticeWithParts = (notificationId: string, wanted: number, minute: number) => {
    for (let games = 1; games < 1000; games++) {
      const value = notice(notificationId, games, minute);
      if (formatNotification(value).length === wanted) return value;
    }
    throw new Error('no game count yields the wanted parts');
  };

  it('queries ITAD only on the due tick (5 min) and makes no OAuth/ITAD call on drain ticks', async () => {
    const context = await setup();
    const currentOAuth = vi.spyOn(context.storage, 'currentOAuth');
    const claimRefresh = vi.spyOn(context.storage, 'claimOAuthRefresh');
    context.listed.push(summary(id(1), -100));
    const first = await context.tick();
    expect(first).toMatchObject({ ok: true, poll: 'baseline_initialized', pollGate: 'claimed', nextPollInSeconds: 300 });
    expect(first.calls).toEqual({ oauthRefresh: 0, itadList: 1, itadDetail: 0, telegramSend: 0 });
    currentOAuth.mockClear();
    for (const minute of [1, 2, 3, 4]) {
      at(context, minute * MINUTE);
      const result = await context.tick();
      expect(result).toMatchObject({ ok: true, poll: 'not_due', pollGate: 'not_due', nextPollInSeconds: 300 - minute * 60 });
      expect(result.calls).toEqual({ oauthRefresh: 0, itadList: 0, itadDetail: 0, telegramSend: 0 });
    }
    expect(currentOAuth).not.toHaveBeenCalled();
    expect(claimRefresh).not.toHaveBeenCalled();
    expect(context.itad.list).toHaveBeenCalledTimes(1);
    at(context, 5 * MINUTE);
    expect(await context.tick()).toMatchObject({ ok: true, poll: 'listed', pollGate: 'claimed', nextPollInSeconds: 300 });
    expect(context.itad.list).toHaveBeenCalledTimes(2);
    expect(currentOAuth).toHaveBeenCalledTimes(1);
  });

  it('runCycle stays a standalone ungated cycle (backwards compatible API)', async () => {
    const context = await setup();
    await baseline(context);
    const again = await context.run();
    expect(again).toMatchObject({ ok: true, poll: 'listed', pollGate: 'bypassed' });
    expect(context.itad.list).toHaveBeenCalledTimes(2);
  });

  it('drains a 20-part notice in 7 one-minute ticks, in order, without skipping parts', async () => {
    const context = await setup();
    const prepare = vi.spyOn(context.db, 'prepare');
    context.listed.push(summary(id(1), -100));
    await context.tick();
    const value = noticeWithParts(id(10), 20, 2);
    const expected = formatNotification(value);
    expect(expected).toHaveLength(20);
    context.addNotice(value, 2);
    const perTick: { minute: number; poll: string; calls: object; sent: number; pending: number; statements: number }[] = [];
    for (let minute = 5; context.sent.length < 20 && minute < 60; minute++) {
      at(context, minute * MINUTE);
      prepare.mockClear();
      const result = await context.tick();
      expect(result.ok).toBe(true);
      perTick.push({
        minute, poll: result.poll, calls: result.calls, sent: result.sent,
        pending: result.queue!.pendingParts, statements: prepare.mock.calls.length,
      });
    }
    expect(perTick.map(item => item.sent)).toEqual([3, 3, 3, 3, 3, 3, 2]);
    expect(perTick.map(item => item.minute)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(perTick.map(item => item.poll)).toEqual(['listed', 'not_due', 'not_due', 'not_due', 'not_due', 'listed', 'not_due']);
    expect(perTick.map(item => item.calls)).toEqual([
      { oauthRefresh: 0, itadList: 1, itadDetail: 1, telegramSend: 3 },
      ...[6, 7, 8, 9].map(() => ({ oauthRefresh: 0, itadList: 0, itadDetail: 0, telegramSend: 3 })),
      { oauthRefresh: 0, itadList: 1, itadDetail: 0, telegramSend: 3 },
      { oauthRefresh: 0, itadList: 0, itadDetail: 0, telegramSend: 2 },
    ]);
    expect(context.sent.map(item => item.text)).toEqual(expected);
    for (let index = 1; index < context.sent.length; index++) {
      expect(context.sent[index]!.at - context.sent[index - 1]!.at).toBeGreaterThanOrEqual(1000);
    }
    expect(context.itad.waitlist).toHaveBeenCalledTimes(1);
    console.log(`I6-MEASURE tick ${JSON.stringify(perTick)}`);

    // Reference: the same notice with the previous 5-minute standalone cycle.
    const legacy = await setup();
    legacy.listed.push(summary(id(1), -100));
    await legacy.run();
    legacy.addNotice(noticeWithParts(id(10), 20, 2), 2);
    let cycles = 0;
    for (let minute = 5; legacy.sent.length < 20 && minute < 120; minute += 5) {
      legacy.clock.t = Math.max(legacy.clock.t, BASE + minute * MINUTE);
      await legacy.run();
      cycles++;
    }
    expect(cycles).toBe(7);
    console.log(`I6-MEASURE legacy5min cycles=${cycles} minutes=${(cycles - 1) * 5}`);
  });

  it('lets only one of several concurrent ticks query ITAD at the due instant', async () => {
    const context = await setup();
    context.listed.push(summary(id(1), -100));
    const results = await Promise.all([context.tick(), context.tick(), context.tick()]);
    expect(context.itad.list).toHaveBeenCalledTimes(1);
    expect(results.filter(item => item.pollGate === 'claimed')).toHaveLength(1);
    for (const item of results.filter(entry => entry.pollGate !== 'claimed')) {
      expect(['busy', 'not_due']).toContain(item.pollGate);
      expect(item.calls.itadList + item.calls.oauthRefresh + item.calls.itadDetail).toBe(0);
    }
  });

  it('gate CAS: busy while leased, takeover after LEASE_MS, stale owner cannot renew or complete', async () => {
    const context = await setup();
    const { storage } = context;
    const first = await storage.claimPoll('a', BASE);
    expect(first.status).toBe('claimed');
    expect(await storage.claimPoll('b', BASE + 1)).toEqual({ status: 'busy' });
    expect(await storage.claimPoll('b', BASE + LEASE_MS - 1)).toEqual({ status: 'busy' });
    const second = await storage.claimPoll('b', BASE + LEASE_MS);
    expect(second.status).toBe('claimed');
    if (first.status !== 'claimed' || second.status !== 'claimed') throw new Error('unreachable');
    expect(second.claim.version).toBe(first.claim.version + 1);
    expect(await storage.renewPoll(first.claim, BASE + LEASE_MS + 1)).toBeNull();
    expect(await storage.completePoll(first.claim, BASE + LEASE_MS + 1, { nextPollAt: BASE + 1, outcome: 'listed' })).toBe(false);
    const renewed = await storage.renewPoll(second.claim, BASE + LEASE_MS + 10);
    expect(renewed?.expiresAt).toBe(BASE + 2 * LEASE_MS + 10);
    expect(await storage.completePoll(renewed!, BASE + LEASE_MS + 20, { nextPollAt: BASE + 10 * 60_000, outcome: 'listed' })).toBe(true);
    expect(await storage.claimPoll('c', BASE + 5 * 60_000)).toEqual({ status: 'not_due', nextPollAt: BASE + 10 * 60_000 });
    expect((await storage.queueStatus()).nextPollAt).toBe(BASE + 10 * 60_000);
    await context.db.prepare('DELETE FROM poll_gate').run();
    await expect(storage.claimPoll('d', BASE + 20 * 60_000)).rejects.toMatchObject({ kind: 'state' });
  });

  it('preserves a list 429 retry_after longer than the interval; drain keeps running meanwhile', async () => {
    const context = await setup();
    context.listed.push(summary(id(1), -100));
    await context.tick();
    context.addNotice(noticeWithParts(id(10), 20, 1), 1);
    at(context, 5 * MINUTE);
    const planned = await context.tick();
    expect(planned).toMatchObject({ ok: true, detailsPlanned: 1, sent: 3 });
    at(context, 10 * MINUTE);
    context.listFailures.push(new ServiceError('rate_limit', 429, 900));
    const limited = await context.tick();
    // 900 s from the 429 minus the ~2 s spent on throttled sends after the poll.
    expect(limited).toMatchObject({ ok: false, poll: 'failed', sent: 3, nextPollInSeconds: 898 });
    expect(limited.errors).toContain('itad_rate_limit');
    for (const minute of [11, 15, 20, 24]) {
      at(context, minute * MINUTE);
      const result = await context.tick();
      expect(result.poll).toBe('not_due');
      expect(result.calls.itadList).toBe(0);
    }
    expect(context.itad.list).toHaveBeenCalledTimes(3);
    at(context, 25 * MINUTE);
    expect(await context.tick()).toMatchObject({ poll: 'listed', pollGate: 'claimed' });
    expect(context.sent.length).toBeGreaterThan(6);
  });

  it('a detail 429 also pushes the gate (never shortened) and keeps the notice pending', async () => {
    const context = await setup();
    context.listed.push(summary(id(1), -100));
    await context.tick();
    context.addNotice(notice(id(10)), 1);
    context.detailFailures.set(id(10), [new ServiceError('rate_limit', 429, 420)]);
    at(context, 5 * MINUTE);
    const result = await context.tick();
    expect(result).toMatchObject({ ok: false, detailsDeferred: 1, nextPollInSeconds: 420 });
    expect(result.errors).toContain('detail_rate_limit');
    at(context, 12 * MINUTE);
    expect(await context.tick()).toMatchObject({ ok: true, poll: 'listed', detailsPlanned: 1, sent: 1 });
  });

  it('retries a failed baseline only on the next due slot, never as success', async () => {
    const context = await setup();
    context.listed.push(summary(id(1), -100));
    context.listFailures.push(new ServiceError('http', 503));
    const failed = await context.tick();
    expect(failed).toMatchObject({ ok: false, poll: 'failed', nextPollInSeconds: 300 });
    expect(await context.storage.baselineComplete()).toBe(false);
    at(context, MINUTE);
    expect(await context.tick()).toMatchObject({ ok: true, poll: 'not_due' });
    expect(context.itad.list).toHaveBeenCalledTimes(1);
    at(context, 5 * MINUTE);
    expect(await context.tick()).toMatchObject({ ok: true, poll: 'baseline_initialized' });
  });

  it('surfaces an unreadable gate as an error, queries nothing and still drains', async () => {
    const context = await setup();
    context.listed.push(summary(id(1), -100));
    await context.tick();
    context.addNotice(noticeWithParts(id(10), 20, 1), 1);
    at(context, 5 * MINUTE);
    await context.tick();
    const currentOAuth = vi.spyOn(context.storage, 'currentOAuth');
    context.db.failWhen = sql => sql.includes('UPDATE poll_gate');
    at(context, 10 * MINUTE);
    const result = await context.tick();
    expect(result).toMatchObject({ ok: false, poll: 'gate_unavailable', pollGate: 'unavailable', sent: 3 });
    expect(result.errors).toEqual(expect.arrayContaining(['poll_gate_unavailable', 'unexpected']));
    expect(result.calls).toEqual({ oauthRefresh: 0, itadList: 0, itadDetail: 0, telegramSend: 3 });
    expect(currentOAuth).not.toHaveBeenCalled();
    context.db.failWhen = null;
    await context.db.prepare('DELETE FROM poll_gate').run();
    at(context, 11 * MINUTE);
    const missing = await context.tick();
    expect(missing).toMatchObject({ ok: false, poll: 'gate_unavailable' });
    expect(missing.errors).toEqual(expect.arrayContaining(['poll_gate_unavailable', 'storage_state']));
    expect(context.itad.list).toHaveBeenCalledTimes(2);
  });

  it('renews the 120 s lease during slow queries and stops querying once the lease is lost', async () => {
    const context = await setup();
    context.listed.push(summary(id(1), -100));
    await context.tick();
    [10, 11, 12].forEach((n, index) => context.addNotice(notice(id(n)), index + 1));
    const renew = vi.spyOn(context.storage, 'renewPoll');
    const original = context.itad.waitlist.getMockImplementation()!;
    context.itad.waitlist.mockImplementation(async (notificationId, token) => {
      context.clock.t += 70_000; // slow GET, still bounded by the 10 s client timeout in reality
      return original(notificationId, token);
    });
    at(context, 5 * MINUTE);
    const slow = await context.tick();
    expect(slow).toMatchObject({ ok: true, detailsPlanned: 3 });
    expect(renew).toHaveBeenCalledTimes(2);

    // Lost lease: another owner takes the gate while this invocation waits on a GET.
    [13, 14, 15].forEach((n, index) => context.addNotice(notice(id(n)), index + 4));
    context.itad.waitlist.mockImplementation(async (notificationId, token) => {
      context.clock.t += 70_000;
      await context.db.prepare("UPDATE poll_gate SET owner = 'intruder', claim_version = claim_version + 1").run();
      return original(notificationId, token);
    });
    at(context, 20 * MINUTE);
    const calls = context.itad.waitlist.mock.calls.length;
    const lost = await context.tick();
    expect(context.itad.waitlist.mock.calls.length - calls).toBe(1);
    expect(lost).toMatchObject({ ok: false, detailsPlanned: 1 });
    expect(lost.errors).toContain('poll_lease_lost');
    expect(lost.queue!.pendingDetails).toBe(2);
  });

  it('does not touch the gate or OAuth while reauthorization is pending', async () => {
    const context = await setup();
    await context.storage.setFlag('oauth_reauth', 'oauth_invalid_grant', BASE);
    const claim = vi.spyOn(context.storage, 'claimPoll');
    const result = await context.tick();
    expect(result).toMatchObject({ poll: 'reauth_required', pollGate: 'skipped' });
    expect(claim).not.toHaveBeenCalled();
    expect(context.itad.list).not.toHaveBeenCalled();
  });

  it('retries a failed refresh of an expiring token only on due ticks', async () => {
    const context = await setup({
      tokens: { accessToken: 'fake-access-0', refreshToken: 'fake-refresh-0', expiresAt: BASE + 2 * 60 * MINUTE, scope: 'notifications' },
    });
    context.listed.push(summary(id(1), -100));
    context.oauth.refresh.mockRejectedValueOnce(new ServiceError('network'));
    const first = await context.tick();
    expect(first.errors).toContain('oauth_refresh_network');
    for (const minute of [1, 2, 3, 4]) {
      at(context, minute * MINUTE);
      await context.tick();
    }
    expect(context.oauth.refresh).toHaveBeenCalledTimes(1);
    at(context, 5 * MINUTE);
    expect(await context.tick()).toMatchObject({ ok: true, oauthRefreshed: true });
    expect(context.oauth.refresh).toHaveBeenCalledTimes(2);
  });
});