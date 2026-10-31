import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError, type HttpTransport } from '../src/itad-http';
import {
  loopbackCallback, MemoryOAuthSession, OAuthClient, pkceChallenge,
  type ClientAuthentication, type OAuthConfig, type OAuthTokens,
} from '../src/oauth';
import officialToken from './fixtures/oauth-token-rfc6749.json';
import officialError from './fixtures/oauth-error-rfc6749.json';

const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const redirect = 'http://127.0.0.1:32123/callback';
const config: OAuthConfig = {
  clientId: 'mock-client-not-real', redirectUri: redirect, authentication: { method: 'public' },
};
// RFC 6749 5.1 example with token_type derived for this Bearer-only client.
const success = { ...officialToken, token_type: 'Bearer' };
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, ...(headers === undefined ? {} : { headers }) });
function fields(form: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  form.forEach((value, key) => { result[key] = value; });
  return result;
}
const expired: OAuthTokens = {
  accessToken: 'mock-expired-access', refreshToken: 'mock-refresh-old', expiresAt: 0, scope: 'notifications',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OAuth standard grant contracts I2 (not real ITAD evidence)', () => {
  it('matches RFC 7636 Appendix B S256 fixture', async () => {
    expect(await pkceChallenge(verifier)).toBe(challenge);
  });

  it.each(['short', 'a'.repeat(129), ' '.repeat(43)])('rejects invalid verifier', async value => {
    await expect(pkceChallenge(value)).rejects.toMatchObject({ category: 'input' });
  });

  it('exchanges code using form POST, exact callback and no secrets in URL', async () => {
    const transport = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://isthereanydeal.com/oauth/token/');
      expect(request.method).toBe('POST');
      expect(request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
      const form = new URLSearchParams(await request.text());
      expect(fields(form)).toEqual({
        grant_type: 'authorization_code', code: 'mock-code', code_verifier: verifier,
        redirect_uri: redirect, client_id: config.clientId,
      });
      expect(request.headers.get('Authorization')).toBeNull();
      return json(success);
    });
    const tokens = await new OAuthClient(config, transport, () => 1000).exchange('mock-code', verifier);
    expect(tokens).toEqual({
      accessToken: officialToken.access_token, refreshToken: officialToken.refresh_token,
      expiresAt: 3_601_000, scope: 'notifications',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(['client_secret_post', 'client_secret_basic'] as const)('uses explicit %s without authentication fallback', async method => {
    const secret = 'mock:secret+é';
    const auth: ClientAuthentication = { method, secret };
    const transport = vi.fn(async (request: Request) => {
      const form = new URLSearchParams(await request.text());
      expect(request.url).not.toContain(secret);
      if (method === 'client_secret_post') {
        expect(form.get('client_secret')).toBe(secret);
        expect(form.get('client_id')).toBe(config.clientId);
        expect(request.headers.get('Authorization')).toBeNull();
      } else {
        const header = request.headers.get('Authorization')!;
        expect(atob(header.slice(6))).toBe('mock-client-not-real:mock%3Asecret%2B%C3%A9');
        expect(form.has('client_secret')).toBe(false);
        expect(form.has('client_id')).toBe(false);
      }
      return json(success);
    });
    await new OAuthClient({ ...config, authentication: auth }, transport).exchange('mock-code', verifier);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    officialToken, null, [], {}, { ...success, access_token: '' },
    { ...success, access_token: 'bad\nheader' }, { ...success, token_type: null },
    { ...success, expires_in: '3600' }, { ...success, expires_in: -1 },
    { ...success, expires_in: 0.5 }, { ...success, expires_in: Number.MAX_SAFE_INTEGER },
    { ...success, refresh_token: null }, { ...success, refresh_token: '' },
    { ...success, scope: 'wait_read' }, { ...success, scope: null },
    { ...success, scope: 'notifications\nwait_read' },
  ])('rejects unknown type/invalid token shape without retaining data', async body => {
    await expect(new OAuthClient(config, async () => json(body)).exchange('mock-code', verifier))
      .rejects.toMatchObject({ category: 'shape' });
  });

  it('accepts Bearer case-insensitively, optional fields and unknown properties', async () => {
    const client = new OAuthClient(config, async () => json({
      access_token: 'mock-access', token_type: 'bEaReR', ignored: 'unused',
    }));
    expect(await client.exchange('mock-code', verifier)).toEqual({
      accessToken: 'mock-access', refreshToken: null, expiresAt: null, scope: 'notifications',
    });
  });

  it.each(['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope'])(
    'categorizes standard token error %s without external descriptions', async code => {
      const transport = vi.fn(async () => json({
        ...officialError, error: code, error_description: 'mock-secret', error_uri: 'https://example.invalid/?token=mock-secret',
      }, code === 'invalid_client' ? 401 : 400));
      await expect(new OAuthClient(config, transport).exchange('mock-code', verifier))
        .rejects.toMatchObject({ category: 'oauth', oauthCode: code });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it('classifies unknown OAuth errors safely instead of a silent fallback', async () => {
    try {
      await new OAuthClient(config, async () => json({ error: 'mock-secret', error_description: 'mock-secret' }, 400))
        .exchange('mock-code', verifier);
      expect.fail('expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ category: 'oauth', oauthCode: undefined });
      expect(String(error)).not.toContain('mock-secret');
      expect(JSON.stringify(error)).not.toContain('mock-secret');
    }
  });

  it.each([
    [async () => { throw new Error('mock-secret'); }, 'network', undefined],
    [async () => new Response('mock-secret', { status: 502 }), 'json', 502],
    [async () => json({ reason_phrase: 'mock-secret' }, 503), 'http', 503],
    [async () => json({}, 429, { 'Retry-After': '4' }), 'rate_limit', 429],
  ] as const)('handles token transport/HTTP/JSON/429', async (transport, category, status) => {
    await expect(new OAuthClient(config, transport).exchange('mock-code', verifier))
      .rejects.toMatchObject({ category, status });
  });

  it('times out token exchange at 10 seconds', async () => {
    vi.useFakeTimers();
    let started: (() => void) | undefined;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const transport: HttpTransport = () => {
      started!();
      return new Promise(() => {});
    };
    const pending = new OAuthClient(config, transport).exchange('mock-code', verifier);
    const assertion = expect(pending).rejects.toMatchObject({ category: 'timeout' });
    // WebCrypto settles on the real thread; wait for transport, not an invented clock delay.
    await ready;
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});

describe('temporary PKCE/state and loopback instrument (no listener)', () => {
  it.each([
    'https://example.invalid/callback', 'http://localhost:32123/callback',
    'http://0.0.0.0:32123/callback', 'http://127.0.0.1/callback',
    `${redirect}?secret=value`, `${redirect}#fragment`, 'not a URL',
    'http://user:pass@127.0.0.1:32123/callback',
  ])('rejects non-exact/non-loopback configuration', redirectUri => {
    expect(() => new OAuthClient({ ...config, redirectUri }, async () => json(success)))
      .toThrowError('configuration');
  });

  it('creates random one-use state and S256, then validates and redeems only the callback', async () => {
    let postedVerifier = '';
    const transport = vi.fn(async (request: Request) => {
      postedVerifier = new URLSearchParams(await request.text()).get('code_verifier')!;
      return json(success);
    });
    const client = new OAuthClient(config, transport);
    const attempt = await client.begin();
    const another = await client.begin();
    const authorize = new URL(attempt.localAuthorizationUrl());
    const query = authorize.searchParams;
    expect(authorize.origin + authorize.pathname).toBe('https://isthereanydeal.com/oauth/authorize/');
    expect(query.get('response_type')).toBe('code');
    expect(query.get('client_id')).toBe(config.clientId);
    expect(query.get('redirect_uri')).toBe(redirect);
    expect(query.get('scope')).toBe('notifications');
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(query.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(query.has('code_verifier')).toBe(false);
    expect(query.has('client_secret')).toBe(false);
    expect(query.has('access_token')).toBe(false);
    expect(query.get('state')).not.toBe(new URL(another.localAuthorizationUrl()).searchParams.get('state'));
    another.cancel();
    const callback = new Request(`${redirect}?state=${query.get('state')}&code=mock-code`);
    const first = attempt.complete(callback);
    await expect(attempt.complete(callback)).rejects.toMatchObject({ category: 'state' });
    await first;
    expect(await pkceChallenge(postedVerifier)).toBe(query.get('code_challenge'));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(attempt)).toBe('{}');
    expect(() => attempt.localAuthorizationUrl()).toThrowError('state');
  });

  it.each(['missing', 'wrong', 'duplicate', 'path', 'origin', 'method'])('rejects callback %s before transport', async scenario => {
    const transport = vi.fn(async () => json(success));
    const attempt = await new OAuthClient(config, transport).begin();
    const state = new URL(attempt.localAuthorizationUrl()).searchParams.get('state')!;
    let url = `${redirect}?state=${state}&code=mock-code`;
    if (scenario === 'missing') url = `${redirect}?code=mock-code`;
    if (scenario === 'wrong') url = `${redirect}?state=wrong&code=mock-code`;
    if (scenario === 'duplicate') url += `&state=${state}`;
    if (scenario === 'path') url = url.replace('/callback', '/status');
    if (scenario === 'origin') url = url.replace('32123', '32124');
    await expect(attempt.complete(new Request(url, scenario === 'method' ? { method: 'POST' } : {})))
      .rejects.toMatchObject({ category: ['missing', 'wrong', 'duplicate'].includes(scenario) ? 'state' : 'input' });
    expect(transport).not.toHaveBeenCalled();
    // Invalid state/path must not consume the legitimate attempt.
    await expect(attempt.complete(new Request(`${redirect}?state=${state}&code=mock-code`))).resolves.toBeDefined();
  });

  it.each(['denied', 'duplicate-code', 'missing-code', 'exchange-failure'])('consumes valid state on %s; never retries codes', async scenario => {
    const transport = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
    const attempt = await new OAuthClient(config, transport).begin();
    const state = new URL(attempt.localAuthorizationUrl()).searchParams.get('state')!;
    const suffix = scenario === 'denied' ? '&error=access_denied&error_description=mock-secret' :
      scenario === 'duplicate-code' ? '&code=mock-one&code=mock-two' :
      scenario === 'missing-code' ? '' : '&code=mock-code';
    const callback = new Request(`${redirect}?state=${state}${suffix}`);
    await expect(attempt.complete(callback)).rejects.toBeInstanceOf(ServiceError);
    await expect(attempt.complete(callback)).rejects.toMatchObject({ category: 'state' });
    expect(transport).toHaveBeenCalledTimes(scenario === 'exchange-failure' ? 1 : 0);
  });

  it('expires and clears attempt, cancellation also prevents callbacks', async () => {
    let now = 1000;
    const transport = vi.fn(async () => json(success));
    const client = new OAuthClient(config, transport, () => now);
    const attempt = await client.begin();
    const url = new URL(attempt.localAuthorizationUrl());
    now += 600_000;
    await expect(attempt.complete(new Request(`${redirect}?state=${url.searchParams.get('state')}&code=mock-code`)))
      .rejects.toMatchObject({ category: 'expired' });
    const cancelled = await client.begin();
    cancelled.cancel();
    expect(() => cancelled.localAuthorizationUrl()).toThrowError('state');
    expect(transport).not.toHaveBeenCalled();
  });

  it('loopback handler has no status/token endpoint and responds without code, state or tokens', async () => {
    const client = new OAuthClient(config, async () => json(success));
    const session = new MemoryOAuthSession(client);
    const attempt = await client.begin();
    const state = new URL(attempt.localAuthorizationUrl()).searchParams.get('state')!;
    const handler = loopbackCallback(attempt, session);
    const status = await handler(new Request('http://127.0.0.1:32123/status'));
    expect(status.status).toBe(400);
    const response = await handler(new Request(`${redirect}?state=${state}&code=mock-code`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    const text = await response.text();
    for (const secret of [state, 'mock-code', officialToken.access_token, officialToken.refresh_token]) {
      expect(text).not.toContain(secret);
    }
    expect(await session.accessToken()).toBe(officialToken.access_token);
    expect(JSON.stringify(session)).toBe('{}');
    const replay = await handler(new Request(`${redirect}?state=${state}&code=mock-code`));
    expect(await replay.text()).toBe('OAuth no completado: state');
  });
});

describe('memory-only expiry/refresh/rotation', () => {
  it('uses unexpired access without network and refreshes at expiry', async () => {
    let now = 1000;
    const transport = vi.fn(async () => json(success));
    const session = new MemoryOAuthSession(new OAuthClient(config, transport, () => now), () => now);
    session.install({ ...expired, expiresAt: 2000 });
    expect(await session.accessToken()).toBe(expired.accessToken);
    expect(transport).not.toHaveBeenCalled();
    now = 2000;
    expect(await session.accessToken()).toBe(success.access_token);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('refresh rotation=%s keeps last refresh if omitted, uses replacement if present', async rotate => {
    const posted: URLSearchParams[] = [];
    const transport: HttpTransport = async request => {
      posted.push(new URLSearchParams(await request.text()));
      return json({
        access_token: `mock-access-${posted.length}`, token_type: 'Bearer', expires_in: 3600,
        ...(rotate ? { refresh_token: 'mock-refresh-new' } : {}),
      });
    };
    const session = new MemoryOAuthSession(new OAuthClient(config, transport));
    session.install(expired);
    expect(await session.accessToken()).toBe('mock-access-1');
    session.invalidateAccess();
    expect(await session.accessToken()).toBe('mock-access-2');
    expect(fields(posted[0]!)).toEqual({
      grant_type: 'refresh_token', refresh_token: expired.refreshToken, client_id: config.clientId,
    });
    expect(posted[1]!.get('refresh_token')).toBe(rotate ? 'mock-refresh-new' : expired.refreshToken);
    expect(posted[0]!.has('scope')).toBe(false);
    expect(posted[0]!.has('code')).toBe(false);
  });

  it('single-flight concurrent refresh within one memory instance', async () => {
    const transport = vi.fn(async () => json(success));
    const session = new MemoryOAuthSession(new OAuthClient(config, transport));
    session.install(expired);
    expect(await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]))
      .toEqual([success.access_token, success.access_token, success.access_token]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    [async () => { throw new Error('mock-secret'); }, 'network'],
    [async () => json({}, 429, { 'Retry-After': '3' }), 'rate_limit'],
    [async () => json({ access_token: 'mock-new', refresh_token: 'mock-rotated', token_type: null }), 'shape'],
  ] as const)('retains previous refresh on categorized failure; retry only explicit', async (failure, category) => {
    let calls = 0;
    let retryRefresh = '';
    const transport: HttpTransport = async request => {
      calls++;
      if (calls === 1) return failure();
      retryRefresh = new URLSearchParams(await request.text()).get('refresh_token')!;
      return json(success);
    };
    const session = new MemoryOAuthSession(new OAuthClient(config, transport));
    session.install(expired);
    await expect(session.accessToken()).rejects.toMatchObject({ category });
    expect(calls).toBe(1);
    await session.accessToken();
    expect(retryRefresh).toBe(expired.refreshToken);
  });

  it('revoked/expired refresh invalid_grant clears session and demands reauthorization, not retry', async () => {
    const transport = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
    const session = new MemoryOAuthSession(new OAuthClient(config, transport));
    session.install(expired);
    await expect(session.accessToken()).rejects.toMatchObject({ category: 'oauth', oauthCode: 'invalid_grant' });
    await expect(session.accessToken()).rejects.toMatchObject({ category: 'authorization_required' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not assume refresh is issued or permanent; omitted expiry is unknown, 401 invalidation is explicit', async () => {
    const transport = vi.fn(async () => json(success));
    const session = new MemoryOAuthSession(new OAuthClient(config, transport));
    await expect(session.accessToken()).rejects.toMatchObject({ category: 'authorization_required' });
    session.install({ ...expired, refreshToken: null, expiresAt: null });
    expect(await session.accessToken()).toBe(expired.accessToken);
    session.invalidateAccess();
    await expect(session.accessToken()).rejects.toMatchObject({ category: 'authorization_required' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['clear', 'replace'])('does not resurrect stale in-flight refresh after %s', async action => {
    let resolve: ((response: Response) => void) | undefined;
    const transport: HttpTransport = () => new Promise(done => { resolve = done; });
    const session = new MemoryOAuthSession(new OAuthClient(config, transport));
    session.install(expired);
    const pending = session.accessToken();
    const assertion = expect(pending).rejects.toMatchObject({ category: 'authorization_required' });
    expect(resolve).toBeDefined();
    if (action === 'clear') session.clear();
    else session.install({ ...expired, accessToken: 'mock-replaced', expiresAt: null });
    resolve!(json(success));
    await assertion;
    if (action === 'clear') await expect(session.accessToken()).rejects.toMatchObject({ category: 'authorization_required' });
    else expect(await session.accessToken()).toBe('mock-replaced');
  });
});
