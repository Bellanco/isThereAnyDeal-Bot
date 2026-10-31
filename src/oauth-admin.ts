import {
  D1Storage, StorageError, type D1Database,
} from './d1-storage';
import type { OAuthTokens } from './oauth';
import { UUID } from './validation';

const MAX_BODY_BYTES = 16 * 1024;
const PROBE_NONCE = /^[A-Za-z0-9_-]{43}$/;
const KEY_VERSION = /^[A-Za-z0-9._-]{1,32}$/;
const UNVERIFIED_CATEGORIES = new Set([
  'unverified_json', 'unverified_shape', 'unverified_message_id',
]);

type JsonRecord = Record<string, unknown>;

function response(status: number, body: JsonRecord): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  a.fill(0);
  b.fill(0);
  return difference === 0;
}

async function readJson(request: Request): Promise<JsonRecord | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as JsonRecord;
  } catch {
    return null;
  } finally {
    bytes.fill(0);
    chunks.forEach(chunk => chunk.fill(0));
  }
}

function exactKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function validTokens(value: unknown): value is OAuthTokens {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const tokens = value as JsonRecord;
  return exactKeys(tokens, ['accessToken', 'refreshToken', 'expiresAt', 'scope']) &&
    typeof tokens.accessToken === 'string' &&
    (tokens.refreshToken === null || typeof tokens.refreshToken === 'string') &&
    (tokens.expiresAt === null || Number.isSafeInteger(tokens.expiresAt)) &&
    typeof tokens.scope === 'string';
}

function sameTokens(left: OAuthTokens, right: OAuthTokens): boolean {
  return constantTimeEqual(left.accessToken, right.accessToken) &&
    (left.refreshToken === null
      ? right.refreshToken === null
      : right.refreshToken !== null && constantTimeEqual(left.refreshToken, right.refreshToken)) &&
    left.expiresAt === right.expiresAt &&
    constantTimeEqual(left.scope, right.scope);
}

function storageErrorCategory(error: unknown): string {
  if (error instanceof StorageError) return `storage_${error.kind}`;
  return 'operation_failed';
}

/**
 * Handler used only by the short-lived local Wrangler worker. The production
 * Worker does not import it. OAuth material is accepted only in bounded,
 * authenticated loopback requests and is never returned or logged.
 */
