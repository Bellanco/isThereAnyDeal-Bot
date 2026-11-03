import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import spec from '../itad-openapi.json';
import webhook from './fixtures/notification-waitlist.json';
import list from './fixtures/notifications-list.json';
import detail from './fixtures/notifications-waitlist-detail.json';
import ping from './fixtures/ping.json';
import { ItadClient } from '../src/itad-client';
import { TelegramClient } from '../src/telegram';
import { InputError, type Bundle } from '../src/domain';
import { formatNotification, prepareNotificationBatch } from '../src/notifications';
import { formatBundle } from '../src/bundles';
import { isPing, parseBundles, parseGames, parseNotificationList, parseWaitlistNotification } from '../src/validation';
import { buttonUrls, expectWellFormed } from './rich-helpers';
import { countBlocks, countImages, money, RICH_BUDGET, utf8Length, when } from '../src/rich';

const examples = spec.components.examples;
const bundlePayload = examples['resp.bundles.v1.success'].value;
function officialBundle(): Bundle {
  const result = parseBundles(bundlePayload);
  expect(result).toHaveLength(1);
  expect(result[0]?.bundle).not.toBeNull();
  return result[0]!.bundle!;
}
const json = (body: unknown) => new Response(JSON.stringify(body));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No real network'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('pinned official ITAD examples (public OpenAPI 2.11.0)', () => {
  it('verifies existing fixtures against the actual examples, including complete metadata', () => {
    expect(webhook).toEqual(examples['event.notification-waitlist'].value);
    expect(list).toEqual(examples['resp.notifications.get.v1'].value);
    expect(detail).toEqual(examples['resp.notifications.waitlist.get.v1'].value);
    expect(parseGames(webhook)).toEqual(webhook);
    expect(parseNotificationList(list)).toEqual(list);
    expect(parseWaitlistNotification(detail)).toEqual(detail);
    expect(detail.games).toEqual(webhook);
    expect(() => parseWaitlistNotification(webhook)).toThrow(InputError);
    expect(() => parseGames(detail)).toThrow(InputError);
    // The list title is not a promise of a full sample detail; do not invent missing games.
    expect(list[0]!.title).toBe('Stardew Valley and 3 more games');
    expect(detail.games).toHaveLength(1);
    expect(list[0]!.id).toBe(detail.id);
    expect(ping).toBe('pong');
    expect(isPing(ping)).toBe(true);
    expect(isPing({ ping: 'pong' })).toBe(false);
  });

  it('uses the documented feed, not nonexistent /bundles/v2 or per-game /games/bundles/v2', () => {
    expect(Object.keys(spec.paths)).toContain('/bundles/v1');
    expect(Object.keys(spec.paths)).not.toContain('/bundles/v2');
    expect(Object.keys(spec.paths)).toContain('/games/bundles/v2');
    expect(spec.paths['/bundles/v1'].get.responses['200'].content['application/json'].examples.success.$ref)
      .toBe('#/components/examples/resp.bundles.v1.success');
    expect(bundlePayload).toEqual(examples['resp.bundles.v2.success'].value);
  });

  it('does not invent EUR currency parameters or pagination for Collection', async () => {
    const query = spec.paths['/bundles/v1'].get.parameters.map(parameter =>
      '$ref' in parameter ? parameter.$ref.split('/').at(-1) : parameter.name);
    expect(query).toEqual(['country', 'offset', 'limit', 'mature', 'expired', 'sort']);
    expect(query).not.toContain('currency');
    const route = spec.paths['/collection/games/v1'].get;
    expect(route.security).toEqual([{ OAuth2: ['coll_read'] }]);
    expect(route).not.toHaveProperty('parameters');
    const official = examples['resp.games.get.v1.success-2'].value;
    const transport = vi.fn(async (_request: Request) => new Response(JSON.stringify(official), {
      headers: { Link: '</invented?offset=2>; rel="next"' },
    }));
    const ids = await new ItadClient(transport).collectionGameIds('mock-token');
    expect(ids).toEqual(official.map(game => game.id));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0].url).toBe('https://api.isthereanydeal.com/collection/games/v1');
    const bundle = officialBundle();
    bundle.tiers[0]!.games[0]!.id = ids[1]!;
    const html = formatBundle({ bundle, waitlist: [], collection: ids }).join('');
    expect(html).toContain('<p><mark>En tu Colección</mark></p>');
  });

  it('preserves the actual zero discount, lower history-low, nulls, dates and affiliate URL', () => {
    const valid = parseWaitlistNotification(detail);
    const game = valid.games[0]!;
    const deal = game.deals[0]!;
    expect(deal.price).toEqual({ amount: 13.99, amountInt: 1399, currency: 'EUR' });
    expect(deal.cut).toBe(0);
    expect(game.historyLow!.amount).toBeLessThan(deal.price.amount);
    expect(deal.flag).toBeNull();
    expect(deal.voucher).toBeNull();
    expect(deal.expiry).toBeNull();
    expect(deal.timestamp).toBe('2024-02-11T01:20:50+01:00');
    const parts = formatNotification(valid);
    expect(parts).toHaveLength(1);
    const html = parts[0]!;
    expect(html).toContain('<h4>13,99\u00a0€</h4>');
    expect(html).not.toMatch(/>-0%|Gratis/);
    expect(html.match(/Mínimo histórico/g)).toHaveLength(1);
    expect(html).toContain('Mínimo histórico: 6,99\u00a0€');
    expect(html).not.toMatch(/Cupón|Caduca|Hasta|Precio habitual|Mínimo en tienda|Precio anterior|Drm Free|Windows|2024|<img/);
    expect(buttonUrls(parts)).toEqual([deal.url, 'https://isthereanydeal.com/game/stardew-valley/']);
    expect(valid).toEqual(detail);
  });

  it('projects official bundle fields without losing any tier/game/link or changing USD', () => {
    const raw = bundlePayload[0]!;
    const bundle = officialBundle();
    expect(bundle.tiers).toHaveLength(raw.tiers.length);
    expect(bundle.tiers[0]!.games).toEqual(raw.tiers[0]!.games.map(({ assets, ...game }) =>
      ({ ...game, banner: assets.banner600 })));
    expect(bundle.tiers[0]!.price).toEqual(raw.tiers[0]!.price);
    expect(money(bundle.tiers[0]!.price!)).toBe('87,96\u00a0US$');
    expect(bundle.note).toBe('* Bundle being relaunched...again and again.');
    expect(bundle.url).toBe(raw.url);
    expect(bundle.expiry).toBe('2024-03-22T00:59:46+01:00');
    expect(when(bundle.expiry!)).toBe('22 de marzo');
    const waitlist = [bundle.tiers[0]!.games[0]!.id];
    const html = formatBundle({ bundle, waitlist, collection: [] }).join('');
    expect(html).toContain('Nivel 1 · 87,96\u00a0US$');
    expect(html).toContain('<footer>Hasta el 22 de marzo</footer>');
    expect(html).not.toContain(bundle.note!);
    expect(html).not.toMatch(/Nota de ITAD|Caduca:/);
    expect(bundle.note).toBe(raw.note);
    for (const game of raw.tiers[0]!.games) {
      expect(html).toContain(`href="https://isthereanydeal.com/game/${game.slug}/">${game.title}</a>`);
    }
    expect(buttonUrls([html])).toEqual([raw.url, raw.details]);
    expect(html).not.toMatch(/en tu |publicado|<p>dlc|counts/);
    expect(html).toContain(`<img src="${raw.tiers[0]!.games[0]!.assets.banner600}"/>`);
    expect(html).not.toContain('Imagen de juego:');
    expect(html).toContain('</tg-button></tg-button-row><tg-button-row><tg-button type="url" style="primary"');
  });

  it('runs full list → detail/feed → validation → real Rich formatters → Telegram mock', async () => {
    const itadRequests: Request[] = [];
    const itad = new ItadClient(async request => {
      itadRequests.push(request);
      const route = new URL(request.url).pathname;
      if (route === '/notifications/v1') return json(list);
      if (route === '/notifications/waitlist/v1') return json(detail);
      if (route === '/bundles/v1') return json(bundlePayload);
      throw new Error('Unexpected route');
    }, { apiKey: 'mock-key-public-example' });
    const summaries = await itad.list('mock-access-not-real');
    // Only the first official summary has a published detail: do not fabricate the other two.
    const notice = await itad.waitlist(summaries[0]!.id, 'mock-access-not-real');
    const feed = await itad.bundles(0, 50);
    expect(itadRequests[2]!.url).toBe('https://api.isthereanydeal.com/bundles/v1?country=ES&mature=true&offset=0&limit=50');
    const rich = [
      ...formatNotification(notice),
      ...formatBundle({ bundle: feed[0]!.bundle!, waitlist: [], collection: [] }),
    ];
    const sent: unknown[] = [];
    const telegram = new TelegramClient(async request => {
      expect(new URL(request.url).pathname.endsWith('/sendRichMessage')).toBe(true);
      expect(request.method).toBe('POST');
      sent.push(await request.json());
      return json({ ok: true, result: { message_id: sent.length, chat: { id: 123456, type: 'private' } } });
    }, '123456:MockToken_NotReal_1234567890', 123456);
    for (const html of rich) {
      expectWellFormed(html);
      expect(utf8Length(html)).toBeLessThanOrEqual(RICH_BUDGET.bytes);
      expect(countBlocks(html)).toBeLessThanOrEqual(RICH_BUDGET.blocks);
      expect(countImages(html)).toBeLessThanOrEqual(1);
      const expectedId = sent.length + 1;
      await expect(telegram.sendRich(html)).resolves.toEqual({ messageId: expectedId });
    }
    expect(sent).toEqual(rich.map(html => ({
      chat_id: 123456, rich_message: { html, skip_entity_detection: true },
    })));
  });
});

