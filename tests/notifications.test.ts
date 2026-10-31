import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDeal, InputError, MAX_TEXT, type WaitlistNotification } from '../src/domain';
import { formatNotification, prepareNotificationBatch } from '../src/notifications';
import { parseGames, parseNotificationList, parseWaitlistNotification } from '../src/validation';
import list from './fixtures/notifications-list.json';
import detailFixture from './fixtures/notifications-waitlist-detail.json';
import webhook from './fixtures/notification-waitlist.json';

const detail = parseWaitlistNotification(detailFixture);

function payload(): WaitlistNotification {
  return structuredClone(detail);
}

function body(parts: string[]): string {
  return parts.map(part => part.slice(part.indexOf('\n') + 1)).join('');
}

function checkParts(parts: string[], id: string) {
  expect(parts.length).toBeGreaterThan(0);
  parts.forEach((part, index) => {
    expect(part.length).toBeGreaterThan(0);
    expect(part.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(part.isWellFormed()).toBe(true);
    expect(part.startsWith(parts.length === 1
      ? `Aviso ITAD ${id}\n`
      : `Aviso ITAD ${id} · parte ${index + 1}/${parts.length}\n`)).toBe(true);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden in tests'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('official notification contracts I1', () => {
  it('accepts exact official list and detail examples and reuses webhook games', () => {
    expect(parseNotificationList(list)).toEqual(list);
    expect(parseWaitlistNotification(detailFixture)).toEqual(detailFixture);
    expect(detail.games).toEqual(webhook);
    expect(parseWaitlistNotification(detail).games).toEqual(parseGames(webhook));
  });

  it('accepts empty list, empty games and games without deals without invention', () => {
    expect(parseNotificationList([])).toEqual([]);
    const data = payload();
    data.games = [];
    expect(prepareNotificationBatch([data])[0]!.notification.games).toEqual([]);
    expect(body(formatNotification(data))).not.toContain('Juego ');
    data.games = payload().games;
    data.games[0]!.deals = [];
    expect(body(formatNotification(data))).toContain('Juego 1: Stardew Valley');
    expect(body(formatNotification(data))).not.toContain('Oferta ');
    expect(prepareNotificationBatch([])).toEqual([]);
  });

  it('accepts read null or timestamp, including read notices without filtering', () => {
    const data = payload();
    data.read = null;
    expect(parseWaitlistNotification(data).read).toBeNull();
    expect(parseNotificationList([{ ...list[0]!, read: null }])[0]!.read).toBeNull();
    expect(prepareNotificationBatch([data, detail])).toHaveLength(2);
  });

  it('ignores unknown fields, does not accept destination or token from input', () => {
    expect(parseWaitlistNotification({ ...detail, chat_id: 'untrusted', token: 'mock-only' })).toEqual(detail);
    expect(parseNotificationList([{ ...list[0]!, unknown: 'ignored' }])).toEqual([list[0]]);
    // title is required by the schema, but has no minLength.
    expect(parseNotificationList([{ ...list[0]!, title: '' }])[0]!.title).toBe('');
  });

  it.each([null, {}, 'list', 1, [null], [[list[0]]]])('rejects invalid list shape %j', value => {
    expect(() => parseNotificationList(value)).toThrow(InputError);
  });

  it.each([null, [], 'detail', 1, { games: [] }])('rejects invalid detail shape %j', value => {
    expect(() => parseWaitlistNotification(value)).toThrow(InputError);
  });

  it.each(['id', 'type', 'title', 'timestamp', 'read'])('requires list field %s, including nullable read', field => {
    const entry: Record<string, unknown> = { ...list[0]! };
    delete entry[field];
    expect(() => parseNotificationList([entry])).toThrow(InputError);
    entry[field] = null;
    if (field === 'read') expect(parseNotificationList([entry])[0]!.read).toBeNull();
    else expect(() => parseNotificationList([entry])).toThrow(InputError);
  });

  it.each(['id', 'timestamp', 'read', 'games'])('requires detail field %s, including nullable read', field => {
    const entry: Record<string, unknown> = { ...detail };
    delete entry[field];
    expect(() => parseWaitlistNotification(entry)).toThrow(InputError);
    entry[field] = null;
    if (field === 'read') expect(parseWaitlistNotification(entry).read).toBeNull();
    else expect(() => parseWaitlistNotification(entry)).toThrow(InputError);
  });

  it.each([
    ['id', 'not-a-uuid'], ['timestamp', '2024-02-30T00:00:00Z'],
    ['timestamp', 123], ['read', true], ['read', 'yesterday'], ['read', '2024-13-01T00:00:00Z'],
  ])('rejects invalid metadata %s=%j in both contracts', (field, value) => {
    expect(() => parseNotificationList([{ ...list[0]!, [field]: value }])).toThrow(InputError);
    expect(() => parseWaitlistNotification({ ...detail, [field]: value })).toThrow(InputError);
  });

  it.each([['type', 'other'], ['title', 3], ['title', '\ud800']])('rejects list %s=%j', (field, value) => {
    expect(() => parseNotificationList([{ ...list[0]!, [field]: value }])).toThrow(InputError);
  });

  it.each(['type', 'historyLow', 'lastPrice'])('reuses required nullable game field %s', field => {
    const data = structuredClone(detail) as unknown as { games: Record<string, unknown>[] };
    data.games[0]![field] = null;
    expect(() => parseWaitlistNotification(data)).not.toThrow();
    delete data.games[0]![field];
    expect(() => parseWaitlistNotification(data)).toThrow(InputError);
  });

  it.each(['voucher', 'storeLow', 'flag', 'expiry'])('reuses required nullable deal field %s', field => {
    const data = structuredClone(detail) as unknown as { games: { deals: Record<string, unknown>[] }[] };
    data.games[0]!.deals[0]![field] = null;
    expect(() => parseWaitlistNotification(data)).not.toThrow();
    delete data.games[0]!.deals[0]![field];
    expect(() => parseWaitlistNotification(data)).toThrow(InputError);
  });

  it('rejects a bad later list entry or later game/deal instead of returning a subset', () => {
    expect(() => parseNotificationList([list[0], { ...list[1], read: false }])).toThrow(InputError);
    const data = payload();
    data.games.push({ ...data.games[0]!, title: '\ud800' });
    expect(() => parseWaitlistNotification(data)).toThrow(InputError);
    const next = payload();
    next.games[0]!.deals.push({ ...next.games[0]!.deals[0]!, url: 'javascript:alert(1)' });
    expect(() => parseWaitlistNotification(next)).toThrow(InputError);
  });
});

describe('notification formatter I1', () => {
  it('groups the official single game and deal in one plain-text message without altering mock formatDeal', () => {
    const parts = formatNotification(detail);
    expect(parts).toHaveLength(1);
    checkParts(parts, detail.id);
    const text = parts[0]!;
    for (const expected of [
      'Juego 1: Stardew Valley', 'Oferta 1.1: GOG', 'Precio: 13.99 EUR (-0%)',
      'Precio habitual: 13.99 EUR', 'Minimo historico: 6.99 EUR',
      'Precio anterior: 13.99 EUR', 'Minimo en tienda: 7 EUR',
      'DRM: Drm Free', 'Plataformas: Windows, Mac, Linux', detail.games[0]!.deals[0]!.url,
    ]) expect(text).toContain(expected);
    expect(text).not.toContain('Cupon:');
    expect(text).not.toContain('Caduca:');
    expect(formatDeal(detail.games[0]!, detail.games[0]!.deals[0]!)).toEqual([
      `Stardew Valley\nGOG\n13.99 EUR (-0%)\n${detail.games[0]!.deals[0]!.url}`,
    ]);
  });

  it('keeps several games, all deals/shops in order and contextual optional data in one notice', () => {
    const data = payload();
    const first = data.games[0]!;
    first.deals.push({
      ...first.deals[0]!, shop: { id: 61, name: 'Steam' }, cut: 50,
      price: { amount: 6.99, amountInt: 699, currency: 'USD' }, voucher: 'MOCK-COUPON',
      expiry: '2026-11-01T10:00:00Z', flag: 'H', url: 'https://example.com/steam?affiliate=keep%2Bme',
    });
    data.games.push({
      ...structuredClone(first), id: list[1]!.id, title: 'Segundo juego 🎮', mature: true, type: 'dlc',
    });
    const before = structuredClone(data);
    const batch = prepareNotificationBatch([data]);
    expect(batch[0]!.notification).toEqual(data);
    expect(data).toEqual(before);
    expect(batch[0]!.parts).toHaveLength(1);
    const text = body(batch[0]!.parts);
    expect(text).toContain('Cupon: MOCK-COUPON');
    expect(text).toContain('Caduca: 2026-11-01T10:00:00Z');
    expect(text).toContain('Indicador ITAD: H');
    expect(text).toContain('Tipo: dlc\nContenido para adultos');
    expect(text).toContain('Precio: 6.99 USD (-50%)');
    expect(text.match(/Juego \d+:/g)).toHaveLength(2);
    expect(text.match(/Oferta \d+\.\d+:/g)).toHaveLength(4);
    data.games.forEach((game, g) => {
      expect(text).toContain(`Juego ${g + 1}: ${game.title}`);
      game.deals.forEach((deal, d) => expect(text).toContain(`Oferta ${g + 1}.${d + 1}: ${deal.shop.name}`));
    });
  });

  it('does not mix different notices, even with identical content or read state', () => {
    const second = { ...payload(), id: list[1]!.id, read: null };
    const batch = prepareNotificationBatch([detail, second, detail]);
    expect(batch).toHaveLength(3);
    batch.forEach((item, index) => {
      const source = [detail, second, detail][index]!;
      expect(item.notification).toEqual(source);
      checkParts(item.parts, source.id);
      const other = source.id === detail.id ? second.id : detail.id;
      expect(item.parts.join('')).not.toContain(other);
    });
  });

  it('fits exactly 4096 UTF16 units as one message; one extra unit requires labelled parts', () => {
    const data = payload();
    data.games[0]!.title += 'x'.repeat(MAX_TEXT - formatNotification(data)[0]!.length);
    expect(formatNotification(data)).toHaveLength(1);
    expect(formatNotification(data)[0]!.length).toBe(MAX_TEXT);
    data.games[0]!.title += 'x';
    const parts = formatNotification(data);
    expect(parts.length).toBeGreaterThan(1);
    checkParts(parts, data.id);
    expect(body(parts)).toContain(data.games[0]!.title);
  });

  it.each([2000, 20000, 210000])('preserves long Unicode and counters at length %i', length => {
    const data = payload();
    const originalBody = body(formatNotification(data));
    const title = `漢字🎮e\u0301👩‍💻${'🎮'.repeat(length)}FIN`;
    const coupon = `MOCK-${'🚀'.repeat(3000)}-END`;
    data.games[0]!.title = title;
    data.games[0]!.deals[0]!.voucher = coupon;
    const parts = formatNotification(data);
    checkParts(parts, data.id);
    expect(body(parts)).toContain(`Juego 1: ${title}`);
    expect(body(parts)).toContain(`Cupon: ${coupon}`);
    expect(body(parts)).toBe(originalBody
      .replace('Juego 1: Stardew Valley', `Juego 1: ${title}`)
      .replace('DRM:', `Cupon: ${coupon}\nDRM:`));
    expect(parts.filter(part => part.includes(data.games[0]!.deals[0]!.url))).toHaveLength(1);
  });

  it('keeps long affiliate and Unicode URLs intact in a single part without normalizing', () => {
    const data = payload();
    data.games[0]!.title = '🎮'.repeat(5000);
    const url = `https://example.com/🎮?affiliate=A%2fb&coupon=x%2By&long=${'x'.repeat(3700)}#原文`;
    data.games[0]!.deals[0]!.url = url;
    const parts = formatNotification(data);
    checkParts(parts, data.id);
    expect(parts.filter(part => part.includes(url))).toHaveLength(1);
    expect(body(parts).endsWith(url)).toBe(true);
    expect(body(parts).match(/https:\/\//g)).toHaveLength(1);
  });

  it('rejects a URL too long for a labelled part rather than splitting or truncating', () => {
    const data = payload();
    // Below 4096 alone, but it cannot fit with the mandatory notice header.
    data.games[0]!.deals[0]!.url = `https://example.com/${'x'.repeat(4050)}`;
    expect(() => formatNotification(data)).toThrow('link_too_long');
  });

  it('preserves more than the mock 100 games/200 deals without filtering or a partial subset', () => {
    const data = payload();
    const template = data.games[0]!;
    data.games = Array.from({ length: 101 }, (_, g) => ({
      ...structuredClone(template), title: `Game-${g}`,
      deals: Array.from({ length: 3 }, (_, d) => ({
        ...structuredClone(template.deals[0]!), shop: { id: d, name: `Shop-${g}-${d}` },
        url: `https://example.com/${g}/${d}?affiliate=unchanged`,
      })),
    }));
    const item = prepareNotificationBatch([data])[0]!;
    expect(item.notification.games).toEqual(data.games);
    checkParts(item.parts, data.id);
    const text = body(item.parts);
    expect(text.match(/Juego \d+:/g)).toHaveLength(101);
    expect(text.match(/Oferta \d+\.\d+:/g)).toHaveLength(303);
    let previousPosition = -1;
    data.games.forEach((game, g) => {
      const position = text.indexOf(`Juego ${g + 1}: ${game.title}\n`);
      expect(position).toBeGreaterThan(previousPosition);
      previousPosition = position;
      game.deals.forEach((deal, d) => {
        expect(text.split(`Oferta ${g + 1}.${d + 1}: ${deal.shop.name}\n`)).toHaveLength(2);
        expect(item.parts.filter(part => part.includes(deal.url))).toHaveLength(1);
      });
    });
    // Legacy receiver cap remains unchanged.
    expect(() => parseGames(data.games)).toThrow(InputError);
  });

  it('preserves 101 DRM and 101 platform entries of an official detail; the mock cap stays at 100', () => {
    const data = payload();
    const deal = data.games[0]!.deals[0]!;
    deal.drm = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `DRM-${index}` }));
    deal.platforms = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `Platform-${index}` }));
    const parsed = parseWaitlistNotification(structuredClone(data));
    expect(parsed.games[0]!.deals[0]!.drm).toEqual(deal.drm);
    expect(parsed.games[0]!.deals[0]!.platforms).toEqual(deal.platforms);
    const parts = formatNotification(parsed);
    checkParts(parts, data.id);
    const text = body(parts);
    expect(text).toContain(`DRM: ${deal.drm.map(item => item.name).join(', ')}\n`);
    expect(text).toContain(`Plataformas: ${deal.platforms.map(item => item.name).join(', ')}\n`);
    // Legacy mock receiver policy unchanged: 100 accepted, 101 rejected.
    expect(() => parseGames(data.games)).toThrow(InputError);
    const capped = structuredClone(data.games);
    capped[0]!.deals[0]!.drm = deal.drm.slice(0, 100);
    capped[0]!.deals[0]!.platforms = deal.platforms.slice(0, 100);
    expect(parseGames(capped)[0]!.deals[0]!.drm).toHaveLength(100);
  });

  it('rejects the whole official detail if any DRM/platform entry is invalid, never a partial list', () => {
    const data = payload();
    const deal = data.games[0]!.deals[0]!;
    deal.drm = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `DRM-${index}` }));
    (deal.drm[100] as { name: unknown }).name = '';
    expect(() => parseWaitlistNotification(data)).toThrow(InputError);
    expect(() => formatNotification(data)).toThrow(InputError);
    expect(() => prepareNotificationBatch([detail, data])).toThrow(InputError);
  });

  it.each(['validation', 'formatting'])('prepares the entire batch before a caller can send: late %s error', kind => {
    const send = vi.fn();
    const bad = payload();
    if (kind === 'validation') bad.read = 'invalid';
    else bad.games[0]!.deals[0]!.url = `https://example.com/${'x'.repeat(MAX_TEXT)}`;
    expect(() => {
      const batch = prepareNotificationBatch([detail, bad]);
      batch.forEach(item => item.parts.forEach(part => send(part)));
    }).toThrow(InputError);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([null, {}, 'batch'])('rejects invalid batch shape %j', value => {
    expect(() => prepareNotificationBatch(value)).toThrow(InputError);
  });
});
