import { describe, expect, it } from 'vitest';
import { InputError, type Price } from '../src/domain';
import {
  attr, buttonRow, countBlocks, countImages, esc, gameUrl, money, pack, partLabel, RICH_BUDGET, safeImageUrl,
  stripImages, utf8Length, when, type Frame, type Unit,
} from '../src/rich';
import { expectWellFormed } from './rich-helpers';

const NBSP = '\u00a0';
const price = (amount: number, currency = 'EUR'): Price => ({ amount, amountInt: Math.round(amount * 100), currency });

describe('text helpers', () => {
  it('escapes only the characters that are significant in text', () => {
    expect(esc('Tom & <Jerry> "x" \'y\'')).toBe('Tom &amp; &lt;Jerry&gt; "x" \'y\'');
    expect(esc('&amp;')).toBe('&amp;amp;');
    expect(esc('')).toBe('');
  });

  it('escapes attribute values, quotes included', () => {
    expect(attr('a"b&c<d>\'e')).toBe('a&quot;b&amp;c&lt;d&gt;\'e');
  });

  it('measures UTF-8 bytes, not characters', () => {
    expect([utf8Length(''), utf8Length('a'), utf8Length('ñ'), utf8Length('€'), utf8Length('🎮')]).toEqual([0, 1, 2, 3, 4]);
  });

  it('labels the parts only when there are several', () => {
    expect(partLabel(1, 1)).toBe('');
    expect(partLabel(2, 3)).toBe(' · parte 2/3');
  });

  it('builds the ITAD game page from the slug, encoded', () => {
    expect(gameUrl('hades-2')).toBe('https://isthereanydeal.com/game/hades-2/');
    expect(gameUrl('a b/c?d#e&f"g')).toBe('https://isthereanydeal.com/game/a%20b%2Fc%3Fd%23e%26f%22g/');
  });

  it('accepts only plain https image URLs that are safe inside an attribute', () => {
    expect(safeImageUrl('https://cdn.example/a.jpg?x=1&y=2')).toBe('https://cdn.example/a.jpg?x=1&y=2');
    for (const value of [
      null, undefined, 5, {}, '', 'http://cdn.example/a.jpg', 'HTTPS://cdn.example/a.jpg', '//cdn.example/a.jpg',
      'https://cdn.example/a b', 'https://cdn.example/a"b', 'https://cdn.example/a<b', 'https://cdn.example/a>b',
      'https://cdn.example/a\nb', 'https://',
    ]) {
      expect(safeImageUrl(value)).toBeNull();
    }
  });
});

describe('money', () => {
  it('uses the Spanish format with a no-break space before the currency sign', () => {
    expect(money(price(4.99))).toBe(`4,99${NBSP}€`);
    expect(money(price(0))).toBe(`0,00${NBSP}€`);
    expect(money(price(0.5))).toBe(`0,50${NBSP}€`);
    expect(money(price(12345.5))).toBe(`12.345,50${NBSP}€`);
  });

  it('falls back to the received amount and currency when the currency cannot be formatted', () => {
    expect(money(price(1.5, 'euro'))).toBe('1.5 euro');
    expect(money(price(1.5, 'euro'))).toBe('1.5 euro');
    expect(money(price(2, '€'))).toBe('2 €');
  });
});

describe('when', () => {
  it('formats a fixed Spain/Madrid date in winter and summer', () => {
    expect(when('2026-01-15T12:34:00Z')).toBe('13:34 15-01-2026');
    expect(when('2026-07-15T12:34:00Z')).toBe('14:34 15-07-2026');
  });

  it('uses the Madrid date across a UTC day boundary and at a daylight-saving transition', () => {
    expect(when('2026-12-31T23:30:00Z')).toBe('00:30 01-01-2027');
    expect(when('2026-03-29T01:30:00Z')).toBe('03:30 29-03-2026');
    expect(when('1970-01-01T00:00:00Z')).toBe('01:00 01-01-1970');
  });
});

