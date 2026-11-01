import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItadClient, MAX_BUNDLE_PAGE } from '../src/itad-client';
import { HTTP_TIMEOUT_MS, JsonHttpClient, ServiceError, type HttpTransport } from '../src/itad-http';
import list from './fixtures/notifications-list.json';
import detail from './fixtures/notifications-waitlist-detail.json';

const mockToken = 'mock-access-token-not-real';
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, ...(headers === undefined ? {} : { headers }) });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ITAD GET client I2', () => {
  it('uses exact GET routes and Authorization only, validates official examples without filtering read', async () => {
    const requests: Request[] = [];
    const transport: HttpTransport = async request => {
      requests.push(request);
      return json(requests.length === 1 ? list : detail);
    };
    const client = new ItadClient(transport);
    expect(await client.list(mockToken)).toEqual(list);
    expect(await client.waitlist(detail.id, mockToken)).toEqual(detail);
    expect(requests.map(request => request.url)).toEqual([
      'https://api.isthereanydeal.com/notifications/v1',
      `https://api.isthereanydeal.com/notifications/waitlist/v1?id=${detail.id}`,
    ]);
    for (const request of requests) {
      expect(request.method).toBe('GET');
      expect(request.headers.get('Authorization')).toBe(`Bearer ${mockToken}`);
      expect(request.url).not.toContain(mockToken);
      expect(request.body).toBeNull();
      expect(request.redirect).toBe('manual');
      expect(request.cache).toBe('no-store');
    }
  });

  it('does not interpret an empty valid list as a baseline or follow invented pagination', async () => {
    const transport = vi.fn(async () => json([], 200, { Link: '</invented>; rel="next"' }));
    expect(await new ItadClient(transport).list(mockToken)).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(['bad-id', `${detail.id}&token=secret`, ''])('rejects invalid id before transport: %s', async id => {
    const transport = vi.fn(async () => json(detail));
    await expect(new ItadClient(transport).waitlist(id, mockToken)).rejects.toMatchObject({ category: 'input' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['', 'bad token', 'bad\r\nheader'])('rejects unsafe access tokens before transport', async token => {
    const transport = vi.fn(async () => json(list));
    await expect(new ItadClient(transport).list(token)).rejects.toMatchObject({ category: 'input' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('supports variable length bearer tokens without JWT decoding', async () => {
    const token = 'a'.repeat(20_000);
    const transport = vi.fn(async () => json(list));
    await expect(new ItadClient(transport).list(token)).resolves.toEqual(list);
  });

  it.each([null, {}, { notifications: list }, [{ ...list[0], read: true }]])(
    'categorizes invalid list shape', async body => {
      await expect(new ItadClient(async () => json(body)).list(mockToken)).rejects.toMatchObject({ category: 'shape' });
    },
  );

  it.each([null, { ...detail, read: undefined }, { ...detail, id: '497f6eca-6276-4993-bfeb-53cbbbba6f08' }])(
    'rejects invalid or mismatched detail', async body => {
      await expect(new ItadClient(async () => json(body)).waitlist(detail.id, mockToken))
        .rejects.toMatchObject({ category: 'shape' });
    },
  );

  it.each([400, 401, 403, 404, 500, 503])('categorizes HTTP %i with no silent retry', async status => {
    const transport = vi.fn(async () => json({ status_code: status, reason_phrase: mockToken }, status));
    await expect(new ItadClient(transport).list(mockToken)).rejects.toMatchObject({ category: 'http', status });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect instead of following it (workerd has no redirect "error")', async () => {
    const transport = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } }));
    await expect(new ItadClient(transport).list(mockToken)).rejects.toMatchObject({ category: 'http', status: 302 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('sanitizes network rejection, raw body and parser errors', async () => {
    for (const transport of [
      async () => { throw new Error(`secret ${mockToken}`); },
      async () => new Response(mockToken),
      async () => json({ token: mockToken }),
    ]) {
      try {
        await new ItadClient(transport).list(mockToken);
        expect.fail('expected error');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect(String(error)).not.toContain(mockToken);
        expect(JSON.stringify(error)).not.toContain(mockToken);
        expect(error).not.toHaveProperty('cause');
      }
    }
  });
});

describe('injected JSON HTTP boundary', () => {
  it.each([
    ['12', 12], ['0', 0], ['Sat, 31 Oct 2026 15:00:07 GMT', 7],
    ['Sat, 31 Oct 2026 14:00:00 GMT', 0], ['-1', undefined],
    ['1.5', undefined], ['garbage', undefined], ['9007199254740992', undefined],
  ])('parses documented Retry-After header %s', async (header, expected) => {
    const transport = vi.fn(async () => json({ retry_after: 999, token: mockToken }, 429, { 'Retry-After': header }));
    const http = new JsonHttpClient(transport, () => Date.parse('2026-10-31T15:00:00Z'));
    await expect(http.request('https://api.isthereanydeal.com/notifications/v1', {}))
      .rejects.toMatchObject({ category: 'rate_limit', status: 429, retryAfterSeconds: expected });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not invent a retry delay when the header is missing', async () => {
    const http = new JsonHttpClient(async () => json({ retry_after: 999 }, 429));
    await expect(http.request('https://api.isthereanydeal.com/notifications/v1', {}))
      .rejects.toMatchObject({ category: 'rate_limit', retryAfterSeconds: undefined });
  });

  it('categorizes malformed JSON', async () => {
    await expect(new ItadClient(async () => new Response('{')).list(mockToken))
      .rejects.toMatchObject({ category: 'json', status: 200 });
  });

  it('categorizes a body stream network failure', async () => {
    const stream = new ReadableStream({ start(controller) { controller.error(new Error(mockToken)); } });
    await expect(new ItadClient(async () => new Response(stream)).list(mockToken))
      .rejects.toMatchObject({ category: 'network', status: 200 });
  });

  it.each(['transport', 'body'])('times out %s at 10s, even if transport ignores abort', async phase => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const transport: HttpTransport = request => {
      signal = request.signal;
      return phase === 'transport' ? new Promise(() => {}) :
        Promise.resolve(new Response(new ReadableStream({ start() { /* deliberately never completes */ } })));
    };
    const pending = new ItadClient(transport).list(mockToken);
    const assertion = expect(pending).rejects.toMatchObject({ category: 'timeout' });
    await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears deadline on success and failures', async () => {
    vi.useFakeTimers();
    await new ItadClient(async () => json(list)).list(mockToken);
    expect(vi.getTimerCount()).toBe(0);
    await expect(new ItadClient(async () => json({}, 500)).list(mockToken)).rejects.toMatchObject({ category: 'http' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

const API_KEY = 'test-api-key-not-real';
const GAME_A = '018d937f-1111-7000-8000-00000000000a';
const GAME_B = '018D937F-2222-7000-8000-00000000000B';
const GAME_C = '018d937f-3333-7000-8000-00000000000c';

function capture(body: unknown, status = 200) {
  const requests: Request[] = [];
  const transport: HttpTransport = async request => {
    requests.push(request);
    return json(body, status);
  };
  return { transport, requests };
}

const bundleItem = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, title: `Bundle ${id}`, page: { id: 1, name: 'Humble Bundle' },
  url: 'https://example.invalid/bundle?a=1&b=2', details: `https://isthereanydeal.com/specials/bundles/${id}/`,
  isMature: false, publish: '2026-10-31T10:00:00+01:00', expiry: null, note: null,
  tiers: [{
    price: { amount: 1, amountInt: 100, currency: 'EUR' }, addon: false,
    games: [{ id: GAME_A, slug: 'game-a', title: 'Game A', type: 'game', mature: false }],
  }],
  ...overrides,
});

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => undefined, (error: unknown) => error);
}

describe('ITAD OAuth reads for Waitlist banners and Collection', () => {
  it('reads the Waitlist games with OAuth only and keeps the best banner of each', async () => {
    const { transport, requests } = capture([
      { id: GAME_B, title: 'ignored', assets: { banner300: 'https://cdn.example/b300.jpg', banner600: 'https://cdn.example/b600.jpg?a=1&b=2' } },
      { id: GAME_A, assets: { banner400: 'https://cdn.example/b400.jpg', banner300: 'https://cdn.example/b300.jpg' } },
      { id: GAME_C, assets: { banner600: 'http://cdn.example/plain.jpg', banner400: 'javascript:alert(1)', banner300: 'https://cdn.example/a b.jpg' } },
      { id: '018d937f-4444-7000-8000-00000000000d' },
    ]);
    const games = await new ItadClient(transport, { apiKey: API_KEY }).waitlistGames(mockToken);
    expect(games).toEqual([
      { id: GAME_B.toLowerCase(), banner: 'https://cdn.example/b600.jpg?a=1&b=2' },
      { id: GAME_A, banner: 'https://cdn.example/b400.jpg' },
      { id: GAME_C, banner: null },
      { id: '018d937f-4444-7000-8000-00000000000d', banner: null },
    ]);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://api.isthereanydeal.com/waitlist/games/v1');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${mockToken}`);
    expect(request.headers.get('ITAD-API-Key')).toBeNull();
    expect(request.redirect).toBe('manual');
    expect(request.cache).toBe('no-store');
  });

  it('reads the Collection ids with OAuth only and lowercases them', async () => {
    const { transport, requests } = capture([{ id: GAME_B, title: 'ignored' }, { id: GAME_A }]);
    expect(await new ItadClient(transport, { apiKey: API_KEY }).collectionGameIds(mockToken))
      .toEqual([GAME_B.toLowerCase(), GAME_A]);
    const request = requests[0]!;
    expect(request.url).toBe('https://api.isthereanydeal.com/collection/games/v1');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${mockToken}`);
    expect(request.headers.get('ITAD-API-Key')).toBeNull();
  });

  const reads: Array<[string, (client: ItadClient, token?: string) => Promise<unknown>]> = [
    ['waitlistGames', (client, token = mockToken) => client.waitlistGames(token)],
    ['collectionGameIds', (client, token = mockToken) => client.collectionGameIds(token)],
  ];
  for (const [name, read] of reads) {
    it(`${name} rejects a body that is not a list of games with a valid id`, async () => {
      for (const body of [null, {}, { games: [] }, 'x', [null], [{}], [{ id: 'not-a-uuid' }], [{ id: 7 }]]) {
        await expect(read(new ItadClient(async () => json(body)))).rejects.toMatchObject({ category: 'shape' });
      }
    });

    it(`${name} classifies HTTP failures and rate limits without retrying or exposing the body`, async () => {
      const failed = vi.fn(async () => json({ reason_phrase: mockToken }, 403));
      const error = await failureOf(read(new ItadClient(failed)));
      expect(error).toMatchObject({ category: 'http', status: 403 });
      expect(JSON.stringify(error)).not.toContain(mockToken);
      const limited = vi.fn(async () => json({}, 429, { 'Retry-After': '30' }));
      await expect(read(new ItadClient(limited))).rejects.toMatchObject({ category: 'rate_limit', retryAfterSeconds: 30 });
      expect(failed).toHaveBeenCalledTimes(1);
      expect(limited).toHaveBeenCalledTimes(1);
    });

    it(`${name} rejects unsafe access tokens before any request`, async () => {
      const transport = vi.fn(async () => json([]));
      for (const token of ['', 'bad token', 'bad\r\nheader']) {
        await expect(read(new ItadClient(transport), token)).rejects.toMatchObject({ category: 'input' });
      }
      expect(transport).not.toHaveBeenCalled();
    });
  }

  it.each([
    ['waitlistGames', 3_000_000, (client: ItadClient) => client.waitlistGames(mockToken)],
    ['collectionGameIds', 1_500_000, (client: ItadClient) => client.collectionGameIds(mockToken)],
  ])('%s does not parse a body over its size cap, which protects the CPU budget', async (_name, cap, read) => {
    // Whitespace keeps the body valid JSON, so only the size check can make it fail.
    const body = (chars: number) => `[${' '.repeat(chars - 2)}]`;
    await expect(read(new ItadClient(async () => new Response(body(cap))))).resolves.toEqual([]);
    await expect(read(new ItadClient(async () => new Response(body(cap + 1)))))
      .rejects.toMatchObject({ category: 'shape', status: 200 });
  });
});

describe('ITAD bundles client (application API key)', () => {
  it('lists one page with the key only, country ES and adult bundles included', async () => {
    const { transport, requests } = capture([bundleItem(9101)]);
    const entries = await new ItadClient(transport, { apiKey: API_KEY }).bundles(0, 50);
    expect(entries).toEqual([{
      id: 9101,
      bundle: {
        id: 9101, title: 'Bundle 9101', shop: 'Humble Bundle', url: 'https://example.invalid/bundle?a=1&b=2',
        details: 'https://isthereanydeal.com/specials/bundles/9101/', note: null, mature: false,
        publish: '2026-10-31T10:00:00+01:00', expiry: null,
        tiers: [{
          price: { amount: 1, amountInt: 100, currency: 'EUR' }, addon: false,
          games: [{ id: GAME_A, slug: 'game-a', title: 'Game A', type: 'game', mature: false }],
        }],
      },
    }]);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://api.isthereanydeal.com/bundles/v1?country=ES&mature=true&offset=0&limit=50');
    expect(request.headers.get('ITAD-API-Key')).toBe(API_KEY);
    expect(request.headers.get('Authorization')).toBeNull();
    expect(request.url).not.toContain(API_KEY);
    expect(request.body).toBeNull();
    expect(request.redirect).toBe('manual');
    expect(request.cache).toBe('no-store');
  });

  it('asks for the requested window', async () => {
    const { transport, requests } = capture([]);
    expect(await new ItadClient(transport, { apiKey: API_KEY }).bundles(100, 25)).toEqual([]);
    expect(requests[0]!.url).toBe('https://api.isthereanydeal.com/bundles/v1?country=ES&mature=true&offset=100&limit=25');
  });

  it('needs the application key and never falls back to OAuth', async () => {
    const transport = vi.fn(async () => json([]));
    await expect(new ItadClient(transport).bundles(0, 10)).rejects.toMatchObject({ category: 'configuration' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['', 'short', 'has a space', 'line\r\nbreak', 'ñ'.repeat(10), 'x'.repeat(257)])(
    'refuses a key with an invalid form: %j', apiKey => {
      const error = (() => {
        try { new ItadClient(async () => json([]), { apiKey }); } catch (caught) { return caught; }
        return undefined;
      })();
      expect(error).toMatchObject({ category: 'configuration' });
      expect(String(error)).not.toContain('has a space');
    },
  );

  it.each([
    [-1, 10], [1.5, 10], [Number.NaN, 10], [2 ** 53, 10], [0, 0], [0, -1], [0, 1.5], [0, MAX_BUNDLE_PAGE + 1],
  ])('rejects offset %s with limit %s before any request', async (offset, limit) => {
    const transport = vi.fn(async () => json([]));
    await expect(new ItadClient(transport, { apiKey: API_KEY }).bundles(offset, limit))
      .rejects.toMatchObject({ category: 'input' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('accepts the largest allowed page', async () => {
    const { transport, requests } = capture([]);
    await new ItadClient(transport, { apiKey: API_KEY }).bundles(0, MAX_BUNDLE_PAGE);
    expect(requests[0]!.url).toContain(`limit=${MAX_BUNDLE_PAGE}`);
  });

  it.each([null, {}, 'x', [null], [{}], [{ id: 0 }], [{ id: -1 }], [{ id: '9101' }], [{ id: 1.5 }], [{ id: 1e15 }]])(
    'rejects a response that is not a list of bundles with usable ids: %j', async body => {
      await expect(new ItadClient(async () => json(body), { apiKey: API_KEY }).bundles(0, 10))
        .rejects.toMatchObject({ category: 'shape' });
    },
  );

  it('keeps the id of a bundle with an invalid body so the others still arrive', async () => {
    const { transport } = capture([bundleItem(1), { id: 2, title: 'broken' }, bundleItem(3, { tiers: 'nope' }), bundleItem(4)]);
    const entries = await new ItadClient(transport, { apiKey: API_KEY }).bundles(0, 10);
    expect(entries.map(entry => [entry.id, entry.bundle === null])).toEqual([[1, false], [2, true], [3, true], [4, false]]);
  });

  it.each([[302, 'http'], [401, 'http'], [403, 'http'], [500, 'http'], [429, 'rate_limit']])(
    'classifies HTTP %i as %s without exposing the key or the body', async (status, category) => {
      const transport = async () => json({ reason_phrase: API_KEY }, status, status === 429 ? { 'Retry-After': '9' } : undefined);
      const error = await failureOf(new ItadClient(transport, { apiKey: API_KEY }).bundles(0, 10));
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject(category === 'rate_limit' ? { category, status, retryAfterSeconds: 9 } : { category, status });
      expect(String(error)).not.toContain(API_KEY);
      expect(JSON.stringify(error)).not.toContain(API_KEY);
    },
  );

  it('does not retry by itself and reports network failures without the key', async () => {
    const transport = vi.fn(async () => { throw new Error(`secret ${API_KEY}`); });
    const error = await failureOf(new ItadClient(transport, { apiKey: API_KEY }).bundles(0, 10));
    expect(error).toMatchObject({ category: 'network' });
    expect(String(error)).not.toContain(API_KEY);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
