import type { OAuthTokens } from './oauth';
import type { HttpTransport } from './itad-http';

/**
 * LOCAL INTEGRATION ONLY. Simulates ITAD list/detail, Waitlist/Collection games, the
 * bundle feed, the OAuth token endpoint and Telegram sendMessage/sendRichMessage in
 * memory. Every value here is public and fictitious; it is not a secret, not a real
 * account and never reaches the network.
 */
export const LOCAL_SIMULATION = Object.freeze({
  /** Public all-zero test key: protects nothing, only exercises the AES-GCM path. */
  tokenKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  keyVersion: 'local-sim-v1',
  chatId: 100000001,
  botToken: '1:local-simulation-not-a-real-token',
  /** Public fictitious application key of the simulated bundle feed. */
  apiKey: 'local-simulation-api-key',
  oauth: {
    clientId: 'local-simulation-client',
    redirectUri: 'http://127.0.0.1:8976/callback',
    authentication: { method: 'public' as const },
  },
});

const SIMULATED_SCOPE = 'notifications wait_read coll_read';

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
 * Every third simulated notice has this many games (2 deals each) so that its
 * Rich HTML is split into exactly 20 Telegram parts, the size used to measure
 * drain progress per tick (I6). 580-609 games give 20 parts; this is the middle
 * of that range, so small title/banner differences do not change the count.
 * Asserted in tests; fictitious data only.
 */
export const SIMULATED_LARGE_NOTICE_GAMES = 595;

function simulatedGameId(index: number, game: number): string {
  return `00000000-0000-4000-b000-${String(index * 1000 + game).padStart(12, '0')}`;
}

/** Fictitious detail served by the simulation (exported for local measurement tests). */
export function simulatedDetail(id: string, index: number, timestamp: string) {
  const games = index % 3 === 2 ? SIMULATED_LARGE_NOTICE_GAMES : 2;
  return {
    id, timestamp, read: null,
    games: Array.from({ length: games }, (_, game) => ({
      id: simulatedGameId(index, game),
      slug: `simulated-game-${index}-${game}`,
      title: `Juego simulado ${index}.${game + 1}`,
      type: 'game', mature: false, historyLow: null, lastPrice: null,
      deals: [deal(1, index * 1000 + game), deal(2, index * 1000 + game)],
    })),
  };
}

/** The first two games of notices 1-9 are in the simulated Waitlist (with a banner each). */
const SIMULATED_WAITLIST = Array.from({ length: 9 }, (_, notice) => [0, 1].map(game => {
  const id = simulatedGameId(notice + 1, game);
  return {
    id, slug: `simulated-game-${notice + 1}-${game}`, title: `Juego simulado ${notice + 1}.${game + 1}`,
    type: 'game', mature: false, added: '2026-01-01T00:00:00Z',
    assets: { banner600: `https://example.invalid/sim/banner-${notice + 1}-${game}.jpg` },
  };
})).flat();

function simulatedBundle(id: number, publish: string, games: string[]) {
  return {
    id, title: `Bundle simulado ${id}`, page: { id: 1, name: 'Tienda simulada', shopId: null },
    url: `https://example.invalid/sim/bundle-${id}?ref=affiliate-sim&tier=1`,
    details: `https://example.invalid/sim/bundles/${id}/`,
    isMature: false, publish, expiry: null, note: null, counts: { games: games.length, media: 0 },
    tiers: [{
      price: { amount: 9.99, amountInt: 999, currency: 'EUR' }, addon: false,
      games: games.map((game, index) => ({
        id: game, slug: `simulated-bundle-game-${id}-${index}`, title: `Juego de bundle ${id}.${index + 1}`,
        type: 'game', mature: false, assets: {},
      })),
    }],
  };
}

const BASELINE_BUNDLES = [9001, 9002];

/**
 * In-memory scenario: first list is the baseline, each later list adds one notice.
 * The bundle feed works the same way: its first listing is the baseline and every
 * later one adds a bundle (id 9100 + n) with one Waitlist game and one that is not.
 */
export class LocalSimulation {
  listCalls = 0;
  sends = 0;
  refreshes = 0;
  bundleCalls = 0;
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
      expiresAt: now + 2 * 60 * 60_000, scope: SIMULATED_SCOPE,
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
        refresh_token: `local-sim-refresh-${this.refreshes}`, scope: SIMULATED_SCOPE,
      });
    }
    if (url.origin === 'https://api.isthereanydeal.com' && request.method === 'GET' &&
        url.pathname === '/bundles/v1') {
      // Application key only, never an OAuth token.
      if (request.headers.get('ITAD-API-Key') !== LOCAL_SIMULATION.apiKey) return json({}, 401);
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      if (url.searchParams.get('country') !== 'ES' || url.searchParams.get('mature') !== 'true' ||
          !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        return json({}, 400);
      }
      this.bundleCalls++;
      const baseline = BASELINE_BUNDLES.map(id => simulatedBundle(id, iso(this.#epoch, -120), [simulatedGameId(90, id)]));
      const added = Array.from({ length: this.bundleCalls - 1 }, (_, index) => {
        const number = index + 1;
        return simulatedBundle(9100 + number, iso(this.#epoch, number * 60), [
          simulatedGameId(number, 0), simulatedGameId(90, 9100 + number),
        ]);
      }).reverse();
      return json([...added, ...baseline].slice(offset, offset + limit));
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
      if (url.pathname === '/waitlist/games/v1') return json(SIMULATED_WAITLIST);
      // The collection holds the first game of simulated notice 1, which bundle 9101 also contains.
      if (url.pathname === '/collection/games/v1') return json(SIMULATED_WAITLIST.slice(0, 1));
      return json({}, 404);
    }
    if (url.origin === 'https://api.telegram.org' && request.method === 'POST' &&
        (url.pathname === `/bot${LOCAL_SIMULATION.botToken}/sendMessage` ||
         url.pathname === `/bot${LOCAL_SIMULATION.botToken}/sendRichMessage`)) {
      const rich = url.pathname.endsWith('/sendRichMessage');
      const body = await request.json() as Record<string, unknown>;
      const message = body.rich_message as Record<string, unknown> | null | undefined;
      const valid = rich
        ? typeof message === 'object' && message !== null && typeof message.html === 'string' &&
          message.html.length > 0 && message.skip_entity_detection === true && !('text' in body) && !('parse_mode' in body)
        : typeof body.text === 'string' && !('parse_mode' in body) && !('rich_message' in body);
      if (body.chat_id !== LOCAL_SIMULATION.chatId || !valid) {
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
        result: {
          message_id: this.#messageBase + this.sends, date: 0, chat: { id: LOCAL_SIMULATION.chatId, type: 'private' },
          ...(rich ? {} : { text: body.text }),
        },
      });
    }
    // Anything else is refused: the simulation never falls back to real fetch.
    throw new TypeError('simulated network refused');
  };
}
