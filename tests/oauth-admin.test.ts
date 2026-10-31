import { describe, expect, it } from 'vitest';
import { createOAuthAdminHandler } from '../src/oauth-admin';
import { D1Storage } from '../src/d1-storage';
import { createTestDatabase } from './sqlite-d1';

const CAPABILITY = 'A'.repeat(43);
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY_VERSION = 'operator-test-v1';
const TOKENS = {
  accessToken: 'operator-access-secret',
  refreshToken: 'operator-refresh-secret',
  expiresAt: 1_900_000_000_000,
  scope: 'notifications',
};
const NOW = 1_800_000_000_000;
const ID = '00000000-0000-4000-8000-000000000123';

function request(path: string, value: unknown, capability = CAPABILITY) {
  return new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${capability}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

async function seedUnverified(db: ReturnType<typeof createTestDatabase>, category: string) {
  db.raw.prepare(
    `INSERT INTO known_notifications(notification_id, source, first_seen_at)
     VALUES(?, 'new', ?)`,
  ).run(ID, NOW);
  db.raw.prepare(
    `INSERT INTO notification_work(notification_id, status, detail_json, parts_json, part_count, planned_seq)
     VALUES(?, 'planned', '{}', '[]', 1, 1)`,
  ).run(ID);
  db.raw.prepare(
    `INSERT INTO delivery_parts(
       notification_id, part_index, text, status, blocked_category, blocked_at, attempts, next_attempt_at
     ) VALUES(?, 0, 'private fixture text', 'pending', ?, ?, 3, 5)`,
  ).run(ID, category, NOW);
}

describe('local-only OAuth operator adapter', () => {
  it('proves loopback server identity with a nonce without disclosing the bearer capability', async () => {
    const db = createTestDatabase();
    try {
      const handler = createOAuthAdminHandler(db, CAPABILITY, () => NOW);
      const nonce = 'B'.repeat(43);
      const result = await handler(request('/oauth-admin/probe', { nonce }, 'wrong-capability'));
      const resultBody = await body(result);
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(CAPABILITY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const signature = new Uint8Array(await crypto.subtle.sign(
        'HMAC', key, new TextEncoder().encode(`itad-oauth-admin-probe:v1:${nonce}`),
      ));
      const expected = btoa(String.fromCharCode(...signature))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(resultBody).toEqual({ ok: true, proof: expected });
      expect(JSON.stringify(resultBody)).not.toContain(CAPABILITY);
    } finally {
      db.raw.close();
    }
  });

  it('expires the local operator endpoints without allowing later writes', async () => {
    const db = createTestDatabase();
    try {
      let clock = NOW;
      const handler = createOAuthAdminHandler(db, CAPABILITY, () => clock, NOW + 1);
      clock = NOW + 1;
      const result = await handler(request('/oauth-admin/status', {}));
      expect(result.status).toBe(410);
      expect(await body(result)).toEqual({ ok: false, error: 'operator_session_expired' });
      expect(await D1Storage.readOAuthOperatorStatus(db)).toMatchObject({ sessionVersion: null });
    } finally {
      db.raw.close();
    }
  });

  it('requires its ephemeral capability and never exposes credential values', async () => {
    const db = createTestDatabase();
    try {
      const handler = createOAuthAdminHandler(db, CAPABILITY, () => NOW);
      const unauthenticated = await handler(request('/oauth-admin/import', {
        mode: 'initialize', key: KEY, keyVersion: KEY_VERSION, tokens: TOKENS,
        expectedSessionVersion: null,
      }, 'B'.repeat(43)));
      expect(unauthenticated.status).toBe(401);
      expect(await body(unauthenticated)).toEqual({ ok: false, error: 'unauthorized' });
      expect(await D1Storage.readOAuthOperatorStatus(db)).toMatchObject({ sessionVersion: null });

      const imported = await handler(request('/oauth-admin/import', {
        mode: 'initialize', key: KEY, keyVersion: KEY_VERSION, tokens: TOKENS,
        expectedSessionVersion: null,
      }));
      expect(imported.status).toBe(200);
      const importedBody = await body(imported);
      expect(importedBody).toEqual({
        ok: true, result: 'stored', sessionVersion: 1,
      });
      expect(JSON.stringify(importedBody)).not.toContain('operator-access-secret');
      expect(JSON.stringify(db.raw.prepare('SELECT * FROM oauth_credentials').all()))
        .not.toMatch(/operator-(access|refresh)-secret/);

      const verified = await handler(request('/oauth-admin/verify', {
        mode: 'initialize', key: KEY, keyVersion: KEY_VERSION, tokens: TOKENS,
        expectedSessionVersion: 1,
      }));
      expect(await body(verified)).toMatchObject({ ok: true, matches: true, sessionVersion: 1 });
    } finally {
      db.raw.close();
    }
  });

  it('reauthorizes with CAS, clears only oauth_reauth, and leaves delivery_halt untouched', async () => {
    const db = createTestDatabase();
    try {
      const storage = await D1Storage.create(db, KEY, KEY_VERSION);
      await storage.initializeOAuthTokens(TOKENS);
      await storage.setFlag('oauth_reauth', 'oauth_invalid_grant', NOW);
      await storage.setFlag('delivery_halt', 'telegram_forbidden', NOW);
      const handler = createOAuthAdminHandler(db, CAPABILITY, () => NOW + 1);
      const replacement = { ...TOKENS, accessToken: 'new-access-secret', refreshToken: 'new-refresh-secret' };
      const stale = await handler(request('/oauth-admin/import', {
        mode: 'reauthorize', key: KEY, keyVersion: KEY_VERSION, tokens: replacement,
        expectedSessionVersion: 7,
      }));
      expect(stale.status).toBe(409);
      expect(await storage.oauthSessionVersion()).toBe(1);
      expect(await storage.flags()).toEqual({
        oauth_reauth: 'oauth_invalid_grant', delivery_halt: 'telegram_forbidden',
      });

      const replaced = await handler(request('/oauth-admin/import', {
        mode: 'reauthorize', key: KEY, keyVersion: KEY_VERSION, tokens: replacement,
        expectedSessionVersion: 1,
      }));
      expect(replaced.status).toBe(200);
      expect(await body(replaced)).toMatchObject({ ok: true, result: 'reauthorized', sessionVersion: 2 });
      expect(await storage.flags()).toEqual({ delivery_halt: 'telegram_forbidden' });
      expect((await storage.currentOAuth())?.tokens).toEqual(replacement);
    } finally {
      db.raw.close();
    }
  });

  it('allows only one concurrent reauthorization for the same expected version', async () => {
    const db = createTestDatabase();
    try {
      const storage = await D1Storage.create(db, KEY, KEY_VERSION);
      await storage.initializeOAuthTokens(TOKENS);
      const handler = createOAuthAdminHandler(db, CAPABILITY, () => NOW + 2);
      const contenders = ['winner-a', 'winner-b'].map(accessToken => handler(request('/oauth-admin/import', {
        mode: 'reauthorize', key: KEY, keyVersion: KEY_VERSION,
        tokens: { ...TOKENS, accessToken, refreshToken: `${accessToken}-refresh` },
        expectedSessionVersion: 1,
      })));
      const results = await Promise.all(contenders);
      expect(results.map(result => result.status).sort()).toEqual([200, 409]);
      expect(await storage.oauthSessionVersion()).toBe(2);
      const current = (await storage.currentOAuth())!;
      expect(['winner-a', 'winner-b']).toContain(current.tokens.accessToken);
      expect(db.raw.prepare('SELECT COUNT(*) AS count FROM oauth_nonce_history').get()?.count).toBe(2);
    } finally {
      db.raw.close();
    }
  });

  it('requires exact pending unverified categories and explicit duplicate-risk acknowledgement', async () => {
    const db = createTestDatabase();
    try {
      await seedUnverified(db, 'unverified_message_id');
      db.raw.prepare(
        `INSERT INTO bridge_flags(flag_key, category, set_at)
         VALUES('delivery_halt', 'telegram_chat_mismatch', ?)`,
      ).run(NOW);
      const handler = createOAuthAdminHandler(db, CAPABILITY, () => NOW + 10);
      const preview = await handler(request('/oauth-admin/recovery-preview', {
        notificationId: ID, partIndex: 0,
      }));
      expect(await body(preview)).toEqual({
        ok: true, status: 'pending', blockedCategory: 'unverified_message_id',
      });

      const unconfirmed = await handler(request('/oauth-admin/recovery', {
        action: 'retry-possible-duplicate', notificationId: ID, partIndex: 0,
        operatorConfirmed: false, duplicateRiskAcknowledged: false,
      }));
      expect(unconfirmed.status).toBe(400);

      const retried = await handler(request('/oauth-admin/recovery', {
        action: 'retry-possible-duplicate', notificationId: ID, partIndex: 0,
        operatorConfirmed: false, duplicateRiskAcknowledged: true,
      }));
      expect(await body(retried)).toEqual({ ok: true, result: 'retry-possible-duplicate' });
      expect(db.raw.prepare(
        'SELECT status, blocked_category, attempts, next_attempt_at FROM delivery_parts WHERE notification_id = ? AND part_index = 0',
      ).get(ID)).toEqual({
        status: 'pending', blocked_category: null, attempts: 3, next_attempt_at: NOW + 10,
      });
      expect(await D1Storage.readOAuthOperatorStatus(db)).toMatchObject({
        flags: { delivery_halt: 'telegram_chat_mismatch' },
      });
    } finally {
      db.raw.close();
    }
  });

  it('manually confirms only ambiguous sends after operator confirmation; preserves other rows and flags', async () => {
    const db = createTestDatabase();
    try {
      await seedUnverified(db, 'unverified_json');
      const handler = createOAuthAdminHandler(db, CAPABILITY, () => NOW);
      const result = await handler(request('/oauth-admin/recovery', {
        action: 'confirm-delivered', notificationId: ID, partIndex: 0,
        operatorConfirmed: true, duplicateRiskAcknowledged: false,
      }));
      expect(await body(result)).toEqual({ ok: true, result: 'confirm-delivered' });
      expect(db.raw.prepare(
        'SELECT status, receipt, blocked_category FROM delivery_parts WHERE notification_id = ? AND part_index = 0',
      ).get(ID)).toEqual({
        status: 'confirmed', receipt: `operator_manual:${NOW}`, blocked_category: null,
      });

      db.raw.prepare(
        `INSERT INTO delivery_parts(notification_id, part_index, text, status, blocked_category, attempts, next_attempt_at)
         VALUES(?, 1, 'fixture', 'pending', 'unverified_chat_mismatch', 1, 0)`,
      ).run(ID);
      const mismatch = await handler(request('/oauth-admin/recovery', {
        action: 'confirm-delivered', notificationId: ID, partIndex: 1,
        operatorConfirmed: true, duplicateRiskAcknowledged: false,
      }));
      expect(mismatch.status).toBe(409);
      expect(db.raw.prepare(
        'SELECT status, blocked_category FROM delivery_parts WHERE notification_id = ? AND part_index = 1',
      ).get(ID)).toEqual({ status: 'pending', blocked_category: 'unverified_chat_mismatch' });
    } finally {
      db.raw.close();
    }
  });
});
