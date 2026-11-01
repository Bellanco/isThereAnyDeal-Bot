import { describe, expect, it } from 'vitest';
import { InputError, type Bundle, type BundleGame, type BundleNotice, type BundleTier } from '../src/domain';
import { formatBundle } from '../src/bundles';
import { countBlocks, countImages, MAX_RICH_BYTES, RICH_BUDGET, utf8Length } from '../src/rich';
import { buttonUrls, expectWellFormed } from './rich-helpers';

const NBSP = '\u00a0';
const PRICE = `4,99${NBSP}€`;
const ITAD_PAGE = 'https://isthereanydeal.com/specials/bundles/9101/';
const STORE_URL = 'https://example.invalid/bundle?ref=x&a=1';

const gid = (n: number) => `018d937f-${String(n).padStart(4, '0')}-7000-8000-${String(n).padStart(12, '0')}`;
const link = (n: number) => `https://isthereanydeal.com/game/game-${n}/`;
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

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

const HEADER = '<p><b>ITAD · Bundle</b>';

/** Checks every part against the Telegram limits and the shared layout. */
function checkParts(parts: string[], id = 9101) {
  expect(parts.length).toBeGreaterThan(0);
  parts.forEach((part, index) => {
    expect(part.isWellFormed()).toBe(true);
    expect(utf8Length(part)).toBeLessThanOrEqual(RICH_BUDGET.bytes);
    expect(utf8Length(part)).toBeLessThan(MAX_RICH_BYTES);
    expect(countBlocks(part)).toBeLessThanOrEqual(RICH_BUDGET.blocks);
    expect(countImages(part)).toBe(0);
    expect(part.startsWith(HEADER)).toBe(true);
    const label = parts.length > 1 ? ` · parte ${index + 1}/${parts.length}` : '';
    expect(part).toContain(`<footer>Bundle ITAD ${id}${label} · publicado <tg-time `);
    expectWellFormed(part);
  });
}

