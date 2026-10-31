import type { OAuthTokens } from './oauth';
import type { HttpTransport } from './itad-http';

/**
 * LOCAL INTEGRATION ONLY. Simulates ITAD list/detail, the OAuth token endpoint and
 * Telegram sendMessage in memory. Every value here is public and fictitious; it is
 * not a secret, not a real account and never reaches the network.
 */
export const LOCAL_SIMULATION = Object.freeze({
  /** Public all-zero test key: protects nothing, only exercises the AES-GCM path. */
  tokenKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  keyVersion: 'local-sim-v1',
  chatId: 100000001,
  botToken: '1:local-simulation-not-a-real-token',
  oauth: {
    clientId: 'local-simulation-client',
    redirectUri: 'http://127.0.0.1:8976/callback',
    authentication: { method: 'public' as const },
  },
});

export const SIMULATED_TELEGRAM_FAILURES = [
  'none', 'rate-limit', 'network', 'server-error', 'rejected', 'unverified', 'forbidden',
] as const;
export type SimulatedTelegramFailure = typeof SIMULATED_TELEGRAM_FAILURES[number];

const BASELINE_IDS = ['00000000-0000-4000-a000-0000000000b1', '00000000-0000-4000-a000-0000000000b2'];

function simulatedId(index: number): string {
  return `00000000-0000-4000-a000-${String(index).padStart(12, '0')}`;
}

function iso(base: number, minutes: number): string {
  return new Date(base + minutes * 60_000).toISOString();
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function deal(shop: number, index: number) {
  return {
    shop: { id: shop, name: `Tienda simulada ${shop}` },
    price: { amount: 4.99, amountInt: 499, currency: 'EUR' },
    regular: { amount: 19.99, amountInt: 1999, currency: 'EUR' },
    cut: 75, voucher: null, storeLow: null, flag: null, drm: [], platforms: [],
    timestamp: '2026-10-31T12:00:00Z', expiry: null,
    url: `https://example.invalid/sim/deal-${index}-${shop}?ref=affiliate-sim`,
  };
}

/**
 * Every third simulated notice has this many games (2 deals each) so that it is
 * formatted into exactly 20 Telegram parts, the size used to measure drain
 * progress per tick (I6). Asserted in tests; fictitious data only.
 */
export const SIMULATED_LARGE_NOTICE_GAMES = 195;

/** Fictitious detail served by the simulation (exported for local measurement tests). */
export function simulatedDetail(id: string, index: number, timestamp: string) {
  const games = index % 3 === 2 ? SIMULATED_LARGE_NOTICE_GAMES : 2;
  return {
    id, timestamp, read: null,
    games: Array.from({ length: games }, (_, game) => ({
      id: `00000000-0000-4000-b000-${String(index * 1000 + game).padStart(12, '0')}`,
      slug: `simulated-game-${index}-${game}`,
      title: `Juego simulado ${index}.${game + 1}`,
      type: 'game', mature: false, historyLow: null, lastPrice: null,
      deals: [deal(1, index * 1000 + game), deal(2, index * 1000 + game)],
    })),
  };
}

/** In-memory scenario: first list is the baseline, each later list adds one notice. */
export class LocalSimulation {
  listCalls = 0;
  sends = 0;
  refreshes = 0;
  readonly #failure: SimulatedTelegramFailure;
  readonly #failAt: number;
  readonly #epoch: number;
  /** message_id base unique per isolate, so local receipts never repeat across restarts. */
  readonly #messageBase = Date.now();

  constructor(failure: SimulatedTelegramFailure = 'none', failAt = 1, epoch = Date.UTC(2026, 9, 31, 12)) {
    this.#failure = failure;
    this.#failAt = failAt;
    this.#epoch = epoch;
  }

  seedTokens(now: number): OAuthTokens {
    // Expires inside the refresh margin so the first run exercises a durable rotation.
    return {
      accessToken: 'local-sim-access-0', refreshToken: 'local-sim-refresh-0',
      expiresAt: now + 2 * 60 * 60_000, scope: 'notifications',
    };
  }

  readonly transport: HttpTransport = async request => {
    const url = new URL(request.url);
    if (url.origin === 'https://isthereanydeal.com' && url.pathname === '/oauth/token/' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text());
      if (form.get('grant_type') !== 'refresh_token' || !form.get('refresh_token')?.startsWith('local-sim-refresh-')) {
        return json({ error: 'invalid_grant' }, 400);
      }
      this.refreshes++;
      return json({
        access_token: `local-sim-access-${this.refreshes}`, token_type: 'Bearer', expires_in: 2_678_400,
        refresh_token: `local-sim-refresh-${this.refreshes}`, scope: 'notifications',
      });
    }
    if (url.origin === 'https://api.isthereanydeal.com' && request.method === 'GET') {
      if (!request.headers.get('Authorization')?.startsWith('Bearer local-sim-access-')) return json({}, 401);
      if (url.pathname === '/notifications/v1') {
        this.listCalls++;
        const added = Array.from({ length: this.listCalls - 1 }, (_, index) => index + 1);
        return json([
          ...added.reverse().map(index => ({
            id: simulatedId(index), type: 'waitlist', title: `Aviso simulado ${index}`,
            timestamp: iso(this.#epoch, index * 5), read: null,
          })),
          ...BASELINE_IDS.map((id, index) => ({
            id, type: 'waitlist', title: 'Aviso historico simulado', timestamp: iso(this.#epoch, -60 + index), read: iso(this.#epoch, 0),
          })),
        ]);
      }
      if (url.pathname === '/notifications/waitlist/v1') {
        const id = url.searchParams.get('id') ?? '';
        const match = /^00000000-0000-4000-a000-(\d{12})$/.exec(id);
        if (!match) return json({}, 404);
        const index = Number(match[1]);
        return json(simulatedDetail(id, index, iso(this.#epoch, index * 5)));
      }
      return json({}, 404);
    }
    if (url.origin === 'https://api.telegram.org' && request.method === 'POST' &&
        url.pathname === `/bot${LOCAL_SIMULATION.botToken}/sendMessage`) {
      const body = await request.json() as Record<string, unknown>;
      if (body.chat_id !== LOCAL_SIMULATION.chatId || typeof body.text !== 'string' || 'parse_mode' in body) {
        return json({ ok: false, error_code: 400, description: 'simulated bad request' }, 400);
      }
      this.sends++;
      if (this.sends === this.#failAt && this.#failure !== 'none') {
        switch (this.#failure) {
          case 'rate-limit':
            return json({ ok: false, error_code: 429, description: 'simulated', parameters: { retry_after: 3 } }, 429);
          case 'network':
            throw new TypeError('simulated network failure');
          case 'server-error':
            return json({ ok: false, error_code: 502, description: 'simulated' }, 502);
          case 'rejected':
            return json({ ok: false, error_code: 400, description: 'simulated' }, 400);
          case 'forbidden':
            return json({ ok: false, error_code: 403, description: 'simulated' }, 403);
          case 'unverified':
            return new Response('not json', { status: 200 });
        }
      }
      return json({
        ok: true,
        result: { message_id: this.#messageBase + this.sends, date: 0, chat: { id: LOCAL_SIMULATION.chatId, type: 'private' }, text: body.text },
      });
    }
    // Anything else is refused: the simulation never falls back to real fetch.
    throw new TypeError('simulated network refused');
  };
}