describe('buttonRow', () => {
  it('is empty without buttons', () => {
    expect(buttonRow([])).toBe('');
  });

  it('renders typed theme-dependent URL-button styles, or the default, in order', () => {
    expect(buttonRow([
      { label: 'Ver en ITAD', url: 'https://isthereanydeal.com/a/', style: 'primary' },
      { label: 'Comprar', url: 'https://shop.example/x', style: 'success' },
      { label: 'Otra', url: 'https://shop.example/y' },
    ])).toBe(
      '<tg-button-row>' +
      '<tg-button type="url" style="primary" url="https://isthereanydeal.com/a/">Ver en ITAD</tg-button>' +
      '<tg-button type="url" style="success" url="https://shop.example/x">Comprar</tg-button>' +
      '<tg-button type="url" url="https://shop.example/y">Otra</tg-button>' +
      '</tg-button-row>',
    );
  });

  it('escapes the label as text and the URL as an attribute without changing what the reader opens', () => {
    const html = buttonRow([{ label: 'Tom & <Jerry>', url: 'https://shop.example/x?a=1&b="2"<3>' }]);
    expect(html).toContain('>Tom &amp; &lt;Jerry&gt;</tg-button>');
    expect(html).toContain('url="https://shop.example/x?a=1&amp;b=&quot;2&quot;&lt;3&gt;"');
    expectWellFormed(html);
  });
});

describe('size counting', () => {
  it('counts every block-level tag, button row, button, image and separator once', () => {
    const html = '<h3>a</h3><p>b</p><hr/><h4>c</h4><footer>d</footer><img src="https://x/y.jpg"/>' +
      '<tg-button-row><tg-button type="url" url="https://x/">z</tg-button></tg-button-row><ul><li>i</li></ul><pre>p</pre>';
    expect(countBlocks(html)).toBe(11);
    expect(countImages(html)).toBe(1);
  });

  it('does not count inline tags, text that looks like a tag or lookalike names', () => {
    expect(countBlocks('<b>a</b><a href="x">b</a><mark>c</mark><tg-time unix="1" format="Dt">d</tg-time>')).toBe(0);
    expect(countBlocks('&lt;p&gt; &lt;img src=&quot;x&quot;/&gt;')).toBe(0);
    expect(countBlocks('<param>a</param><progress></progress><picture></picture>')).toBe(0);
    expect(countImages('&lt;img src=&quot;x&quot;/&gt;<image/>')).toBe(0);
  });

  it('counts images with and without extra attributes', () => {
    expect(countImages('<img src="https://x/1.jpg"/><img alt="" src="https://x/2.jpg"/><img/>')).toBe(3);
  });
});

describe('stripImages', () => {
  it('removes every image and nothing else', () => {
    const html = '<h3>Hades</h3><img src="https://cdn.example/a.jpg?x=1&amp;y=2"/><p>precio</p><img src="https://cdn.example/b.jpg"/><hr/>';
    expect(stripImages(html)).toBe('<h3>Hades</h3><p>precio</p><hr/>');
    expect(countImages(stripImages(html))).toBe(0);
  });

  it('leaves a message without images, and text that only mentions one, as it is', () => {
    const html = '<p>&lt;img src=&quot;x&quot;/&gt; <b>ok</b></p>';
    expect(stripImages(html)).toBe(html);
    expect(stripImages('')).toBe('');
  });
});