describe('explicitly synthetic mutations of the official example (not official data)', () => {
  it.each(['H', 'N', 'S', null] as const)('accepts documented flag %s without inferring it from prices', flag => {
    const value = structuredClone(detail);
    Object.assign(value.games[0]!.deals[0]!, { flag });
    const valid = parseWaitlistNotification(value);
    expect(valid.games[0]!.deals[0]!.flag).toBe(flag);
    const html = formatNotification(valid).join('');
    expect(html.match(/Mínimo histórico/g)).toHaveLength(1);
    expect(html).not.toContain('Mínimo en tienda');
  });

  it('omits nullable prices/type/read and labels H/N once when history-low is unknown', () => {
    for (const flag of ['H', 'N', 'S', null] as const) {
      const value = {
        ...structuredClone(detail), read: null,
        games: detail.games.map(game => ({
          ...game, type: null, historyLow: null, lastPrice: null,
          deals: game.deals.map(deal => ({ ...deal, flag, storeLow: null })),
        })),
      };
      const valid = parseWaitlistNotification(value);
      const html = formatNotification(valid).join('');
      expect(html.includes('Mínimo histórico')).toBe(flag === 'H' || flag === 'N');
      expect(html).not.toContain('null');
      expect(valid).toEqual(value);
    }
  });

  it.each([
    ['flag', 'X'], ['expiry', '2026-02-30T10:00:00Z'], ['timestamp', 'not-a-date'],
    ['url', 'javascript:alert(1)'], ['url', 'https://user:pass@example.invalid/'],
    ['cut', 101], ['voucher', 1],
  ])('rejects malformed %s without transport', (key, value) => {
    const input = structuredClone(detail);
    Object.assign(input.games[0]!.deals[0]!, { [key]: value });
    expect(() => prepareNotificationBatch([detail, input])).toThrow(InputError);
  });

  it.each(['eur', 'EURO', '', null])('rejects invalid currency %s', currency => {
    const input = structuredClone(detail);
    Object.assign(input.games[0]!.deals[0]!.price, { currency });
    expect(() => parseWaitlistNotification(input)).toThrow(InputError);
  });

  it('requires nullable notification fields to be present, not silently fabricated', () => {
    for (const key of spec.components.schemas['obj.notification.waitlist'].required) {
      const value = { ...detail } as Record<string, unknown>;
      delete value[key];
      expect(() => parseWaitlistNotification(value)).toThrow(InputError);
    }
    for (const key of spec.components.schemas['obj.notification.deal'].required) {
      const value = structuredClone(detail);
      delete (value.games[0]!.deals[0]! as unknown as Record<string, unknown>)[key];
      expect(() => parseWaitlistNotification(value)).toThrow(InputError);
    }
  });

  it('preserves a synthetic batch with repeated games/offers, ignoring destination injection', () => {
    const value = { ...detail, chat_id: 999, telegram_token: 'not-a-token',
      games: Array.from({ length: 140 }, () => ({
        ...detail.games[0]!, deals: [detail.games[0]!.deals[0]!, detail.games[0]!.deals[0]!],
      })),
    };
    const batch = prepareNotificationBatch([value, detail]);
    expect(batch).toHaveLength(2);
    expect(batch[0]!.notification.games).toHaveLength(140);
    expect(batch[0]!.parts.length).toBeGreaterThan(1);
    expect(batch[0]!.notification).not.toHaveProperty('chat_id');
    expect(batch[0]!.notification).not.toHaveProperty('telegram_token');
    expect(buttonUrls(batch[0]!.parts).filter(url => url === detail.games[0]!.deals[0]!.url)).toHaveLength(280);
  });

  it('handles nullable bundle fields and explicit synthetic membership without losing games', () => {
    const raw = structuredClone(bundlePayload);
    Object.assign(raw[0]!, { expiry: null, note: null, details: undefined });
    Object.assign(raw[0]!.tiers[0]!, { price: null });
    const bundle = parseBundles(raw)[0]!.bundle!;
    const id = bundle.tiers[0]!.games[0]!.id;
    const html = formatBundle({ bundle, waitlist: [id], collection: [id] }).join('');
    expect(html).toContain('<h4>Nivel 1</h4>');
    expect(html).not.toMatch(/precio no indicado|Gratis/);
    expect(html).not.toMatch(/Caduca|Hasta|Nota de ITAD|null/);
    expect(html).toContain('<mark>En tu lista de deseos</mark> · <mark>En tu Colección</mark>');
    expect(html.match(/<a href=/g)).toHaveLength(4);
  });

  it.each(['expiry', 'note'] as const)('preserves existing compatibility for absent bundle %s', field => {
    expect(spec.components.schemas['obj.bundle'].required).toContain(field);
    const raw = structuredClone(bundlePayload);
    delete (raw[0]! as unknown as Record<string, unknown>)[field];
    expect(parseBundles(raw)[0]!.bundle?.[field]).toBeNull();
  });

  it('preserves existing compatibility for absent or null bundle details', () => {
    expect(spec.components.schemas['obj.bundle'].required).not.toContain('details');
    expect(spec.components.schemas['obj.bundle'].properties.details.type).toBe('string');
    const raw = structuredClone(bundlePayload);
    delete (raw[0]! as unknown as Record<string, unknown>).details;
    expect(parseBundles(raw)[0]!.bundle?.details).toBeNull();
    (raw[0]! as unknown as Record<string, unknown>).details = null;
    expect(parseBundles(raw)[0]!.bundle?.details).toBeNull();
  });

  it('distinguishes per-game bundle assets from a bundle-owned image and preserves the safe banner projection', () => {
    expect(spec.components.schemas['obj.bundle'].properties).not.toHaveProperty('assets');
    expect(spec.components.schemas['obj.game'].required).toContain('assets');
    expect(Object.keys(spec.components.schemas['obj.asset-map'].properties))
      .toEqual(['banner145', 'banner300', 'banner400', 'banner600', 'boxart']);
    const raw = bundlePayload[0]!;
    expect(raw.tiers[0]!.games[0]!.assets.banner600).toMatch(/^https:\/\//);
    const bundle = officialBundle();
    expect(bundle.tiers[0]!.games[0]).not.toHaveProperty('assets');
    expect(bundle.tiers[0]!.games[0]!.banner).toBe(bundlePayload[0]!.tiers[0]!.games[0]!.assets.banner600);
    expect(countImages(formatBundle({ bundle, waitlist: [], collection: [] }).join(''))).toBe(0);
    expect(countImages(formatBundle({
      bundle, waitlist: [bundle.tiers[0]!.games[0]!.id], collection: [],
    }).join(''))).toBe(1);
  });
});
