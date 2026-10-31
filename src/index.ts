import { runTick, type BridgeLimits, type CycleSummary } from './bridge';
import { D1Storage, type D1Database } from './d1-storage';
import { createReceiver } from './http';
import { ItadClient } from './itad-client';
import type { HttpTransport } from './itad-http';
import {
  LOCAL_SIMULATION, LocalSimulation, SIMULATED_TELEGRAM_FAILURES, type SimulatedTelegramFailure,
} from './local-simulation';
import { FAILURES, MemoryStore, MockDelivery, type MockFailure } from './mocks';
import { OAuthClient, type OAuthConfig } from './oauth';
import { parsePrivateChatId, TelegramClient, validBotToken } from './telegram';

type Env = Record<string, unknown>;
const allowed = new Set(['APP_MODE', 'MOCK_CHAT_ID', 'MOCK_RECEIVER_KEY', 'MOCK_FAILURE', 'MOCK_FAIL_AT']);

function configuration(env: Env) {
  if (Object.keys(env).some(key => !allowed.has(key)) || env.APP_MODE !== 'mock' ||
      typeof env.MOCK_CHAT_ID !== 'string' || !/^mock:[a-z0-9_-]+$/i.test(env.MOCK_CHAT_ID) ||
      typeof env.MOCK_RECEIVER_KEY !== 'string' || env.MOCK_RECEIVER_KEY.length < 12 ||
      typeof env.MOCK_FAILURE !== 'string' || !FAILURES.includes(env.MOCK_FAILURE as MockFailure) ||
      typeof env.MOCK_FAIL_AT !== 'string' || !/^[1-9]\d*$/.test(env.MOCK_FAIL_AT) ||
      !Number.isSafeInteger(Number(env.MOCK_FAIL_AT))) {
    return null;
  }
  return {
    key: env.MOCK_RECEIVER_KEY, chat: env.MOCK_CHAT_ID,
    failure: env.MOCK_FAILURE as MockFailure, failAt: Number(env.MOCK_FAIL_AT),
  };
}

/** Minimal Workers scheduled types (no @cloudflare/workers-types dependency). */
export interface ScheduledEventLike {
  cron: string;
  scheduledTime: number;
}

export interface WorkerOptions {
  /** Production only. Defaults to global fetch, created lazily inside the production branch. */
  liveTransport?: HttpTransport;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  limits?: Partial<BridgeLimits>;
}

const LOCAL_KEYS = new Set(['APP_MODE', 'DB', 'SIMULATION_TELEGRAM_FAILURE', 'SIMULATION_FAIL_AT']);
const PRODUCTION_KEYS = new Set([
  'APP_MODE', 'LIVE_DELIVERY', 'DB', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'OAUTH_CLIENT_ID',
  'OAUTH_REDIRECT_URI', 'OAUTH_TOKEN_KEY', 'OAUTH_TOKEN_KEY_VERSION',
]);

class ScheduledConfigurationError extends Error {
  constructor() {
    super('scheduled_configuration_rejected');
    this.name = 'ScheduledConfigurationError';
  }
}

function database(value: unknown): D1Database {
  const db = value as D1Database | undefined;
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw new ScheduledConfigurationError();
  return db;
}

function owner(): string {
  return `cron-${crypto.randomUUID()}`;
}

