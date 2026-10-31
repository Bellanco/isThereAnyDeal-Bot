import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItadClient } from '../src/itad-client';
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
