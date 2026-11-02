import { describe, expect, it } from 'vitest';
import { InputError, type Bundle, type BundleGame, type BundleNotice, type BundleTier } from '../src/domain';
import { formatBundle } from '../src/bundles';
import { countBlocks, countImages, MAX_RICH_BYTES, RICH_BUDGET, stripImages, utf8Length } from '../src/rich';
import { buttonUrls, expectWellFormed } from './rich-helpers';

const NBSP = '\u00a0';
const PRICE = `4,99${NBSP}€`;
const ITAD_PAGE = 'https://isthereanydeal.com/specials/bundles/9101/';
const STORE_URL = 'https://example.invalid/bundle?ref=x&a=1';

const gid = (n: number) => `018d937f-${String(n).padStart(4, '0')}-7000-8000-${String(n).padStart(12, '0')}`;
const link = (n: number) => `https://isthereanydeal.com/game/game-${n}/`;
function game(n: number, overrides: Partial<BundleGame> = {}): BundleGame {
  return { id: gid(n), slug: `game-${n}`, title: `Game ${n}`, type: 'game', mature: false, ...overrides };
}

function tier(games: BundleGame[], overrides: Partial<BundleTier> = {}): BundleTier {
  return { price: { amount: 4.99, amountInt: 499, currency: 'EUR' }, addon: false, games, ...overrides };
}

function bundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    id: 9101, title: 'Bundle de prueba', shop: 'Humble Bundle', url: STORE_URL, details: ITAD_PAGE, note: null,
    mature: false, publish: '2026-10-31T10:00:00+01:00', expiry: '2026-11-14T19:00:00Z',
    tiers: [tier([game(1), game(2)])], ...overrides,
  };
}

const notice = (value: Bundle, waitlist: string[] = [], collection: string[] = []): BundleNotice =>
  ({ bundle: value, waitlist, collection });

const only = (parts: string[]): string => {
  expect(parts).toHaveLength(1);
  return parts[0]!;
};

/** Checks every part against the Telegram limits and the shared layout. */
function checkParts(parts: string[]) {
  expect(parts.length).toBeGreaterThan(0);
  parts.forEach((part, index) => {
    expect(part.isWellFormed()).toBe(true);
    expect(utf8Length(part)).toBeLessThanOrEqual(RICH_BUDGET.bytes);
    expect(utf8Length(part)).toBeLessThan(MAX_RICH_BYTES);
    expect(countBlocks(part)).toBeLessThanOrEqual(RICH_BUDGET.blocks);
    expect(countImages(part)).toBeLessThanOrEqual(1);
    expect(part).not.toContain('ITAD · Bundle');
    expect(part).not.toContain('de tu Waitlist');
    expect(part).not.toContain('Bundle ITAD');
    expect(part).not.toContain('publicado');
    if (parts.length > 1) expect(part.endsWith(`<footer>parte ${index + 1}/${parts.length}</footer>`)).toBe(true);
    else expect(part).not.toMatch(/<footer>parte \d+\/\d+<\/footer>/);
    expectWellFormed(part);
  });
}