export function createOAuthAdminHandler(
  db: D1Database,
  capability: string,
  now: () => number = Date.now,
  expiresAt = Number.MAX_SAFE_INTEGER,
): (request: Request) => Promise<Response> {
  if (typeof capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(capability)) {
    throw new StorageError('configuration');
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new StorageError('configuration');

  return async request => {
    if (now() >= expiresAt) return response(410, { ok: false, error: 'operator_session_expired' });
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.search || url.hash ||
        !['/oauth-admin/probe', '/oauth-admin/status', '/oauth-admin/import', '/oauth-admin/verify',
          '/oauth-admin/recovery-preview', '/oauth-admin/recovery'].includes(url.pathname)) {
      return response(404, { ok: false, error: 'not_found' });
    }
    const input = await readJson(request);
    if (!input) return response(400, { ok: false, error: 'invalid_input' });
    if (url.pathname === '/oauth-admin/probe') {
      if (!exactKeys(input, ['nonce']) || typeof input.nonce !== 'string' ||
          !PROBE_NONCE.test(input.nonce)) return response(400, { ok: false, error: 'invalid_input' });
      try {
        const key = await crypto.subtle.importKey(
          'raw', new TextEncoder().encode(capability), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
        );
        const signature = new Uint8Array(await crypto.subtle.sign(
          'HMAC', key, new TextEncoder().encode(`itad-oauth-admin-probe:v1:${input.nonce}`),
        ));
        const proof = btoa(String.fromCharCode(...signature))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        signature.fill(0);
        return response(200, { ok: true, proof });
      } catch {
        return response(500, { ok: false, error: 'operation_failed' });
      }
    }
    const authorization = request.headers.get('Authorization') ?? '';
    if (!constantTimeEqual(authorization, `Bearer ${capability}`)) {
      return response(401, { ok: false, error: 'unauthorized' });
    }

    try {
      if (url.pathname === '/oauth-admin/status') {
        if (!exactKeys(input, [])) return response(400, { ok: false, error: 'invalid_input' });
        const status = await D1Storage.readOAuthOperatorStatus(db);
        return response(200, {
          ok: true, sessionVersion: status.sessionVersion,
          reauthRequired: status.flags.oauth_reauth !== undefined,
        });
      }

      if (url.pathname === '/oauth-admin/recovery-preview') {
        if (!exactKeys(input, ['notificationId', 'partIndex']) ||
            typeof input.notificationId !== 'string' || !UUID.test(input.notificationId) ||
            !Number.isSafeInteger(input.partIndex) || (input.partIndex as number) < 0) {
          return response(400, { ok: false, error: 'invalid_input' });
        }
        const status = await D1Storage.readBlockedPartOperatorStatus(
          db, input.notificationId, input.partIndex as number,
        );
        if (!status) return response(404, { ok: false, error: 'part_not_found' });
        return response(200, { ok: true, status: status.status, blockedCategory: status.blockedCategory });
      }

      if (url.pathname === '/oauth-admin/recovery') {
        if (!exactKeys(input, [
          'action', 'notificationId', 'partIndex', 'operatorConfirmed', 'duplicateRiskAcknowledged',
        ]) || typeof input.notificationId !== 'string' || !UUID.test(input.notificationId) ||
            !Number.isSafeInteger(input.partIndex) || (input.partIndex as number) < 0) {
          return response(400, { ok: false, error: 'invalid_input' });
        }
        const part = await D1Storage.readBlockedPartOperatorStatus(
          db, input.notificationId, input.partIndex as number,
        );
        if (!part || part.status !== 'pending' || !UNVERIFIED_CATEGORIES.has(part.blockedCategory ?? '')) {
          return response(409, { ok: false, error: 'part_not_recoverable' });
        }
        let changed: boolean;
        if (input.action === 'confirm-delivered' && input.operatorConfirmed === true &&
            input.duplicateRiskAcknowledged === false) {
          changed = await D1Storage.confirmUnverifiedPartManually(
            db, input.notificationId, input.partIndex as number, now(), true,
          );
        } else if (input.action === 'retry-possible-duplicate' &&
            input.operatorConfirmed === false && input.duplicateRiskAcknowledged === true) {
          changed = await D1Storage.retryUnverifiedPartManually(
            db, input.notificationId, input.partIndex as number, now(), true,
          );
        } else {
          return response(400, { ok: false, error: 'explicit_confirmation_required' });
        }
        return changed
          ? response(200, { ok: true, result: input.action })
          : response(409, { ok: false, error: 'state_changed' });
      }

      if (url.pathname === '/oauth-admin/verify') {
        if (!exactKeys(input, ['mode', 'key', 'keyVersion', 'tokens', 'expectedSessionVersion']) ||
            !['initialize', 'reauthorize'].includes(String(input.mode)) ||
            typeof input.key !== 'string' || typeof input.keyVersion !== 'string' ||
            !KEY_VERSION.test(input.keyVersion) || !validTokens(input.tokens) ||
            !Number.isSafeInteger(input.expectedSessionVersion) ||
            (input.expectedSessionVersion as number) < 1) {
          return response(400, { ok: false, error: 'invalid_input' });
        }
        const storage = await D1Storage.create(db, input.key, input.keyVersion);
        const current = await storage.currentOAuth();
        return response(200, {
          ok: true,
          matches: current !== null &&
            current.sessionVersion === input.expectedSessionVersion &&
            sameTokens(current.tokens, input.tokens),
          sessionVersion: current?.sessionVersion ?? null,
        });
      }

      if (!exactKeys(input, [
        'mode', 'key', 'keyVersion', 'tokens', 'expectedSessionVersion',
      ]) || !['initialize', 'reauthorize'].includes(String(input.mode)) ||
          typeof input.key !== 'string' || typeof input.keyVersion !== 'string' ||
          !KEY_VERSION.test(input.keyVersion) || !validTokens(input.tokens)) {
        return response(400, { ok: false, error: 'invalid_input' });
      }

      const storage = await D1Storage.create(db, input.key, input.keyVersion);
      if (input.mode === 'initialize') {
        if (input.expectedSessionVersion !== null) return response(400, { ok: false, error: 'invalid_input' });
        const result = await storage.initializeOAuthTokens(input.tokens);
        const sessionVersion = await storage.oauthSessionVersion();
        if (sessionVersion === null) return response(500, { ok: false, error: 'operation_failed' });
        return response(200, { ok: true, result, sessionVersion });
      }

      if (!Number.isSafeInteger(input.expectedSessionVersion) ||
          (input.expectedSessionVersion as number) < 1) {
        return response(400, { ok: false, error: 'invalid_input' });
      }
      const replaced = await storage.replaceOAuthTokensAfterReauthorization(
        input.expectedSessionVersion as number, input.tokens,
      );
      return replaced
        ? response(200, {
          ok: true, result: 'reauthorized',
          sessionVersion: (input.expectedSessionVersion as number) + 1,
        })
        : response(409, { ok: false, error: 'session_conflict' });
    } catch (error) {
      // Only fixed categories leave this private adapter; never echo a provider,
      // database, URL, token, key, SQL or parser error.
      return response(500, { ok: false, error: storageErrorCategory(error) });
    } finally {
      if (typeof input.key === 'string') input.key = '';
      if (validTokens(input.tokens)) {
        input.tokens.accessToken = '';
        input.tokens.refreshToken = '';
        input.tokens.expiresAt = null;
        input.tokens.scope = '';
      }
    }
  };
}

export function validOAuthAdminEnvironment(value: unknown): value is {
  APP_MODE: 'oauth-admin';
  DB: D1Database;
  OAUTH_ADMIN_CAPABILITY: string;
  OAUTH_ADMIN_EXPIRES_AT: string;
} {
  if (!value || typeof value !== 'object') return false;
  const env = value as JsonRecord;
  return exactKeys(env, ['APP_MODE', 'DB', 'OAUTH_ADMIN_CAPABILITY', 'OAUTH_ADMIN_EXPIRES_AT']) &&
    env.APP_MODE === 'oauth-admin' &&
    !!env.DB && typeof env.DB === 'object' &&
    typeof (env.DB as D1Database).prepare === 'function' &&
    typeof (env.DB as D1Database).batch === 'function' &&
    typeof env.OAUTH_ADMIN_CAPABILITY === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(env.OAUTH_ADMIN_CAPABILITY) &&
    typeof env.OAUTH_ADMIN_EXPIRES_AT === 'string' &&
    /^[1-9]\d{11,15}$/.test(env.OAUTH_ADMIN_EXPIRES_AT) &&
    Number.isSafeInteger(Number(env.OAUTH_ADMIN_EXPIRES_AT));
}
