import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkProduction } from '../scripts/check-production.mjs';

const template = JSON.parse(readFileSync(new URL('../wrangler.production.jsonc', import.meta.url), 'utf8'));
function prepared() {
  const config = structuredClone(template);
  config.name = 'itad-telegram-production-test';
  config.account_id = '11111111111111111111111111111111';
  config.d1_databases[0].database_name = 'itad-production-test';
  config.d1_databases[0].database_id = '11111111-1111-4111-8111-111111111111';
  config.vars.OAUTH_CLIENT_ID = 'public-test-client';
  config.vars.OAUTH_REDIRECT_URI = 'http://127.0.0.1:8765/callback';
  config.vars.OAUTH_TOKEN_KEY_VERSION = 'test-v1';
  return config;
}

describe('I7 offline production configuration', () => {
  it('leaves default mock without cron or database', () => {
    const mock = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    expect(mock.vars.APP_MODE).toBe('mock');
    expect(mock.triggers).toBeUndefined();
    expect(mock.d1_databases).toBeUndefined();
  });
  it('keeps production template disabled with no HTTP surface or secret values', () => {
    expect(template.vars.APP_MODE).toBe('production');
    expect(template.vars.LIVE_DELIVERY).toBe('disabled');
    expect(template.triggers.crons).toEqual([]);
    expect(template.workers_dev).toBe(false);
    expect(template.preview_urls).toBe(false);
    expect(template.routes).toBeUndefined();
    expect(Object.keys(template.vars)).toEqual([
      'APP_MODE', 'LIVE_DELIVERY', 'OAUTH_CLIENT_ID', 'OAUTH_REDIRECT_URI', 'OAUTH_TOKEN_KEY_VERSION',
    ]);
  });
  it('rejects unreplaced public placeholders before cloud commands', () => {
    expect(() => checkProduction(template)).toThrow('production_config_rejected:placeholders');
  });
  it('accepts the exact panel observability block in both stages', () => {
    const config = prepared();
    expect(config.observability).toEqual({
      logs: { enabled: true, invocation_logs: true },
      traces: { enabled: false },
    });
    expect(checkProduction(config)).toBe('production_config_valid_offline_only');
    config.vars.LIVE_DELIVERY = 'enabled';
    config.triggers.crons = ['* * * * *'];
    expect(checkProduction(config, true)).toBe('production_config_valid_offline_only');
  });
  it('still accepts existing configurations without observability', () => {
    const config = prepared();
    delete config.observability;
    expect(checkProduction(config)).toBe('production_config_valid_offline_only');
    config.vars.LIVE_DELIVERY = 'enabled';
    config.triggers.crons = ['* * * * *'];
    expect(checkProduction(config, true)).toBe('production_config_valid_offline_only');
  });
  it.each([
    null, undefined, true, 'enabled', [], {},
    { logs: null, traces: { enabled: false } },
    { logs: [], traces: { enabled: false } },
    { logs: { enabled: true }, traces: { enabled: false } },
    { logs: { enabled: true, invocation_logs: true } },
    { logs: { enabled: true, invocation_logs: true }, traces: null },
    { logs: { enabled: true, invocation_logs: true }, traces: [] },
    { logs: { enabled: true, invocation_logs: true }, traces: {} },
    { logs: { enabled: 'true', invocation_logs: true }, traces: { enabled: false } },
    { logs: { enabled: true, invocation_logs: 1 }, traces: { enabled: false } },
    { logs: { enabled: true, invocation_logs: true }, traces: { enabled: 'false' } },
    { logs: { enabled: true, invocation_logs: true }, traces: { enabled: false }, enabled: true },
    { logs: { enabled: true, invocation_logs: true, head_sampling_rate: 1 }, traces: { enabled: false } },
    { logs: { enabled: true, invocation_logs: true }, traces: { enabled: false, destinations: [] } },
  ])('rejects unsupported observability shape, keys or types (case %#)', observability => {
    const config = prepared();
    config.observability = observability;
    expect(() => checkProduction(config)).toThrow('production_config_rejected:observability');
  });
  it('accepts replaced configuration only in the explicitly requested stage', () => {
    const config = prepared();
    expect(checkProduction(config)).toBe('production_config_valid_offline_only');
    expect(() => checkProduction(config, true)).toThrow('production_config_rejected:activation');
    config.vars.LIVE_DELIVERY = 'enabled';
    config.triggers.crons = ['* * * * *'];
    expect(checkProduction(config, true)).toBe('production_config_valid_offline_only');
    expect(() => checkProduction(config)).toThrow('production_config_rejected:activation');
  });
  it('rejects partial activation and a five-minute drain cron', () => {
    const config = prepared();
    config.triggers.crons = ['* * * * *'];
    expect(() => checkProduction(config)).toThrow('production_config_rejected:activation');
    config.vars.LIVE_DELIVERY = 'enabled';
    config.triggers.crons = ['*/5 * * * *'];
    expect(() => checkProduction(config, true)).toThrow('production_config_rejected:activation');
  });
  it('rejects plaintext secrets as vars and mock bindings without logging them', () => {
    const config = prepared();
    config.vars.TELEGRAM_BOT_TOKEN = 'not-a-real-secret';
    expect(() => checkProduction(config)).toThrow('production_config_rejected:vars');
    delete config.vars.TELEGRAM_BOT_TOKEN;
    config.vars.MOCK_CHAT_ID = 'mock:test';
    expect(() => checkProduction(config)).toThrow('production_config_rejected:vars');
  });
  it('rejects public HTTP exposure and extra application bindings', () => {
    for (const change of [
      { workers_dev: true }, { routes: ['example.invalid/*'] },
      { services: [{ binding: 'ADMIN', service: 'test' }] },
    ]) expect(() => checkProduction(Object.assign(prepared(), change))).toThrow('production_config_rejected:surface');
  });
  it('requires the DB binding and a compatible exact loopback callback', () => {
    const config = prepared();
    config.d1_databases[0].binding = 'OTHER';
    expect(() => checkProduction(config)).toThrow('production_config_rejected:database');
    config.d1_databases[0].binding = 'DB';
    for (const uri of ['https://example.invalid/callback', 'http://localhost:8765/callback', 'http://127.0.0.1:8765/callback?code=hidden']) {
      config.vars.OAUTH_REDIRECT_URI = uri;
      expect(() => checkProduction(config)).toThrow('production_config_rejected:callback');
    }
  });
});
