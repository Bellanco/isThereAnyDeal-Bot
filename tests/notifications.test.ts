import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDeal, InputError, type WaitlistNotification } from '../src/domain';
import { formatNotification, prepareNotificationBatch } from '../src/notifications';
import { countBlocks, countImages, MAX_RICH_BYTES, money, RICH_BUDGET, utf8Length } from '../src/rich';
import { parseGames, parseNotificationList, parseWaitlistNotification } from '../src/validation';
import list from './fixtures/notifications-list.json';
import detailFixture from './fixtures/notifications-waitlist-detail.json';
import webhook from './fixtures/notification-waitlist.json';
import { buttonUrls, expectWellFormed } from './rich-helpers';

const detail = parseWaitlistNotification(detailFixture);
const NBSP = '\u00a0';

function payload(): WaitlistNotification {
  return structuredClone(detail);
}

/** Content of the parts without the multipart marker. */
function body(parts: string[]): string {
  return parts.map(part => part.replace(/<footer>parte \d+\/\d+<\/footer>$/, '')).join('');
}

function checkParts(parts: string[], id: string) {
  expect(parts.length).toBeGreaterThan(0);
  parts.forEach((part, index) => {
    expect(part.isWellFormed()).toBe(true);
    expect(utf8Length(part)).toBeLessThanOrEqual(RICH_BUDGET.bytes);
    expect(utf8Length(part)).toBeLessThan(MAX_RICH_BYTES);
    expect(countBlocks(part)).toBeLessThanOrEqual(RICH_BUDGET.blocks);
    expect(countImages(part)).toBeLessThanOrEqual(RICH_BUDGET.images);
    expect(part).not.toContain('ITAD · Waitlist');
    expect(part).not.toContain('juegos en oferta');
    expect(part).not.toContain('Aviso ITAD');
    expect(part).not.toContain(id);
    expect(part).not.toContain('Leído en ITAD');
    if (parts.length > 1) expect(part.endsWith(`<footer>parte ${index + 1}/${parts.length}</footer>`)).toBe(true);
    else expect(part).not.toContain('<footer>');
    expectWellFormed(part);
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
    const empty = formatNotification(data);
    checkParts(empty, data.id);
    expect(empty).toHaveLength(1);
    expect(empty[0]).toBe('');
    expect(body(empty)).toBe('');
    data.games = payload().games;
    data.games[0]!.deals = [];
    const noDeals = formatNotification(data);
    checkParts(noDeals, data.id);
    expect(body(noDeals)).toBe('<h3>Stardew Valley</h3><p>Mínimo histórico: ' +
      `6,99${NBSP}€</p>` +
      '<tg-button-row><tg-button type="url" style="primary" url="https://isthereanydeal.com/game/stardew-valley/">Ver en ITAD</tg-button></tg-button-row>');
    expect(body(noDeals)).not.toContain('Precio anterior:');
    expect(body(noDeals)).not.toContain('Comprar en');
    expect(body(noDeals)).not.toContain('<mark>');
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
  it('groups the official single game and deal in one rich message without altering mock formatDeal', () => {
    const parts = formatNotification(detail);
    expect(parts).toHaveLength(1);
    checkParts(parts, detail.id);
    const html = parts[0]!;
    const deal = detail.games[0]!.deals[0]!;
    expect(body(parts)).toBe(
      '<h3>Stardew Valley</h3>' +
      `<h4>13,99${NBSP}€ · <mark>-0%</mark></h4><p><b>GOG</b></p>` +
      `<p>Mínimo histórico: 6,99${NBSP}€</p>` +
      `<tg-button-row><tg-button type="url" style="success" url="${deal.url}">Comprar en GOG</tg-button></tg-button-row>` +
      '<tg-button-row><tg-button type="url" style="primary" url="https://isthereanydeal.com/game/stardew-valley/">Ver en ITAD</tg-button></tg-button-row>');
    expect(html.startsWith('<h3>Stardew Valley</h3>')).toBe(true);
    expect(html).not.toContain('unix="1727138584"');
    expect(html).not.toContain('unix="1728223607"');
    expect(html).not.toContain('Cupón:');
    expect(html).not.toContain('Caduca:');
    expect(html).not.toContain('<img');
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
    checkParts(batch[0]!.parts, data.id);
    const html = body(batch[0]!.parts);
    expect(batch[0]!.notification.games[0]!.lastPrice).toEqual(first.lastPrice);
    expect(batch[0]!.notification.games[0]!.deals[0]!.regular).toEqual(first.deals[0]!.regular);
    expect(batch[0]!.notification.games[0]!.deals[0]!.storeLow).toEqual(first.deals[0]!.storeLow);
    expect(html).not.toMatch(/Precio anterior|Precio habitual|Mínimo en tienda|Precios del juego|Precios de esta tienda/);
    expect(batch[0]!.parts[0]!.startsWith('<h3>Stardew Valley</h3>')).toBe(true);
    expect(html).not.toMatch(/Oferta publicada|DRM:|Plataformas:/);
    expect(html).toContain('<p><b>Steam</b></p><p>Cupón: <code>MOCK-COUPON</code></p><p>Caduca: 11:00 01-11-2026</p>');
    expect(html).toContain(`<h4>${money({ amount: 6.99, amountInt: 699, currency: 'USD' })} · <mark>-50%</mark></h4><p><b>Steam</b></p>`);
    expect(html).toContain('<p>Mínimo histórico</p>');
    expect(html).not.toMatch(/Tienda:|Paquete|DLC|adultos/);
    expect(html.match(/<h3>/g)).toHaveLength(2);
    expect(html.match(/<hr\/>/g)).toHaveLength(3);
    expect(html.match(/<mark>-\d+%<\/mark>/g)).toHaveLength(4);
    expect(html.match(/>Ver en ITAD</g)).toHaveLength(2);
    expect(html.match(/>Comprar en /g)).toHaveLength(4);
    let position = -1;
    data.games.forEach(game => {
      const at = html.indexOf(`<h3>${game.title}</h3>`);
      expect(at).toBeGreaterThan(position);
      position = at;
      game.deals.forEach(deal => {
        const next = html.indexOf(`<p><b>${deal.shop.name}`, position);
        expect(next).toBeGreaterThan(position);
        position = next;
      });
    });
    expect(buttonUrls(batch[0]!.parts)).toEqual([
      first.deals[0]!.url, 'https://isthereanydeal.com/game/stardew-valley/', 'https://example.com/steam?affiliate=keep%2Bme',
      first.deals[0]!.url, 'https://isthereanydeal.com/game/stardew-valley/', 'https://example.com/steam?affiliate=keep%2Bme',
    ]);
  });

  it('labels H/N exactly, avoids repeating a known first-offer minimum and omits type/adult metadata', () => {
    const data = payload();
    const template = data.games[0]!.deals[0]!;
    const flagged = (['H', 'N', 'S'] as const).map((flag, index) => ({
      ...structuredClone(template), flag, shop: { id: 100 + index, name: `Flag-${flag}` },
    }));
    data.games[0]!.deals = flagged;
    data.games[0]!.type = 'package';
    data.games[0]!.mature = true;
    data.read = null;
    const before = structuredClone(data);
    const html = body(formatNotification(data));
    expect(data).toEqual(before);
    expect(html).toContain('<p><b>Flag-H</b></p>');
    expect(html).toContain('<p><b>Flag-N</b></p>');
    expect(html).toContain('<p><b>Flag-S</b></p>');
    // The first H signal is represented once by the known numeric game minimum.
    expect(html.match(/Mínimo histórico:/g)).toHaveLength(1);
    // N on the next offer remains visible, and uses the exact requested label.
    expect(html.match(/<p>Mínimo histórico<\/p>/g)).toHaveLength(1);
    expect(html).not.toMatch(/Nuevo|del juego|Tienda:|Paquete|DLC|adultos|3 meses|tres meses|trimestre|mínimo anual|mínimo de un año/i);
    expect(html).not.toContain('Mínimo de esta tienda');
    expect(prepareNotificationBatch([data])[0]!.notification.games[0]!.deals[2]!.flag).toBe('S');
    expect(prepareNotificationBatch([data])[0]!.notification).toEqual(before);
    expect(formatNotification(data)[0]).not.toContain('Leído en ITAD');
    expect(formatNotification({ ...data, read: detail.read })).toEqual(formatNotification(data));

    const unknownHistory = structuredClone(data);
    unknownHistory.games[0]!.historyLow = null;
    unknownHistory.games[0]!.deals = [structuredClone(template)];
    unknownHistory.games[0]!.deals[0]!.flag = 'N';
    const unknownHtml = body(formatNotification(unknownHistory));
    expect(unknownHtml.match(/<p>Mínimo histórico<\/p>/g)).toHaveLength(1);
    expect(unknownHtml).not.toContain('Mínimo histórico:');
    expect(unknownHtml).not.toContain('Nuevo');

    const numericHistory = structuredClone(data);
    numericHistory.games[0]!.historyLow = numericHistory.games[0]!.deals[0]!.price;
    numericHistory.games[0]!.deals = [structuredClone(template)];
    numericHistory.games[0]!.deals[0]!.flag = null;
    expect(body(formatNotification(numericHistory)).match(/Mínimo histórico:/g)).toHaveLength(1);
    expect(body(formatNotification(numericHistory))).not.toContain('<p>Mínimo histórico</p>');

    data.games[0]!.type = 'game';
    data.games[0]!.deals = [template];
    expect(body(formatNotification(data))).not.toMatch(/Tienda:|Paquete|DLC|Contenido para adultos/);
  });

  it('escapes every external text and keeps the offer URL exact inside the attribute', () => {
    const data = payload();
    const deal = data.games[0]!.deals[0]!;
    data.games[0]!.title = 'A <b>&</b> "Q" > B';
    deal.shop = { id: 7, name: 'Shop <i>&</i>' };
    deal.voucher = '<code>&"';
    deal.drm = [{ id: 1, name: 'DRM <x>' }];
    deal.platforms = [{ id: 1, name: 'P & Q' }];
    deal.url = 'https://example.com/a?x=1&y="2"&z=<3>#frag';
    const parts = formatNotification(data);
    checkParts(parts, data.id);
    const html = body(parts);
    expect(html).toContain('<h3>A &lt;b&gt;&amp;&lt;/b&gt; "Q" &gt; B</h3>');
    expect(html).toContain('<p><b>Shop &lt;i&gt;&amp;&lt;/i&gt;</b></p>');
    expect(html).toContain('<code>&lt;code&gt;&amp;"</code>');
    expect(html).not.toMatch(/DRM:|Plataformas:|DRM &lt;x&gt;|P &amp; Q/);
    expect(html).toContain('>Comprar en Shop &lt;i&gt;&amp;&lt;/i&gt;</tg-button>');
    expect(html).toContain('url="https://example.com/a?x=1&amp;y=&quot;2&quot;&amp;z=&lt;3&gt;#frag"');
    expect(buttonUrls(parts)).toContain(deal.url);
  });

  it('adds a banner only when the Waitlist provides a safe https image for that game', () => {
    const data = payload();
    const id = data.games[0]!.id;
    const withBanner = (url: string) => formatNotification(data, { banners: new Map([[id.toLowerCase(), url]]) });
    const ok = withBanner('https://example.com/banner.jpg?a=1&b=2');
    checkParts(ok, data.id);
    expect(body(ok).startsWith('<img src="https://example.com/banner.jpg?a=1&amp;b=2"/><h3>Stardew Valley</h3>')).toBe(true);
    expect(countImages(ok[0]!)).toBe(1);
    for (const unsafe of ['http://example.com/b.jpg', 'javascript:alert(1)', 'https://example.com/a b.jpg',
      'https://example.com/"onerror=1', 'https://example.com/<b>', `https://example.com/${'x'.repeat(2100)}`, '']) {
      expect(body(withBanner(unsafe))).not.toContain('<img');
    }
    expect(body(formatNotification(data, { banners: new Map([['other-game', 'https://example.com/b.jpg']]) }))).not.toContain('<img');
    expect(body(formatNotification(data, { banners: new Map() }))).not.toContain('<img');
    expect(body(formatNotification(data))).toBe(body(formatNotification(data, { banners: new Map() })));
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

  it('fits exactly the part budget as one message; one extra byte splits at the offer boundary with labelled parts', () => {
    const data = payload();
    const second = { ...structuredClone(data.games[0]!.deals[0]!), shop: { id: 62, name: 'Second shop' }, voucher: 'x' };
    data.games[0]!.deals.push(second);
    // A single part reserves room for the widest "parte 9/9" counter.
    const reserve = utf8Length('<footer>parte 9/9</footer>');
    const base = utf8Length(formatNotification(data)[0]!);
    second.voucher = 'x'.repeat(RICH_BUDGET.bytes - reserve - base + 1);
    const exact = formatNotification(data);
    expect(exact).toHaveLength(1);
    expect(utf8Length(exact[0]!)).toBe(RICH_BUDGET.bytes - reserve);
    second.voucher += 'x';
    const parts = formatNotification(data);
    expect(parts).toHaveLength(2);
    checkParts(parts, data.id);
    expect(parts[0]).toContain('<footer>parte 1/2</footer>');
    expect(parts[1]).toContain('<footer>parte 2/2</footer>');
    expect(parts[1]!.startsWith('<h3>Stardew Valley (continuación)</h3>')).toBe(true);
    expect(parts[0]).toContain(`url="${data.games[0]!.deals[0]!.url}"`);
    expect(parts[1]).toContain(`<code>${second.voucher}</code>`);
    expect(parts.join('')).not.toContain('Cupón: <code>x</code>');
    expect(buttonUrls(parts)).toHaveLength(3);
  });

  it('preserves long Unicode intact inside a part and never cuts a character', () => {
    const data = payload();
    const title = `漢字🎮e\u0301👩‍💻${'🎮'.repeat(2000)}FIN`;
    const coupon = `MOCK-${'🚀'.repeat(1500)}-END`;
    data.games[0]!.title = title;
    data.games[0]!.deals[0]!.voucher = coupon;
    const parts = formatNotification(data);
    checkParts(parts, data.id);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain(`<h3>${title}</h3>`);
    expect(parts[0]).toContain(`<code>${coupon}</code>`);
    expect(utf8Length(parts[0]!)).toBeGreaterThan(14_000);
  });

  it.each([2000, 6000])('splits long Unicode offers only between offers, every one exactly once: %i chars', length => {
    const data = payload();
    const template = data.games[0]!.deals[0]!;
    data.games[0]!.title = `漢字🎮e\u0301👩‍💻${'🎮'.repeat(500)}FIN`;
    data.games[0]!.deals = Array.from({ length: 6 }, (_, index) => ({
      ...structuredClone(template), shop: { id: index, name: `Shop-${index}` },
      voucher: `MOCK-${index}-${'🚀'.repeat(length)}-END`, url: `https://example.com/${index}?affiliate=keep`,
    }));
    const parts = formatNotification(data);
    expect(parts.length).toBeGreaterThan(1);
    checkParts(parts, data.id);
    data.games[0]!.deals.forEach(deal => {
      expect(parts.filter(part => part.includes(`<code>${deal.voucher}</code>`))).toHaveLength(1);
      expect(parts.filter(part => part.includes(`url="${deal.url}"`))).toHaveLength(1);
    });
    parts.slice(1).forEach(part => {
      expect(part.startsWith(`<h3>${data.games[0]!.title} (continuación)</h3>`)).toBe(true);
    });
    expect(parts.join('').match(/>Ver en ITAD</g)).toHaveLength(1);
    expect(parts.join('').match(/<h3>/g)).toHaveLength(parts.length);
  });

  it('rejects one indivisible game or offer larger than a part instead of cutting it', () => {
    const data = payload();
    data.games[0]!.title = '🎮'.repeat(RICH_BUDGET.bytes / 4);
    expect(() => formatNotification(data)).toThrow('rich_too_large');
    const second = payload();
    second.games[0]!.deals[0]!.voucher = 'x'.repeat(RICH_BUDGET.bytes);
    expect(() => formatNotification(second)).toThrow(new InputError('rich_too_large'));
  });

  it('keeps long affiliate and Unicode URLs intact in a single part without normalizing', () => {
    const data = payload();
    data.games[0]!.title = '🎮'.repeat(2000);
    const url = `https://example.com/🎮?affiliate=A%2fb&coupon=x%2By&long=${'x'.repeat(3700)}#原文`;
    data.games[0]!.deals[0]!.url = url;
    const parts = formatNotification(data);
    checkParts(parts, data.id);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain(`url="${url.replace(/&/g, '&amp;')}"`);
    expect(buttonUrls(parts)).toEqual([url, 'https://isthereanydeal.com/game/stardew-valley/']);
    expect(parts[0]!.match(/https:\/\/example\.com/g)).toHaveLength(1);
  });

  it('rejects a URL too long for a part rather than splitting or truncating', () => {
    const data = payload();
    data.games[0]!.deals[0]!.url = `https://example.com/${'x'.repeat(RICH_BUDGET.bytes)}`;
    expect(() => formatNotification(data)).toThrow('rich_too_large');
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
    expect(item.parts.length).toBeGreaterThan(1);
    const html = body(item.parts);
    expect(html.match(/<h3>/g)!.length).toBeGreaterThanOrEqual(101); // Continuation headings may increase after redesign.
    expect(html.match(/<mark>-0%<\/mark>/g)).toHaveLength(303);
    let previousPosition = -1;
    data.games.forEach(game => {
      const position = html.indexOf(`<h3>${game.title}</h3>`);
      expect(position).toBeGreaterThan(previousPosition);
      previousPosition = position;
      expect(item.parts.filter(part => part.includes(`<h3>${game.title}</h3>`))).toHaveLength(1);
      game.deals.forEach(deal => {
        expect(html.split(`<p><b>${deal.shop.name}</b></p>`)).toHaveLength(2);
        expect(item.parts.filter(part => part.includes(`url="${deal.url}"`))).toHaveLength(1);
      });
    });
    expect(buttonUrls(item.parts).filter(url => url.startsWith('https://isthereanydeal.com/'))).toHaveLength(101);
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
    const html = body(parts);
    expect(html).not.toMatch(/DRM:|Plataformas:|DRM-100|Platform-100/);
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
    else bad.games[0]!.deals[0]!.url = `https://example.com/${'x'.repeat(RICH_BUDGET.bytes)}`;
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
