import {
  bearer, JsonHttpClient, oauthErrorCode, ServiceError, type HttpTransport,
} from './itad-http';

const AUTHORIZE = 'https://isthereanydeal.com/oauth/authorize/';
const TOKEN = 'https://isthereanydeal.com/oauth/token/';
const ATTEMPT_TTL_MS = 10 * 60_000;

/**
 * Requested grant: `notifications` is the core; `wait_read` (banners, bundle cross-check)
 * and `coll_read` ("in your Collection" marks) enrich it. Only `notifications` is mandatory.
 */
export const OAUTH_SCOPE = 'notifications wait_read coll_read';

/** Explicit standard authentication choice; ITAD's actual accepted method is an I3 gate. */
export type ClientAuthentication =
  | { method: 'public' }
  | { method: 'client_secret_post'; secret: string }
  | { method: 'client_secret_basic'; secret: string };

export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
  authentication: ClientAuthentication;
}

/** Sensitive data; memory only, never serialize or log. */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string;
}

function opaque(value: unknown, category: 'configuration' | 'input' | 'shape'): string {
  if (typeof value !== 'string' || !value || !value.isWellFormed() || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new ServiceError(category);
  }
  return value;
}

function callbackUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ServiceError('configuration'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.search || url.hash) throw new ServiceError('configuration');
  return url;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkceChallenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new ServiceError('input');
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