describe('bundle message', () => {
  it('lists the bundle, its tiers and games, the marks and the buttons in the approved layout', () => {
    const html = only(formatBundle(notice(bundle({ note: 'Relanzado' }), [gid(1)], [gid(1), gid(2)])));
    expect(html).toBe(
      '<h3>Bundle de prueba</h3>' +
      '<footer>Hasta el 14 de noviembre</footer>' +
      '<tg-button-row><tg-button type="url" style="success" url="https://example.invalid/bundle?ref=x&amp;a=1">Comprar en Humble Bundle</tg-button></tg-button-row>' +
      `<tg-button-row><tg-button type="url" style="primary" url="${ITAD_PAGE}">Ver en ITAD</tg-button></tg-button-row>` +
      `<hr/><h4>Nivel 1 · ${PRICE}</h4>` +
      `<p><a href="${link(1)}">Game 1</a></p><p><mark>En tu lista de deseos</mark> · <mark>En tu Colección</mark></p>` +
      `<p><a href="${link(2)}">Game 2</a></p><p><mark>En tu Colección</mark></p>`,
    );
    checkParts([html]);
  });

  it('adds no image without assets, and returns the same parts without touching the input', () => {
    const input = notice(bundle(), [gid(1)], [gid(2)]);
    const before = structuredClone(input);
    const first = formatBundle(input);
    expect(formatBundle(input)).toEqual(first);
    expect(input).toEqual(before);
    expect(first.join('')).not.toContain('<img');
  });

  describe('official per-game bundle banner', () => {
    const banner = (n: number) => `https://example.invalid/game-${n}.jpg?x=1&ref=unchanged`;

    it('prioritizes the first Waitlist game with a safe banner in tier/game order, not Waitlist order', () => {
      const input = notice(bundle({ tiers: [
        tier([game(1, { banner: banner(1) }), game(2)]),
        tier([], { price: null }),
        tier([game(3, { banner: banner(3), title: 'A & <B>' }), game(4, { banner: banner(4) })]),
      ] }), [gid(4), gid(2), gid(3).toUpperCase()], [gid(1)]);
      const before = structuredClone(input);
      const parts = formatBundle(input);
      expect(parts[0]).toContain(`<img src="${banner(3).replaceAll('&', '&amp;')}"/>`);
      expect(parts[0]).toContain('<footer>Imagen de juego: A &amp; &lt;B&gt;</footer>');
      expect(countImages(parts.join(''))).toBe(1);
      const noAssets = structuredClone(input);
      noAssets.bundle.tiers.forEach(t => t.games.forEach(g => { delete g.banner; }));
      expect(parts.map(stripImages)).toEqual(formatBundle(noAssets));
      expect(buttonUrls(parts)).toEqual([STORE_URL, ITAD_PAGE]);
      expect(input).toEqual(before);
      checkParts(parts);
    });

    it.each([
      ['Waitlist games lack usable banners', [gid(1), gid(99)]],
      ['no Waitlist game is present', []],
    ])('renders no image when %s, even if other games have banners', (_case, waitlist) => {
      const input = notice(bundle({ tiers: [
        tier([]), tier([game(1, { banner: 'http://unsafe.test/a.jpg' }), game(2, { banner: banner(2) })]),
        tier([game(3, { banner: banner(3) })]),
      ] }), waitlist);
      const html = only(formatBundle(input));
      expect(html).not.toMatch(/<img|Imagen de juego/);
      const noAssets = structuredClone(input);
      noAssets.bundle.tiers.forEach(t => t.games.forEach(g => { delete g.banner; }));
      expect(html).toBe(only(formatBundle(noAssets)));
    });

    it.each([undefined, null, '', 'http://example.invalid/a', 'javascript:alert(1)',
      'https://example.invalid/a"b', 'https://example.invalid/a b', '/banner.jpg',
      `https://example.invalid/${String.fromCharCode(0xd800)}`,
      `https://example.invalid/${'x'.repeat(2048)}`])('does not render unsafe/missing persisted banner %s', banner => {
      const input = notice(bundle({ tiers: [tier([game(1, banner === undefined ? {} : { banner })])] }), [gid(1)]);
      expect(formatBundle(input).join('')).not.toMatch(/<img|Imagen de juego/);
    });

    it('preserves all game links, repetitions and multipart order inside every limit', () => {
      const games = Array.from({ length: 900 }, (_, index) => game(index + 1));
      const input = notice(bundle({ tiers: [
        tier(games.slice(0, 450)), tier([game(1), ...games.slice(450)], { price: null, addon: true }),
      ] }), [gid(700)]);
      const before = formatBundle(input);
      input.bundle.tiers[1]!.games[250]!.banner = banner(700);
      const parts = formatBundle(input);
      checkParts(parts);
      expect(parts).toHaveLength(before.length);
      expect(countImages(parts.join(''))).toBe(1);
      expect(parts.slice(1).join('')).not.toMatch(/<img|Imagen de juego/);
      expect(buttonUrls(parts)).toEqual(buttonUrls(before));
      const links = (all: string[]) => [...all.join('').matchAll(/<p><a href="[^"]+">[^<]*<\/a><\/p>/g)].map(m => m[0]);
      expect(links(parts)).toEqual(links(before));
      expect(links(parts)).toHaveLength(901);
    });
  });

  describe('Waitlist and Collection marks without a summary line', () => {
    const marked = (waitlist: string[], tiers: BundleTier[] = bundle().tiers) => {
      const parts = formatBundle(notice(bundle({ tiers }), waitlist));
      checkParts(parts);
      expect(parts[0]!.startsWith('<h3>Bundle de prueba</h3>')).toBe(true);
      return parts.join('').match(/<p><mark>En tu lista de deseos<\/mark><\/p>/g)?.length ?? 0;
    };

    it('says nothing about the Waitlist when no game matches', () => {
      expect(marked([])).toBe(0);
      expect(marked([gid(99)])).toBe(0);
    });

    it('marks matching games without a count, retaining repeated games across tiers', () => {
      expect(marked([gid(1)])).toBe(1);
      expect(marked([gid(1), gid(2)])).toBe(2);
      expect(marked([gid(1), gid(1), gid(99)])).toBe(1);
      const twoTiers = [tier([game(1), game(2)]), tier([game(1), game(3)])];
      expect(marked([gid(1), gid(3)], twoTiers)).toBe(3);
    });

    it('does not count Collection games', () => {
      const html = only(formatBundle(notice(bundle(), [], [gid(1), gid(2)])));
      expect(html.startsWith('<h3>Bundle de prueba</h3>')).toBe(true);
      checkParts([html]);
      expect(html).toContain('<p><mark>En tu Colección</mark></p>');
      expect(html).not.toContain('<code>');
      expect(html).not.toContain('en tu lista de deseos');
    });

    it('matches ids regardless of letter case', () => {
      const html = only(formatBundle(notice(
        bundle({ tiers: [tier([game(1, { id: gid(1).toUpperCase() }), game(2)])] }),
        [gid(1)], [gid(2).toUpperCase()],
      )));
      expect(html).toContain(`<p><a href="${link(1)}">Game 1</a></p><p><mark>En tu lista de deseos</mark></p>`);
      expect(html).toContain(`<p><a href="${link(2)}">Game 2</a></p><p><mark>En tu Colección</mark></p>`);
    });
  });

  describe('bundle data', () => {
    it('escapes the title, store and game title as text, without rendering the note', () => {
      const html = only(formatBundle(notice(bundle({
        title: 'A & B <c>', shop: 'Tom & Co', note: 'x < y & z',
        tiers: [tier([game(1, { title: 'Tom & <Jerry>' })])],
      }))));
      expect(html).toContain('<h3>A &amp; B &lt;c&gt;</h3>');
      expect(html).not.toContain('<p><b>Tom &amp; Co</b></p>');
      expect(html).not.toMatch(/Nota de ITAD|x &lt; y &amp; z/);
      expect(html).toContain('>Tom &amp; &lt;Jerry&gt;</a>');
      expect(html).toContain('>Comprar en Tom &amp; Co</tg-button>');
      checkParts([html]);
    });

    it('keeps both button links exactly as received, whatever characters they carry', () => {
      const url = 'https://example.invalid/b?q="x"<y>&ref=a&amp;b#frag';
      const details = 'https://isthereanydeal.com/specials/bundles/9101/?a=1&b="2"';
      const parts = formatBundle(notice(bundle({ url, details })));
      expect(buttonUrls(parts)).toEqual([url, details]);
      checkParts(parts);
    });

    it('offers only the green store button when ITAD gives no details page', () => {
      const html = only(formatBundle(notice(bundle({ details: null }))));
      expect(html).not.toContain('Ver en ITAD');
      expect(html).not.toContain('style="primary"');
      expect(html).toContain('<tg-button type="url" style="success" url="https://example.invalid/bundle?ref=x&amp;a=1">Comprar en Humble Bundle</tg-button>');
      expect(buttonUrls([html])).toEqual([STORE_URL]);
    });

    it.each([null, '', 'Aviso', '* Bundle being relaunched...again and again.', 'x < y & z', 'Nota larga '.repeat(5000)]
      .map((note, index) => ({ note, index })))(
      'omits any note visually, preserving it internally (case $index)', ({ note }) => {
      const input = notice(bundle({ note, mature: true }));
      const before = structuredClone(input);
      const html = only(formatBundle(input));
      expect(input).toEqual(before);
      expect(input.bundle.note).toBe(note);
      expect(formatBundle(input)).toEqual(formatBundle(notice(bundle({ note: null, mature: true }))));
      expect(html).not.toMatch(/Nota de ITAD|Tienda:|adultos|DLC|Paquete/);
      expect(html).toContain('<footer>Hasta el 14 de noviembre</footer>');
    });

    it('omits null expiry without an empty label', () => {
      const plain = only(formatBundle(notice(bundle({ note: null, mature: false, expiry: null }))));
      expect(plain).not.toContain('Nota de ITAD');
      expect(plain).not.toContain('adultos');
      expect(plain).not.toMatch(/Caduca|Hasta/);
    });

    it('formats only expiry in fixed Madrid time, never bundle publication', () => {
      const html = only(formatBundle(notice(bundle({ publish: '2026-12-31T23:30:00-02:00', expiry: '2027-01-01T00:00:00.999Z' }))));
      expect(html).toContain('<footer>Hasta el 1 de enero</footer>');
      expect(html).not.toContain('<tg-time');
      const noExpiry = only(formatBundle(notice(bundle({ expiry: null }))));
      expect(noExpiry).not.toMatch(/Caduca|Hasta/);
      expect(formatBundle(notice(bundle({ publish: '2020-01-01T00:00:00Z' })))).toEqual(formatBundle(notice(bundle())));
    });
  });

  describe('tiers and games', () => {
    it('numbers the tiers, omits null price and keeps known price/addon as received', () => {
      const html = only(formatBundle(notice(bundle({
        tiers: [
          tier([game(1)]),
          tier([game(2)], { price: null }),
          tier([game(3)], { price: { amount: 12.5, amountInt: 1250, currency: 'EUR' }, addon: true }),
        ],
      }))));
      expect(html).toContain(`<hr/><h4>Nivel 1 · ${PRICE}</h4>`);
      expect(html).toContain('<hr/><h4>Nivel 2</h4>');
      expect(html).toContain(`<hr/><h4>Nivel 3 · 12,50${NBSP}€ · addon</h4>`);
      expect(html).not.toMatch(/precio no indicado|Gratis| · <\/h4>/);
      expect(html.indexOf('Nivel 1')).toBeLessThan(html.indexOf('Nivel 2'));
      expect(html.indexOf('Nivel 2')).toBeLessThan(html.indexOf('Nivel 3'));
    });

    it.each([false, true])('omits a null price entirely, addon=%s, but keeps a numeric zero', addon => {
      const input = notice(bundle({ tiers: [
        tier([game(1)], { price: null, addon }),
        tier([game(2)], { price: { amount: 0, amountInt: 0, currency: 'USD' } }),
      ] }));
      const before = structuredClone(input);
      const html = only(formatBundle(input));
      expect(html).toContain(`<h4>Nivel 1${addon ? ' · addon' : ''}</h4>`);
      expect(html).toContain(`<h4>Nivel 2 · 0,00${NBSP}US$</h4>`);
      expect(html).not.toMatch(/precio no indicado|Gratis| · <\/h4>/);
      expect(input).toEqual(before);
    });

    it('keeps a tier without games as a heading and a bundle without tiers as the head only', () => {
      const empty = only(formatBundle(notice(bundle({ tiers: [tier([game(1)]), tier([], { price: null })] }))));
      expect(empty.endsWith('<hr/><h4>Nivel 2</h4>')).toBe(true);
      const none = only(formatBundle(notice(bundle({ tiers: [] }))));
      expect(none).not.toContain('<h4>');
      expect(none).toContain('<h3>Bundle de prueba</h3>');
      checkParts([empty]);
      checkParts([none]);
    });

    it('links each game to its ITAD page, built from the slug and encoded', () => {
      const html = only(formatBundle(notice(bundle({
        tiers: [tier([game(1, { slug: 'a b&c"d/é' })])],
      }))));
      expect(html).toContain('<a href="https://isthereanydeal.com/game/a%20b%26c%22d%2F%C3%A9/">Game 1</a>');
      checkParts([html]);
    });

    it.each([
      ['a game', { type: 'game' as const }],
      ['a game without type', { type: null }],
      ['DLC', { type: 'dlc' as const }],
      ['a package', { type: 'package' as const }],
      ['an adult game', { mature: true }],
      ['adult DLC', { type: 'dlc' as const, mature: true }],
    ])('keeps %s on its own title line without a repeated kind label', (_name, overrides) => {
      const input = notice(bundle({ tiers: [tier([game(1, overrides)])] }), [gid(1)]);
      const before = structuredClone(input);
      const html = only(formatBundle(input));
      expect(input).toEqual(before);
      expect(html).toContain(`<p><a href="${link(1)}">Game 1</a></p><p><mark>En tu lista de deseos</mark></p>`);
      expect(html).not.toMatch(/Tienda:|DLC|Paquete|adultos|Waitlist/);
      expect(html).not.toMatch(/ · (?:DLC|Paquete|adultos)/);
    });

    it('keeps every game, in order, when the same game is in several tiers', () => {
      const html = only(formatBundle(notice(bundle({ tiers: [tier([game(1)]), tier([game(1), game(2)])] }))));
      expect(html.match(/<a href=/g)).toHaveLength(3);
      expect([...html.matchAll(/>Game (\d)<\/a>/g)].map(match => match[1])).toEqual(['1', '1', '2']);
    });
  });

  describe('long bundles', () => {
    const many = (count: number, from = 1) => Array.from({ length: count }, (_, index) => game(from + index));

    it('splits a long tier between parts only at a game and repeats the tier heading', () => {
      const parts = formatBundle(notice(bundle({ tiers: [tier(many(900))] }), [gid(5), gid(700)]));
      expect(parts.length).toBeGreaterThan(1);
      checkParts(parts);
      // The head and its buttons belong to the first part only.
      expect(parts[0]).toContain('<h3>Bundle de prueba</h3>');
      expect(parts.slice(1).join('')).not.toContain('<h3>');
      expect(buttonUrls(parts)).toEqual([STORE_URL, ITAD_PAGE]);
      const content = parts.map(part => part.replace(/<footer>parte \d+\/\d+<\/footer>$/, '')).join('');
      expect(content.match(/<footer>Hasta el 14 de noviembre<\/footer>/g)).toHaveLength(1);
      expect(content).not.toContain('<footer>parte ');
      expect(parts[0]).toContain(`<h4>Nivel 1 · ${PRICE}</h4>`);
      for (const part of parts.slice(1)) {
        expect(part.startsWith(`<h4>Nivel 1 · ${PRICE} (continuación)</h4><p><a href=`)).toBe(true);
      }
      // Nothing is dropped or repeated.
      const titles = [...parts.join('').matchAll(/>Game (\d+)<\/a>/g)].map(match => Number(match[1]));
      expect(titles).toEqual(Array.from({ length: 900 }, (_, index) => index + 1));
      expect(parts.join('').match(/<p><mark>En tu lista de deseos<\/mark><\/p>/g)).toHaveLength(2);
      expect(parts.join('')).toContain(`<p><a href="${link(5)}">Game 5</a></p><p><mark>En tu lista de deseos</mark></p>`);
      expect(parts.join('')).toContain(`<p><a href="${link(700)}">Game 700</a></p><p><mark>En tu lista de deseos</mark></p>`);
    });

    it('keeps every tier heading with its first game when several tiers are split', () => {
      const parts = formatBundle(notice(bundle({
        tiers: [tier(many(450)), tier(many(450, 1001), { price: null, addon: true }), tier(many(3, 2001))],
      })));
      expect(parts.length).toBeGreaterThan(2);
      checkParts(parts);
      const all = parts.join('');
      expect(all).not.toMatch(/precio no indicado|Gratis| · <\/h4>/);
      expect(buttonUrls(parts)).toEqual([STORE_URL, ITAD_PAGE]);
      expect([...all.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual([
        ...many(450), ...many(450, 1001), ...many(3, 2001),
      ].map(game => `https://isthereanydeal.com/game/${game.slug}/`));
      expect(all.match(new RegExp(`<h4>Nivel 1 · ${PRICE}</h4>`, 'g'))).toHaveLength(1);
      expect(all.match(/<h4>Nivel 2 · addon<\/h4>/g)).toHaveLength(1);
      expect(all.match(new RegExp(`<h4>Nivel 3 · ${PRICE}</h4>`, 'g'))).toHaveLength(1);
      for (const part of parts) expect(part).not.toMatch(/<h4>[^<]*<\/h4>(<hr\/>|<footer>)/);
      for (const part of parts.slice(1)) {
        expect(part.startsWith('<h4>')).toBe(true);
      }
      const numbers = [...all.matchAll(/>Game (\d+)<\/a>/g)].map(match => Number(match[1]));
      expect(numbers).toEqual([
        ...Array.from({ length: 450 }, (_, index) => index + 1),
        ...Array.from({ length: 450 }, (_, index) => index + 1001),
        2001, 2002, 2003,
      ]);
    });

    it('stays inside the limits with long titles and many parts', () => {
      const long = (n: number) => game(n, { title: `Juego ${n} ${'ñ'.repeat(180)}` });
      const parts = formatBundle(notice(bundle({ tiers: [tier(Array.from({ length: 400 }, (_, index) => long(index + 1)))] })));
      expect(parts.length).toBeGreaterThan(2);
      checkParts(parts);
      expect(parts.join('').match(/<a href=/g)).toHaveLength(400);
    });

    it.each([
      ['a game that does not fit in one message', { tiers: [tier([game(1, { title: 'x'.repeat(31_000) })])] }],
    ])('refuses to cut %s', (_name, overrides) => {
      expect(() => formatBundle(notice(bundle(overrides)))).toThrow(InputError);
      expect(() => formatBundle(notice(bundle(overrides)))).toThrow('rich_too_large');
    });
  });
});
