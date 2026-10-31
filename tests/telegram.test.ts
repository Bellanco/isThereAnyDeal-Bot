import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TEXT } from '../src/domain';
import { HTTP_TIMEOUT_MS } from '../src/itad-http';
import {
  parsePrivateChatId, RATE_LIMIT_FALLBACK_SECONDS, TelegramClient, TelegramConfigurationError, TelegramError,
} from '../src/telegram';

const TOKEN = '123456:fake-token-for-tests-only_xyz';
const CHAT = 4242;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden in tests'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

const success = (overrides: Record<string, unknown> = {}) => ({
  ok: true, result: { message_id: 77, date: 1, chat: { id: CHAT, type: 'private' }, text: 'x', ...overrides },
});

async function failure(response: Response | (() => Promise<Response>)): Promise<TelegramError> {
  const transport = typeof response === 'function' ? response : async () => response;
  const client = new TelegramClient(transport, TOKEN, CHAT);
  try {
    await client.send('hola');
  } catch (error) {
    expect(error).toBeInstanceOf(TelegramError);
    const value = error as TelegramError;
    expect(value.message).not.toContain(TOKEN);
    expect(JSON.stringify(value)).not.toContain(TOKEN);
    return value;
  }
  throw new Error('expected failure');
}

describe('Telegram sendMessage contract', () => {
  it('posts plain JSON text only to the configured chat, without parse_mode', async () => {
    const transport = vi.fn(async (_request: Request) => reply(success()));
    const receipt = await new TelegramClient(transport, TOKEN, CHAT).send('Aviso ñ 🎮 https://example.invalid/a?ref=x');
    expect(receipt).toEqual({ messageId: 77 });
    const request = transport.mock.calls[0]![0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.json()).toEqual({ chat_id: CHAT, text: 'Aviso ñ 🎮 https://example.invalid/a?ref=x' });
    // workerd rejects 'error'; 'manual' plus explicit rejection never follows a redirect.
    expect(request.redirect).toBe('manual');
    expect(request.cache).toBe('no-store');
  });

  it('rejects a redirect instead of following it', async () => {
    const error = await failure(new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } }));
    expect([error.category, error.reason, error.status]).toEqual(['rejected', 'redirect', 302]);
  });

  it.each([
    ['message_id 0 (scheduled/ephemeral)', success({ message_id: 0 }), 'message_id'],
    ['missing message_id', success({ message_id: undefined }), 'message_id'],
    ['fractional message_id', success({ message_id: 1.5 }), 'message_id'],
    ['other chat', success({ chat: { id: CHAT + 1, type: 'private' } }), 'chat_mismatch'],
    ['chat as string', success({ chat: { id: String(CHAT), type: 'private' } }), 'chat_mismatch'],
    ['group chat', success({ chat: { id: CHAT, type: 'group' } }), 'not_private'],
    ['result missing', { ok: true }, 'message_id'],
  ])('does not accept an unverifiable success: %s', async (_name, body, reason) => {
    const error = await failure(reply(body));
    expect(error.category).toBe('unverified');
    expect(error.reason).toBe(reason);
  });

  it('treats a 200 with invalid JSON or unknown shape as unverified, never as success', async () => {
    expect((await failure(reply('<html>', 200))).category).toBe('unverified');
    expect((await failure(reply({ result: {} }, 200))).reason).toBe('shape');
  });

  it('uses parameters.retry_after from 429 and a documented fallback without it', async () => {
    const limited = await failure(reply({ ok: false, error_code: 429, description: 'x', parameters: { retry_after: 17 } }, 429));
    expect([limited.category, limited.retryAfterSeconds]).toEqual(['rate_limit', 17]);
    const fallback = await failure(reply({ ok: false, error_code: 429, description: 'x' }, 429));
    expect(fallback.retryAfterSeconds).toBe(RATE_LIMIT_FALLBACK_SECONDS);
    const invalid = await failure(reply({ ok: false, error_code: 429, parameters: { retry_after: -1 } }, 429));
    expect(invalid.retryAfterSeconds).toBe(RATE_LIMIT_FALLBACK_SECONDS);
  });

  it('never follows migrate_to_chat_id', async () => {
    const transport = vi.fn(async () => reply({
      ok: false, error_code: 400, description: 'migrated', parameters: { migrate_to_chat_id: -100123 },
    }, 400));
    const error = await failure(transport);
    expect([error.category, error.reason]).toEqual(['destination', 'migrated']);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    [500, 'transient', 'http_5xx'], [502, 'transient', 'http_5xx'], [400, 'rejected', 'bad_request'],
    [401, 'destination', 'unauthorized'], [403, 'destination', 'forbidden'], [404, 'destination', 'not_found'],
    [409, 'rejected', 'http_4xx'],
  ])('classifies HTTP %i without exposing the description', async (status, category, reason) => {
    const error = await failure(reply({ ok: false, error_code: status, description: `secret ${TOKEN}` }, status));
    expect([error.category, error.reason, error.status]).toEqual([category, reason, status]);
    expect(error.message).not.toContain('secret');
  });

  it('classifies network errors and the 10 second timeout as transient', async () => {
    expect((await failure(async () => { throw new TypeError(`fail ${TOKEN}`); })).reason).toBe('network');
    vi.useFakeTimers();
    const pending = failure(() => new Promise<Response>(() => undefined));
    await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS);
    const error = await pending;
    expect([error.category, error.reason]).toEqual(['transient', 'timeout']);
  });

  it('validates text and configuration before any request', async () => {
    const transport = vi.fn(async () => reply(success()));
    const client = new TelegramClient(transport, TOKEN, CHAT);
    for (const text of ['', 'x'.repeat(MAX_TEXT + 1), '\uD800']) {
      await expect(client.send(text)).rejects.toMatchObject({ category: 'input' });
    }
    await expect(client.send('x'.repeat(MAX_TEXT))).resolves.toEqual({ messageId: 77 });
    expect(transport).toHaveBeenCalledTimes(1);
    for (const token of ['', 'abc', '123:short', '123:has/slash-and-more-characters', '123:bad?query=1aaaaaaaaaaaaaaaa']) {
      expect(() => new TelegramClient(transport, token, CHAT)).toThrow(TelegramConfigurationError);
    }
    for (const chat of ['', '0', '-100123', '12.5', '1e5', ' 12', '99999999999999999']) {
      expect(() => parsePrivateChatId(chat)).toThrow(TelegramConfigurationError);
    }
    expect(parsePrivateChatId('123456789')).toBe(123456789);
  });
});
