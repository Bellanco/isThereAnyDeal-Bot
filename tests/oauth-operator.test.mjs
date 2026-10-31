import { describe, expect, it } from 'vitest';
import {
  parseArguments, productionAdminConfig, removeTemporaryDirectory, validAesKey,
} from '../scripts/oauth-provision.mjs';

const config = {
  account_id: '11111111111111111111111111111111',
  compatibility_date: '2026-10-27',
  d1_databases: [{
    database_name: 'itad-private-test',
    database_id: '11111111-1111-4111-8111-111111111111',
  }],
};

describe('OAuth operator CLI safety gates', () => {
  it('requires explicit live mode and narrowly parses exact operator actions', () => {
    expect(() => parseArguments([
      '--config', 'wrangler.production.local.jsonc', '--mode', 'initialize',
    ])).toThrow('arguments');
    expect(parseArguments([
      '--config', 'wrangler.production.local.jsonc', '--mode', 'initialize', '--live',
    ])).toEqual({
      configPath: 'wrangler.production.local.jsonc', mode: 'initialize', live: true,
    });
    expect(parseArguments([
      '--config', 'wrangler.production.local.jsonc', '--mode', 'recover',
      '--notification-id', '00000000-0000-4000-8000-000000000001',
      '--part-index', '0', '--action', 'retry', '--live',
    ])).toMatchObject({ mode: 'recover', partIndex: 0, action: 'retry' });
    for (const option of ['--key', '--token', '--client-secret', '--expected-version']) {
      expect(() => parseArguments([
        '--config', 'wrangler.production.local.jsonc', '--mode', 'initialize',
        '--live', option, 'must-not-be-accepted',
      ])).toThrow('arguments');
    }
  });

  it('accepts only canonical Base64 AES-256 keys without printing or persisting them', () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    expect(validAesKey(key)).toBe(true);
    expect(validAesKey('not-a-key')).toBe(false);
    expect(validAesKey(`${key}x`)).toBe(false);
  });

  it('uses only a local remote-binding Worker config with no production routes or cron', () => {
    const generated = productionAdminConfig(config, 'A'.repeat(43), 'C:/project/scripts/oauth-admin-worker.ts');
    expect(generated.d1_databases).toEqual([{
      binding: 'DB', database_name: 'itad-private-test',
      database_id: '11111111-1111-4111-8111-111111111111', remote: true,
    }]);
    expect(generated.vars).toMatchObject({ APP_MODE: 'oauth-admin', OAUTH_ADMIN_CAPABILITY: 'A'.repeat(43) });
    expect(generated.workers_dev).toBe(false);
    expect(generated.triggers).toBeUndefined();
    expect(generated.routes).toBeUndefined();
    expect(JSON.stringify(generated)).not.toMatch(/accessToken|refreshToken|OAUTH_TOKEN_KEY|TELEGRAM/);
  });

  it('retries locked temp cleanup and never turns a cleanup failure into an operation error', async () => {
    const calls = [];
    await expect(removeTemporaryDirectory('C:/tmp/itad-oauth-admin-x', async (dir, options) => {
      calls.push([dir, options]);
    })).resolves.toBe(true);
    expect(calls).toEqual([['C:/tmp/itad-oauth-admin-x', {
      recursive: true, force: true, maxRetries: 10, retryDelay: 200,
    }]]);
    await expect(removeTemporaryDirectory('C:/tmp/itad-oauth-admin-y', async () => {
      throw Object.assign(new Error('locked'), { code: 'EBUSY' });
    })).resolves.toBe(false);
  });
});
