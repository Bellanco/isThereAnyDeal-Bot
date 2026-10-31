import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDeal, MAX_TEXT } from '../src/domain';
import { createReceiver, MAX_BODY_BYTES } from '../src/http';
import { createWorker } from '../src/index';
import { MemoryStore, MockDelivery } from '../src/mocks';
import { notify } from '../src/notify';
import { DeliveryError, type Delivery } from '../src/ports';
import { isPing, parseGames } from '../src/validation';
import official from './fixtures/notification-waitlist.json';
import ping from './fixtures/ping.json';

const hook = '497f6eca-6276-4993-bfeb-53cbbbba6f08';
const config = { key: 'local-mock-only', chat: 'mock:local' };
const env = {
  APP_MODE: 'mock', MOCK_RECEIVER_KEY: config.key, MOCK_CHAT_ID: config.chat,
  MOCK_FAILURE: 'none', MOCK_FAIL_AT: '1',
};

function payload() {
  return structuredClone(official);
}

function request(body: unknown = official, event = 'notification-waitlist', headers: Record<string, string> = {}) {
  return new Request('http://localhost/webhooks/itad', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'user-agent': 'ITAD-Webhooks/1.0 (+https://isthereanydeal.com)',
      'itad-event': event, 'itad-hook-id': hook, 'x-mock-receiver-key': config.key, ...headers,
    },
    body: JSON.stringify(body),
  });
}

function setup(delivery: Delivery = new MockDelivery(), store = new MemoryStore()) {
  const send = vi.spyOn(delivery, 'send');
  return { receive: createReceiver(config, delivery, store), send, store };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden in tests'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('official ping contract', () => {
  it('accepts only the JSON string pong', () => {
    expect(isPing(ping)).toBe(true);
    expect(isPing({ event: 'ping' })).toBe(false);
    expect(isPing('ping')).toBe(false);
    expect(isPing(null)).toBe(false);
  });
});