describe('pack', () => {
  const frame: Frame = (body, index, total) => `[${index}/${total}]${body}`;
  const unit = (html: string, extra: Partial<Unit> = {}): Unit => ({ html, ...extra });
  // Room left in a part by `frame` once its widest one-digit counter is reserved.
  const ROOM = RICH_BUDGET.bytes - utf8Length('[9/9]');

  it('frames an empty list as one empty part', () => {
    expect(pack([], frame)).toEqual(['[1/1]']);
  });

  it('keeps everything in one part when it fits, with joiners only between units', () => {
    expect(pack([unit('A'), unit('B', { joiner: '|' }), unit('C', { joiner: '|', opener: '#' })], frame)).toEqual(['[1/1]A|B|C']);
  });

  it('splits by size and numbers the parts with the final total', () => {
    const big = 'x'.repeat(10_000);
    const parts = pack([unit(big), unit(big), unit(big), unit(big)], frame);
    expect(parts).toEqual([`[1/2]${big}${big}`, `[2/2]${big}${big}`]);
  });

  it('never starts a part with a joiner and never puts an opener on the very first unit', () => {
    const half = 'x'.repeat(14_990);
    expect(pack([unit(half), unit(half, { joiner: '|' }), unit(half, { joiner: '|' })], frame))
      .toEqual([`[1/2]${half}|${half}`, `[2/2]${half}`]);
    expect(pack([unit(half, { opener: 'OP:' }), unit(half, { opener: 'OP:' }), unit(half, { opener: 'OP:' })], frame))
      .toEqual([`[1/2]${half}${half}`, `[2/2]OP:${half}`]);
  });

  it('counts joiners and openers in the budget and accepts a part that is exactly full', () => {
    const exact = 'x'.repeat(ROOM);
    const [only] = pack([unit(exact)], frame);
    expect(utf8Length(only!)).toBe(RICH_BUDGET.bytes);
    expect(pack([unit('A'), unit(exact)], frame)).toEqual(['[1/2]A', `[2/2]${exact}`]);
    expect(() => pack([unit('A'), unit(exact, { opener: 'OP:' })], frame)).toThrow('rich_too_large');
    expect(() => pack([unit('A'), unit(exact.slice(3), { opener: 'OP:' })], frame)).not.toThrow();
  });

  it('refuses a unit that does not fit alone instead of cutting it', () => {
    expect(() => pack([unit('x'.repeat(ROOM + 1))], frame)).toThrow(InputError);
    expect(() => pack([unit('A'), unit('x'.repeat(ROOM + 1))], frame)).toThrow('rich_too_large');
  });

  it('measures bytes, not characters', () => {
    expect(() => pack([unit('ñ'.repeat(Math.floor(ROOM / 2)))], frame)).not.toThrow();
    expect(() => pack([unit('ñ'.repeat(Math.floor(ROOM / 2) + 1))], frame)).toThrow('rich_too_large');
  });

  it('respects the block budget, counting the blocks of the frame', () => {
    const paragraph = unit('<p>x</p>');
    const plain = pack(Array.from({ length: 401 }, () => paragraph), frame);
    expect(plain.map(countBlocks)).toEqual([RICH_BUDGET.blocks, 1]);
    const framed = pack(Array.from({ length: 401 }, () => paragraph), (body, i, n) => `<p>${i}/${n}</p>${body}<footer>f</footer>`);
    expect(framed.map(countBlocks)).toEqual([RICH_BUDGET.blocks, 5]);
  });

  it('respects the image budget', () => {
    const image = unit('<img src="https://cdn.example/a.jpg"/>');
    const parts = pack(Array.from({ length: RICH_BUDGET.images + 1 }, () => image), frame);
    expect(parts.map(countImages)).toEqual([RICH_BUDGET.images, 1]);
  });

  it('reserves room for a counter that gains a digit', () => {
    const digitsFrame: Frame = (body, index, total) => `${index}/${total}|${body}`;
    const half = 'x'.repeat(14_998);
    // Nine parts of two units fill the budget exactly with a one-digit counter...
    const nine = pack(Array.from({ length: 18 }, () => unit(half)), digitsFrame);
    expect(nine).toHaveLength(9);
    nine.forEach(part => expect(utf8Length(part)).toBe(RICH_BUDGET.bytes));
    // ...but ten would not fit with "10/10", so the packing is repeated with a two-digit counter.
    const many = pack(Array.from({ length: 20 }, () => unit(half)), digitsFrame);
    expect(many).toHaveLength(20);
    many.forEach((part, index) => {
      expect(part.startsWith(`${index + 1}/20|`)).toBe(true);
      expect(utf8Length(part)).toBeLessThanOrEqual(RICH_BUDGET.bytes);
    });
  });

  it('keeps every unit whole, once and in order, for any mix of sizes', () => {
    let seed = 12345;
    // Park-Miller generator: exact in doubles, so the sizes are the same on every run.
    const next = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647;
    const units = Array.from({ length: 80 }, (_, index) => unit(`<p>u${index}:${'x'.repeat(1 + Math.floor(next() * 9_000))};</p>`));
    const parts = pack(units, (body, i, n) => `<p>${i}/${n}</p>${body}`);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part, index) => {
      expect(utf8Length(part)).toBeLessThanOrEqual(RICH_BUDGET.bytes);
      expect(countBlocks(part)).toBeLessThanOrEqual(RICH_BUDGET.blocks);
      expect(part.startsWith(`<p>${index + 1}/${parts.length}</p>`)).toBe(true);
    });
    expect(parts.map(part => part.replace(/^<p>\d+\/\d+<\/p>/, '')).join('')).toBe(units.map(item => item.html).join(''));
  });
});