function randomValue(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

export class OAuthClient {
  #config: OAuthConfig;
  #http: JsonHttpClient;
  #now: () => number;

  constructor(config: OAuthConfig, transport: HttpTransport, now: () => number = Date.now) {
    opaque(config.clientId, 'configuration');
    callbackUrl(config.redirectUri);
    if (!['public', 'client_secret_post', 'client_secret_basic'].includes(config.authentication.method)) {
      throw new ServiceError('configuration');
    }
    if (config.authentication.method !== 'public') opaque(config.authentication.secret, 'configuration');
    this.#config = { ...config, authentication: { ...config.authentication } };
    this.#now = now;
    this.#http = new JsonHttpClient(transport, now);
  }

  async begin(): Promise<OAuthAttempt> {
    return OAuthAttempt.create(this, this.#config.clientId, this.#config.redirectUri, this.#now);
  }

  async exchange(code: string, verifier: string): Promise<OAuthTokens> {
    opaque(code, 'input');
    await pkceChallenge(verifier);
    return this.#grant({
      grant_type: 'authorization_code', code, code_verifier: verifier,
      redirect_uri: this.#config.redirectUri,
    }, null, OAUTH_SCOPE);
  }

  async refresh(previous: OAuthTokens): Promise<OAuthTokens> {
    if (previous.refreshToken === null) throw new ServiceError('authorization_required');
    return this.#grant({
      grant_type: 'refresh_token', refresh_token: opaque(previous.refreshToken, 'input'),
    }, previous.refreshToken, previous.scope);
  }

  async #grant(fields: Record<string, string>, oldRefresh: string | null, oldScope: string): Promise<OAuthTokens> {
    const form = new URLSearchParams(fields);
    const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
    const auth = this.#config.authentication;
    if (auth.method === 'client_secret_basic') {
      headers.set('Authorization', `Basic ${btoa(`${formEncode(this.#config.clientId)}:${formEncode(auth.secret)}`)}`);
    } else {
      form.set('client_id', this.#config.clientId);
      if (auth.method === 'client_secret_post') form.set('client_secret', auth.secret);
    }
    // Conservative local lifetime: do not extend validity by the response's network delay.
    const requestedAt = this.#now();
    const body = await this.#http.request(TOKEN, { method: 'POST', headers, body: form.toString() }, true);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ServiceError('shape');
    const item = body as Record<string, unknown>;
    const accessToken = bearer(item.access_token, 'shape');
    if (typeof item.token_type !== 'string' || item.token_type.toLowerCase() !== 'bearer') throw new ServiceError('shape');
    let expiresAt: number | null = null;
    if ('expires_in' in item) {
      if (typeof item.expires_in !== 'number' || !Number.isSafeInteger(item.expires_in) || item.expires_in < 0) {
        throw new ServiceError('shape');
      }
      expiresAt = requestedAt + item.expires_in * 1000;
      if (!Number.isSafeInteger(expiresAt)) throw new ServiceError('shape');
    }
    const refreshToken = 'refresh_token' in item ? opaque(item.refresh_token, 'shape') : oldRefresh;
    const scope = 'scope' in item ? item.scope : oldScope;
    if (typeof scope !== 'string' || !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(scope) ||
        !scope.split(' ').includes('notifications')) throw new ServiceError('shape');
    return { accessToken, refreshToken, expiresAt, scope };
  }
}

/** Private state/verifier, short TTL, one valid callback (including denial) consumes it. */
export class OAuthAttempt {
  #client: OAuthClient;
  #state: string;
  #verifier: string;
  #url: string;
  #redirect: URL;
  #expiresAt: number;
  #now: () => number;
  #used = false;

  private constructor(client: OAuthClient, clientId: string, redirect: string, now: () => number,
    state: string, verifier: string, challenge: string) {
    this.#client = client;
    this.#state = state;
    this.#verifier = verifier;
    this.#redirect = callbackUrl(redirect);
    this.#now = now;
    this.#expiresAt = now() + ATTEMPT_TTL_MS;
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirect,
      scope: OAUTH_SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    this.#url = url.toString();
  }

  static async create(client: OAuthClient, clientId: string, redirect: string, now: () => number): Promise<OAuthAttempt> {
    const state = randomValue();
    const verifier = randomValue();
    return new OAuthAttempt(client, clientId, redirect, now, state, verifier, await pkceChallenge(verifier));
  }

  /** Sensitive one-time URL, for local browser handoff only. Never print in chat/logs. */
  localAuthorizationUrl(): string {
    this.#check();
    return this.#url;
  }

  async complete(request: Request): Promise<OAuthTokens> {
    this.#check();
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== this.#redirect.origin || url.pathname !== this.#redirect.pathname ||
        url.hash || url.username || url.password) throw new ServiceError('input');
    const query = url.searchParams;
    if (query.getAll('state').length !== 1 || query.get('state') !== this.#state) throw new ServiceError('state');
    // Consume synchronously before any async token request; replay cannot race it.
    this.#used = true;
    this.#state = '';
    this.#url = '';
    const verifier = this.#verifier;
    this.#verifier = '';
    if (query.has('error')) {
      if (query.getAll('error').length !== 1 || query.has('code')) throw new ServiceError('input');
      throw new ServiceError('oauth', undefined, undefined, oauthErrorCode(query.get('error')));
    }
    if (query.getAll('code').length !== 1) throw new ServiceError('input');
    return this.#client.exchange(opaque(query.get('code'), 'input'), verifier);
  }

  cancel(): void {
    this.#used = true;
    this.#state = '';
    this.#verifier = '';
    this.#url = '';
  }

  #check(): void {
    if (this.#used) throw new ServiceError('state');
    if (this.#now() >= this.#expiresAt) {
      this.cancel();
      throw new ServiceError('expired');
    }
  }
}

/** No durable storage. Single-flight refresh and atomic replacement within this instance only. */
export class MemoryOAuthSession {
  #client: OAuthClient;
  #tokens: OAuthTokens | null = null;
  #pending: Promise<string> | null = null;
  #generation = 0;
  #now: () => number;

  constructor(client: OAuthClient, now: () => number = Date.now) {
    this.#client = client;
    this.#now = now;
  }

  install(tokens: OAuthTokens): void {
    this.#generation++;
    this.#tokens = { ...tokens };
    this.#pending = null;
  }

  clear(): void {
    this.#generation++;
    this.#tokens = null;
    this.#pending = null;
  }

  /** Caller may invalidate after 401; no hidden GET retry or automatic API call. */
  invalidateAccess(): void {
    if (this.#tokens) this.#tokens = { ...this.#tokens, expiresAt: 0 };
  }

  async accessToken(): Promise<string> {
    if (this.#pending) return this.#pending;
    const tokens = this.#tokens;
    if (!tokens) throw new ServiceError('authorization_required');
    // Missing expires_in is not decoded from JWT or assigned an invented lifetime.
    if (tokens.expiresAt === null || this.#now() < tokens.expiresAt) return tokens.accessToken;
    const generation = this.#generation;
    const work = async (): Promise<string> => {
      try {
        const next = await this.#client.refresh(tokens);
        if (generation !== this.#generation) throw new ServiceError('authorization_required');
        this.#tokens = next;
        return next.accessToken;
      } catch (error) {
        if (error instanceof ServiceError) {
          if (generation === this.#generation && error.oauthCode === 'invalid_grant') this.clear();
          throw error;
        }
        throw new ServiceError('shape');
      } finally {
        if (generation === this.#generation) this.#pending = null;
      }
    };
    this.#pending = work();
    return this.#pending;
  }
}

/** Loopback instrument, NOT a listener. An I3 adapter must bind only 127.0.0.1 and stop after completion. */
export function loopbackCallback(attempt: OAuthAttempt, session: MemoryOAuthSession): HttpTransport {
  return async request => {
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Type': 'text/plain' };
    try {
      session.install(await attempt.complete(request));
      return new Response('Autorizacion recibida. Cierra esta ventana.', { headers });
    } catch (error) {
      const category = error instanceof ServiceError ? error.category : 'shape';
      return new Response(`OAuth no completado: ${category}`, { status: 400, headers });
    }
  };
}