describe('HTTP reception', () => {
  it('delivers the official example only to the configured mock chat', async () => {
    const { receive, send } = setup();
    const response = await receive(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: 'mock', sent: 1, skipped: 0 });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      chat_id: config.chat,
      text: `Stardew Valley\nGOG\n13.99 EUR (-0%)\n${official[0]!.deals[0]!.url}`,
    });
  });

  it('answers official ping without delivery or storage', async () => {
    const { receive, send, store } = setup();
    const claim = vi.spyOn(store, 'claim');
    const response = await receive(request(ping, 'ping'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: 'mock', pong: true });
    expect(send).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it('handles several games and several deals', async () => {
    const data = payload();
    data[0]!.deals.push({ ...data[0]!.deals[0]!, shop: { id: 61, name: 'Steam' } });
    data.push({ ...data[0]!, id: hook, title: 'Second game' });
    const { receive, send } = setup();
    expect((await receive(request(data))).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('accepts empty official arrays without inventing deliveries', async () => {
    const { receive, send } = setup();
    expect((await receive(request([]))).status).toBe(200);
    const data = payload();
    data[0]!.deals = [];
    expect((await receive(request(data))).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['missing protection', { 'x-mock-receiver-key': '' }, 401],
    ['wrong protection', { 'x-mock-receiver-key': 'wrong' }, 401],
    ['wrong type', { 'content-type': 'text/plain' }, 415],
    ['invalid hook', { 'itad-hook-id': 'not-a-uuid' }, 400],
    ['unsupported event', { 'itad-event': 'other' }, 400],
    ['event-id does not replace event', { 'itad-event': '', 'itad-event-id': hook }, 400],
    ['invalid user agent', { 'user-agent': 'unknown' }, 400],
  ] as const)('rejects %s without delivery', async (_label, headers, status) => {
    const { receive, send } = setup();
    expect((await receive(request(official, 'notification-waitlist', headers))).status).toBe(status);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects wrong ping body', async () => {
    const { receive, send } = setup();
    expect((await receive(request({ event: 'ping' }, 'ping'))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects unknown paths and methods', async () => {
    const { receive } = setup();
    expect((await receive(new Request('http://localhost/'))).status).toBe(404);
    const response = await receive(new Request('http://localhost/webhooks/itad'));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('rejects malformed JSON and invalid UTF-8', async () => {
    const { receive, send } = setup();
    for (const body of ['{', new Uint8Array([0xff])]) {
      const original = request();
      expect((await receive(new Request(original.url, { method: 'POST', headers: original.headers, body }))).status).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('limits declared and streamed body bytes, even with a false length', async () => {
    const { receive, send } = setup();
    expect((await receive(request(official, 'notification-waitlist', { 'content-length': String(MAX_BODY_BYTES + 1) }))).status).toBe(413);
    const source = request();
    source.headers.set('content-length', '1');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const streamed = new Request(source.url, {
      method: 'POST', headers: source.headers, body,
      ...({ duplex: 'half' } as Record<string, string>),
    });
    expect((await receive(streamed)).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores injected destination and token fields', async () => {
    const data = payload();
    Object.assign(data[0]!, { chat_id: 'attacker', token: 'not-a-real-token' });
    const { receive, send } = setup();
    expect((await receive(request(data))).status).toBe(200);
    expect(send.mock.calls[0]![0].chat_id).toBe(config.chat);
    expect(JSON.stringify(send.mock.calls)).not.toContain('not-a-real-token');
  });
});

describe('validation and formatting', () => {
  it.each([
    ['missing required title', (data: ReturnType<typeof payload>) => { Reflect.deleteProperty(data[0]!, 'title'); }],
    ['missing nullable voucher', (data: ReturnType<typeof payload>) => { Reflect.deleteProperty(data[0]!.deals[0]!, 'voucher'); }],
    ['wrong price', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.price.amount = -1; }],
    ['fractional integer price', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.price.amountInt = 1.1; }],
    ['wrong currency', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.price.currency = 'euro'; }],
    ['wrong discount', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.cut = 101; }],
    ['wrong date', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.timestamp = 'yesterday'; }],
    ['impossible date', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.timestamp = '2026-02-30T00:00:00Z'; }],
    ['hour overflow', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.timestamp = '2026-01-01T24:00:00Z'; }],
    ['unsafe URL', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.url = 'javascript:alert(1)'; }],
    ['URL with credentials', (data: ReturnType<typeof payload>) => { data[0]!.deals[0]!.url = 'https://user:pass@example.com/'; }],
    ['broken unicode', (data: ReturnType<typeof payload>) => { data[0]!.title = '\ud800'; }],
  ])('rejects %s', async (_label, mutate) => {
    const data = payload();
    mutate(data);
    const { receive, send } = setup();
    expect((await receive(request(data))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('supports nullable metadata, voucher, expiry and flags without parse_mode', async () => {
    const data = payload();
    Object.assign(data[0]!, { type: null, historyLow: null, lastPrice: null, title: '<b>literal</b> [title]' });
    Object.assign(data[0]!.deals[0]!, { storeLow: null, voucher: 'SAVE&10', expiry: '2026-12-01T00:00:00Z', flag: 'H' });
    const { receive, send } = setup();
    expect((await receive(request(data))).status).toBe(200);
    expect(send.mock.calls[0]![0].text).toContain('<b>literal</b> [title]');
    expect(send.mock.calls[0]![0].text).toContain('Cupon: SAVE&10');
    expect(send.mock.calls[0]![0]).not.toHaveProperty('parse_mode');
  });

  it('accepts empty voucher strings and leap-day timestamps', () => {
    const data = payload();
    Object.assign(data[0]!.deals[0]!, { voucher: '', timestamp: '2024-02-29T00:00:00Z' });
    expect(parseGames(data)[0]!.deals[0]!.voucher).toBe('');
  });

  it('preserves the whole affiliate URL byte for byte', () => {
    const [game] = parseGames(official);
    const deal = game!.deals[0]!;
    deal.url = 'https://example.com/offer?affiliate=itad&url=https%3A%2F%2Fshop.example%2F%3Fa%3D1#offer';
    expect(formatDeal(game!, deal).join('\n')).toContain(deal.url);
  });

  it('splits long Unicode text without loss or broken surrogates and keeps URLs atomic', () => {
    const [game] = parseGames(official);
    game!.title = 'Title \u{1f3ae}'.repeat(1500);
    const deal = game!.deals[0]!;
    deal.url = `https://example.com/${'x'.repeat(MAX_TEXT - 20)}`;
    const messages = formatDeal(game!, deal);
    expect(messages.length).toBeGreaterThan(2);
    expect(messages.every(text => text.length > 0 && text.length <= MAX_TEXT && text.isWellFormed())).toBe(true);
    expect(messages.join('')).toContain(game!.title);
    expect(messages.at(-1)).toBe(deal.url);
  });

  it('accepts a 4096-unit URL but rejects longer URLs before any delivery', async () => {
    const data = payload();
    data[0]!.deals[0]!.url = `https://example.com/${'x'.repeat(MAX_TEXT - 20)}`;
    expect(data[0]!.deals[0]!.url.length).toBe(MAX_TEXT);
    const { receive, send } = setup();
    expect((await receive(request(data))).status).toBe(200);
    const second = { ...data[0]!, id: hook, deals: [{ ...data[0]!.deals[0]!, url: `${data[0]!.deals[0]!.url}x` }] };
    send.mockClear();
    expect((await receive(request([official[0], second]))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects oversized game and offer batches', async () => {
    const { receive, send } = setup();
    expect((await receive(request(Array.from({ length: 101 }, () => official[0])))).status).toBe(400);
    const data = payload();
    data[0]!.deals = Array.from({ length: 201 }, () => data[0]!.deals[0]!);
    expect((await receive(request(data))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the mock cap of 100 DRM/platform entries per deal', async () => {
    const entries = (n: number) => Array.from({ length: n }, (_, index) => ({ id: index + 1, name: `E-${index}` }));
    const { receive, send } = setup();
    for (const key of ['drm', 'platforms'] as const) {
      const over = payload();
      over[0]!.deals[0]![key] = entries(101);
      expect((await receive(request(over))).status).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
    const exact = payload();
    exact[0]!.deals[0]!.drm = entries(100);
    exact[0]!.deals[0]!.platforms = entries(100);
    expect((await receive(request(exact))).status).toBe(200);
  });

  it('bounds formatting amplification before delivery', async () => {
    const data = payload();
    data[0]!.title = 'x'.repeat(12_000);
    data[0]!.deals = Array.from({ length: 200 }, () => data[0]!.deals[0]!);
    const { receive, send } = setup();
    const response = await receive(request(data));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'too_many_messages' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('confirmed deliveries and recovery', () => {
  it('deduplicates repeats, including within a batch', async () => {
    const { receive, send } = setup();
    expect((await receive(request([official[0], official[0]]))).status).toBe(200);
    const response = await receive(request());
    expect(await response.json()).toEqual({ mode: 'mock', sent: 0, skipped: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['network', 'http', 'rejected', 'rate-limit', 'invalid-response'] as const)(
    'recovers a partial %s failure without resending the confirmed part', async failure => {
      const data = payload();
      data[0]!.deals.push({ ...data[0]!.deals[0]!, shop: { id: 61, name: 'Steam' } });
      const { receive, send } = setup(new MockDelivery(failure, 2));
      const first = await receive(request(data));
      expect(first.status).toBe(503);
      expect(first.headers.get('retry-after')).toBe(failure === 'rate-limit' ? '2' : null);
      const retry = await receive(request(data));
      expect(await retry.json()).toEqual({ mode: 'mock', sent: 1, skipped: 1 });
      expect(send).toHaveBeenCalledTimes(3);
      expect((await receive(request(data))).status).toBe(200);
      expect(send).toHaveBeenCalledTimes(3);
    },
  );

  it('does not confirm before success and returns busy during concurrent delivery', async () => {
    let finish!: (value: { message_id: number }) => void;
    const pending = new Promise<{ message_id: number }>(resolve => { finish = resolve; });
    let started!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    const delivery: Delivery = { send: vi.fn(() => { started(); return pending; }) };
    const { receive, store } = setup(delivery);
    const confirm = vi.spyOn(store, 'confirm');
    const first = receive(request());
    await start;
    expect(confirm).not.toHaveBeenCalled();
    const second = await receive(request());
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('1');
    finish({ message_id: 1 });
    expect((await first).status).toBe(200);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((await receive(request())).status).toBe(200);
    expect(delivery.send).toHaveBeenCalledTimes(1);
  });

  it('recovers partial multi-message offers', async () => {
    const data = payload();
    data[0]!.title = 'x'.repeat(5000);
    const { receive, send } = setup(new MockDelivery('network', 2));
    expect((await receive(request(data))).status).toBe(503);
    const response = await receive(request(data));
    expect(await response.json()).toEqual({ mode: 'mock', sent: 1, skipped: 1 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('rejects an invalid receipt without confirming and retries later', async () => {
    const delivery: Delivery = { send: vi.fn().mockResolvedValueOnce({ message_id: 0 }).mockResolvedValue({ message_id: 1 }) };
    const { receive, store } = setup(delivery);
    const confirm = vi.spyOn(store, 'confirm');
    expect((await receive(request())).status).toBe(503);
    expect(confirm).not.toHaveBeenCalled();
    expect((await receive(request())).status).toBe(200);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('bounds storage without evicting confirmed keys', async () => {
    const store = new MemoryStore(1);
    expect(await store.claim('first')).toBe('claimed');
    await store.confirm('first', 1);
    await expect(store.claim('second')).rejects.toBeInstanceOf(DeliveryError);
    expect(await store.claim('first')).toBe('confirmed');
  });

  it('loses deduplication on restart by design', async () => {
    const delivery = new MockDelivery();
    const send = vi.spyOn(delivery, 'send');
    await notify(parseGames(official), hook, config.chat, delivery, new MemoryStore());
    await notify(parseGames(official), hook, config.chat, delivery, new MemoryStore());
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('safe Worker composition', () => {
  it('works with mock configuration and retains memory between requests', async () => {
    const worker = createWorker();
    expect(await (await worker.fetch(request(), env)).json()).toEqual({ mode: 'mock', sent: 1, skipped: 0 });
    expect(await (await worker.fetch(request(), env)).json()).toEqual({ mode: 'mock', sent: 0, skipped: 1 });
  });

  it.each([
    {}, { ...env, APP_MODE: 'real' }, { ...env, TELEGRAM_BOT_TOKEN: 'not-a-real-token' },
    { ...env, TELEGRAM_CHAT_ID: '123' }, { ...env, MOCK_CHAT_ID: '123' },
    { ...env, MOCK_RECEIVER_KEY: '' }, { ...env, MOCK_FAILURE: 'unknown' },
    { ...env, MOCK_FAIL_AT: '0' }, { ...env, MOCK_FAIL_AT: '1e2' },
  ])('fails closed for missing, live or invalid configuration %#', async settings => {
    const response = await createWorker().fetch(request(), settings);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'configuration_rejected_real_mode_not_implemented' });
  });

  it('does not log payloads, errors or mock credentials', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const response = await createWorker().fetch(request(), { ...env, MOCK_FAILURE: 'network' });
    expect(response.status).toBe(503);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});