export function createWorker(options: WorkerOptions = {}) {
  let active: { config: string; receive: (request: Request) => Promise<Response> } | undefined;
  let simulation: { config: string; value: LocalSimulation } | undefined;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const log = options.log ?? ((line: string) => console.log(line));

  async function localIntegration(env: Env): Promise<CycleSummary> {
    const failure = env.SIMULATION_TELEGRAM_FAILURE ?? 'none';
    const failAt = env.SIMULATION_FAIL_AT ?? '1';
    if (Object.keys(env).some(key => !LOCAL_KEYS.has(key)) ||
        typeof failure !== 'string' || !SIMULATED_TELEGRAM_FAILURES.includes(failure as SimulatedTelegramFailure) ||
        typeof failAt !== 'string' || !/^[1-9]\d{0,5}$/.test(failAt)) throw new ScheduledConfigurationError();
    const db = database(env.DB);
    const identity = `${failure}:${failAt}`;
    if (!simulation || simulation.config !== identity) {
      simulation = { config: identity, value: new LocalSimulation(failure as SimulatedTelegramFailure, Number(failAt)) };
    }
    const sim = simulation.value;
    const storage = await D1Storage.create(db, LOCAL_SIMULATION.tokenKey, LOCAL_SIMULATION.keyVersion);
    if (await storage.oauthSessionVersion() === null) await storage.initializeOAuthTokens(sim.seedTokens(now()));
    return runTick({
      storage, now, sleep, owner: owner(), ...(options.limits ? { limits: options.limits } : {}),
      itad: new ItadClient(sim.transport),
      oauth: new OAuthClient(LOCAL_SIMULATION.oauth, sim.transport, now),
      telegram: new TelegramClient(sim.transport, LOCAL_SIMULATION.botToken, LOCAL_SIMULATION.chatId),
    });
  }

  async function production(env: Env): Promise<CycleSummary> {
    // Fail closed: explicit opt-in plus every secret/binding, validated before any request.
    if (Object.keys(env).some(key => !PRODUCTION_KEYS.has(key)) || env.LIVE_DELIVERY !== 'enabled' ||
        !validBotToken(env.TELEGRAM_BOT_TOKEN) || typeof env.OAUTH_CLIENT_ID !== 'string' ||
        typeof env.OAUTH_REDIRECT_URI !== 'string' || typeof env.OAUTH_TOKEN_KEY !== 'string' ||
        typeof env.OAUTH_TOKEN_KEY_VERSION !== 'string') throw new ScheduledConfigurationError();
    let chatId: number;
    let oauthConfig: OAuthConfig;
    try {
      chatId = parsePrivateChatId(env.TELEGRAM_CHAT_ID);
      oauthConfig = {
        clientId: env.OAUTH_CLIENT_ID, redirectUri: env.OAUTH_REDIRECT_URI, authentication: { method: 'public' },
      };
      // Validate OAuth configuration before creating any transport.
      new OAuthClient(oauthConfig, async () => { throw new ScheduledConfigurationError(); });
    } catch {
      throw new ScheduledConfigurationError();
    }
    const db = database(env.DB);
    let storage: D1Storage;
    try {
      storage = await D1Storage.create(db, env.OAUTH_TOKEN_KEY, env.OAUTH_TOKEN_KEY_VERSION);
    } catch {
      throw new ScheduledConfigurationError();
    }
    const transport: HttpTransport = options.liveTransport ?? (request => fetch(request));
    return runTick({
      storage, now, sleep, owner: owner(), ...(options.limits ? { limits: options.limits } : {}),
      itad: new ItadClient(transport),
      oauth: new OAuthClient(oauthConfig, transport, now),
      telegram: new TelegramClient(transport, env.TELEGRAM_BOT_TOKEN, chatId),
    });
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const config = configuration(env);
      if (!config) return Response.json({ error: 'configuration_rejected_real_mode_not_implemented' }, { status: 503 });
      const identity = JSON.stringify(config);
      if (!active || active.config !== identity) {
        active = {
          config: identity,
          receive: createReceiver(config, new MockDelivery(config.failure, config.failAt), new MemoryStore()),
        };
      }
      return active.receive(request);
    },

    /**
     * No HTTP route: cron is the only entry point of the polling bridge. Each
     * invocation is a tick: delivery always, ITAD/OAuth only when the durable
     * 5-minute poll gate is due (see `runTick`). The cron expression is not trusted
     * for gating; the gate lives in D1.
     */
    async scheduled(_event: ScheduledEventLike, env: Env): Promise<void> {
      const mode = env.APP_MODE;
      if (mode === 'mock') {
        log(JSON.stringify({ event: 'bridge_cycle', mode: 'mock', skipped: 'scheduled_disabled_in_mock' }));
        return;
      }
      let summary: CycleSummary;
      try {
        if (mode === 'local-integration') summary = await localIntegration(env);
        else if (mode === 'production') summary = await production(env);
        else throw new ScheduledConfigurationError();
      } catch (error) {
        const category = error instanceof ScheduledConfigurationError ? 'configuration_rejected' : 'unexpected';
        log(JSON.stringify({ event: 'bridge_cycle_failed', mode: typeof mode === 'string' ? mode.slice(0, 32) : 'invalid', category }));
        throw new Error(`bridge_cycle_failed:${category}`);
      }
      log(JSON.stringify({ event: 'bridge_cycle', mode, ...summary }));
      // Explicit failure for the platform: never a silent success.
      if (!summary.ok) throw new Error(`bridge_cycle_failed:${summary.errors.join(',')}`);
    },
  };
}

export default createWorker();