describe('bundle message', () => {
  it('lists the bundle, its tiers and games, the marks and the buttons in the approved layout', () => {
    const html = only(formatBundle(notice(bundle({ note: 'Relanzado' }), [gid(1)], [gid(1), gid(2)])));
    expect(html).toBe(
      `${HEADER} · incluye 1 juego de tu Waitlist</p>` +
      '<h3>Bundle de prueba</h3><p><b>Humble Bundle</b></p>' +
      '<p>Nota de ITAD: Relanzado</p>' +
      `<p>Caduca: <tg-time unix="${unix('2026-11-14T19:00:00Z')}" format="Dt">2026-11-14 19:00 UTC</tg-time></p>` +
      `<tg-button-row><tg-button type="url" style="primary" url="${ITAD_PAGE}">Ver en ITAD</tg-button>` +
      '<tg-button type="url" url="https://example.invalid/bundle?ref=x&amp;a=1">Ver bundle en Humble Bundle</tg-button></tg-button-row>' +
      `<hr/><h4>Nivel 1 · ${PRICE}</h4>` +
      `<p><a href="${link(1)}">Game 1</a> <mark>en tu Waitlist</mark> <mark>en tu Colección</mark></p>` +
      `<p><a href="${link(2)}">Game 2</a> <mark>en tu Colección</mark></p>` +
      `<footer>Bundle ITAD 9101 · publicado <tg-time unix="${unix('2026-10-31T10:00:00+01:00')}" format="Dt">2026-10-31 09:00 UTC</tg-time></footer>`,
    );
    checkParts([html]);
  });

  it('never adds a banner, and returns the same parts for the same input without touching it', () => {
    const input = notice(bundle(), [gid(1)], [gid(2)]);
    const before = structuredClone(input);
    const first = formatBundle(input);
    expect(formatBundle(input)).toEqual(first);
    expect(input).toEqual(before);
    expect(first.join('')).not.toContain('<img');
  });

  describe('summary line', () => {
    const header = (waitlist: string[], tiers: BundleTier[] = bundle().tiers) => {
      const html = only(formatBundle(notice(bundle({ tiers }), waitlist)));
      return html.slice(0, html.indexOf('</p>') + '</p>'.length);
    };

    it('says nothing about the Waitlist when no game matches', () => {
      expect(header([])).toBe(`${HEADER}</p>`);
      expect(header([gid(99)])).toBe(`${HEADER}</p>`);
    });

    it('counts each matching game once, with singular and plural', () => {
      expect(header([gid(1)])).toBe(`${HEADER} · incluye 1 juego de tu Waitlist</p>`);
      expect(header([gid(1), gid(2)])).toBe(`${HEADER} · incluye 2 juegos de tu Waitlist</p>`);
      expect(header([gid(1), gid(1), gid(99)])).toBe(`${HEADER} · incluye 1 juego de tu Waitlist</p>`);
      const twoTiers = [tier([game(1), game(2)]), tier([game(1), game(3)])];
      expect(header([gid(1), gid(3)], twoTiers)).toBe(`${HEADER} · incluye 2 juegos de tu Waitlist</p>`);
    });

    it('does not count Collection games', () => {
      const html = only(formatBundle(notice(bundle(), [], [gid(1), gid(2)])));
      expect(html.startsWith(`${HEADER}</p>`)).toBe(true);
      expect(html).toContain('<mark>en tu Colección</mark>');
      expect(html).not.toContain('en tu Waitlist');
    });

    it('matches ids regardless of letter case', () => {
      const html = only(formatBundle(notice(
        bundle({ tiers: [tier([game(1, { id: gid(1).toUpperCase() }), game(2)])] }),
        [gid(1)], [gid(2).toUpperCase()],
      )));
      expect(html).toContain(`<a href="${link(1)}">Game 1</a> <mark>en tu Waitlist</mark></p>`);
      expect(html).toContain(`<a href="${link(2)}">Game 2</a> <mark>en tu Colección</mark></p>`);
    });
  });

  describe('bundle data', () => {
    it('escapes the title, store, note and game title as text', () => {
      const html = only(formatBundle(notice(bundle({
        title: 'A & B <c>', shop: 'Tom & Co', note: 'x < y & z',
        tiers: [tier([game(1, { title: 'Tom & <Jerry>' })])],
      }))));
      expect(html).toContain('<h3>A &amp; B &lt;c&gt;</h3><p><b>Tom &amp; Co</b></p>');
      expect(html).toContain('<p>Nota de ITAD: x &lt; y &amp; z</p>');
      expect(html).toContain('>Tom &amp; &lt;Jerry&gt;</a>');
      expect(html).toContain('>Ver bundle en Tom &amp; Co</tg-button>');
      checkParts([html]);
    });

    it('keeps both button links exactly as received, whatever characters they carry', () => {
      const url = 'https://example.invalid/b?q="x"<y>&ref=a&amp;b#frag';
      const details = 'https://isthereanydeal.com/specials/bundles/9101/?a=1&b="2"';
      const parts = formatBundle(notice(bundle({ url, details })));
      expect(buttonUrls(parts)).toEqual([details, url]);
      checkParts(parts);
    });

    it('offers only the store button, without highlight, when ITAD gives no details page', () => {
      const html = only(formatBundle(notice(bundle({ details: null }))));
      expect(html).not.toContain('Ver en ITAD');
      expect(html).not.toContain('style="primary"');
      expect(html).toContain('<tg-button type="url" url="https://example.invalid/bundle?ref=x&amp;a=1">Ver bundle en Humble Bundle</tg-button>');
      expect(buttonUrls([html])).toEqual([STORE_URL]);
    });

    it('shows the note, the adult warning and the expiry only when there is something to show', () => {
      const plain = only(formatBundle(notice(bundle({ note: null, mature: false, expiry: null }))));
      expect(plain).not.toContain('Nota de ITAD');
      expect(plain).not.toContain('adultos');
      expect(plain).not.toContain('Caduca');
      const empty = only(formatBundle(notice(bundle({ note: '' }))));
      expect(empty).not.toContain('Nota de ITAD');
      const full = only(formatBundle(notice(bundle({ note: 'Aviso', mature: true }))));
      expect(full).toContain('<p>Nota de ITAD: Aviso</p><p>Contenido para adultos</p><p>Caduca: <tg-time ');
    });

    it('formats expiry and publication in the reader time zone with a UTC fallback text', () => {
      const html = only(formatBundle(notice(bundle({ publish: '2026-12-31T23:30:00-02:00', expiry: '2027-01-01T00:00:00.999Z' }))));
      expect(html).toContain(`<tg-time unix="${unix('2027-01-01T00:00:00Z')}" format="Dt">2027-01-01 00:00 UTC</tg-time>`);
      expect(html).toContain(`<tg-time unix="${unix('2027-01-01T01:30:00Z')}" format="Dt">2027-01-01 01:30 UTC</tg-time></footer>`);
    });
  });

  describe('tiers and games', () => {
    it('numbers the tiers and shows the price, the missing price and the addon flag as received', () => {
      const html = only(formatBundle(notice(bundle({
        tiers: [
          tier([game(1)]),
          tier([game(2)], { price: null }),
          tier([game(3)], { price: { amount: 12.5, amountInt: 1250, currency: 'EUR' }, addon: true }),
        ],
      }))));
      expect(html).toContain(`<hr/><h4>Nivel 1 · ${PRICE}</h4>`);
      expect(html).toContain('<hr/><h4>Nivel 2 · precio no indicado</h4>');
      expect(html).toContain(`<hr/><h4>Nivel 3 · 12,50${NBSP}€ · addon</h4>`);
      expect(html.indexOf('Nivel 1')).toBeLessThan(html.indexOf('Nivel 2'));
      expect(html.indexOf('Nivel 2')).toBeLessThan(html.indexOf('Nivel 3'));
    });

    it('keeps a tier without games as a heading and a bundle without tiers as the head only', () => {
      const empty = only(formatBundle(notice(bundle({ tiers: [tier([game(1)]), tier([], { price: null })] }))));
      expect(empty).toContain(`<hr/><h4>Nivel 2 · precio no indicado</h4><footer>Bundle ITAD 9101`);
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
      ['a game', { type: 'game' as const }, ''],
      ['a game without type', { type: null }, ''],
      ['DLC', { type: 'dlc' as const }, ' · DLC'],
      ['a package', { type: 'package' as const }, ' · Paquete'],
      ['an adult game', { mature: true }, ' · adultos'],
      ['adult DLC', { type: 'dlc' as const, mature: true }, ' · DLC · adultos'],
    ])('labels %s', (_name, overrides, label) => {
      const html = only(formatBundle(notice(bundle({ tiers: [tier([game(1, overrides)])] }), [gid(1)])));
      expect(html).toContain(`<p><a href="${link(1)}">Game 1</a>${label} <mark>en tu Waitlist</mark></p>`);
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
      const summary = `${HEADER} · incluye 2 juegos de tu Waitlist</p>`;
      parts.forEach(part => expect(part.startsWith(summary)).toBe(true));
      // The head and its buttons belong to the first part only.
      expect(parts[0]).toContain('<h3>Bundle de prueba</h3>');
      expect(parts.slice(1).join('')).not.toContain('<h3>');
      expect(buttonUrls(parts)).toEqual([ITAD_PAGE, STORE_URL]);
      expect(parts[0]).toContain(`<h4>Nivel 1 · ${PRICE}</h4>`);
      for (const part of parts.slice(1)) {
        expect(part.slice(summary.length).startsWith(`<h4>Nivel 1 · ${PRICE} (continuación)</h4><p><a href=`)).toBe(true);
      }
      // Nothing is dropped or repeated.
      const titles = [...parts.join('').matchAll(/>Game (\d+)<\/a>/g)].map(match => Number(match[1]));
      expect(titles).toEqual(Array.from({ length: 900 }, (_, index) => index + 1));
      expect(parts.join('').match(/<mark>en tu Waitlist<\/mark>/g)).toHaveLength(2);
      expect(parts.join('')).toContain(`<a href="${link(5)}">Game 5</a> <mark>en tu Waitlist</mark>`);
      expect(parts.join('')).toContain(`<a href="${link(700)}">Game 700</a> <mark>en tu Waitlist</mark>`);
    });

    it('keeps every tier heading with its first game when several tiers are split', () => {
      const parts = formatBundle(notice(bundle({
        tiers: [tier(many(450)), tier(many(450, 1001), { price: null, addon: true }), tier(many(3, 2001))],
      })));
      expect(parts.length).toBeGreaterThan(2);
      checkParts(parts);
      const all = parts.join('');
      expect(all.match(new RegExp(`<h4>Nivel 1 · ${PRICE}</h4>`, 'g'))).toHaveLength(1);
      expect(all.match(/<h4>Nivel 2 · precio no indicado · addon<\/h4>/g)).toHaveLength(1);
      expect(all.match(new RegExp(`<h4>Nivel 3 · ${PRICE}</h4>`, 'g'))).toHaveLength(1);
      for (const part of parts) expect(part).not.toMatch(/<h4>[^<]*<\/h4>(<hr\/>|<footer>)/);
      for (const part of parts.slice(1)) {
        expect(part.replace(/^<p><b>ITAD · Bundle<\/b>[^<]*<\/p>/, '').startsWith('<h4>')).toBe(true);
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
      ['a note that does not fit in one message', { note: 'x'.repeat(31_000) }],
    ])('refuses to cut %s', (_name, overrides) => {
      expect(() => formatBundle(notice(bundle(overrides)))).toThrow(InputError);
      expect(() => formatBundle(notice(bundle(overrides)))).toThrow('rich_too_large');
    });
  });
});
