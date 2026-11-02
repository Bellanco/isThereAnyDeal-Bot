import { describe, expect, it } from 'vitest';
import { InputError } from '../src/domain';
import {
  BUNDLE_KEY, bundleKey, isNoticeKey, parseBundles, parseGameIds, parseWaitlistGames, UUID,
} from '../src/validation';

const GAME = '018d937f-1111-7000-8000-00000000000a';
const OTHER = '018D937F-2222-7000-8000-00000000000B';

const game = (overrides: Record<string, unknown> = {}) =>
  ({ id: GAME, slug: 'game-a', title: 'Game A', type: 'game', mature: false, extra: 1, ...overrides });

const tier = (overrides: Record<string, unknown> = {}) => ({
  price: { amount: 4.99, amountInt: 499, currency: 'EUR', extra: 1 }, addon: false, games: [game()], extra: 1, ...overrides,
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 9101, title: 'Bundle', page: { id: 1, name: 'Humble Bundle', extra: 1 }, url: 'https://example.invalid/b?ref=x&a=1',
  details: 'https://isthereanydeal.com/specials/bundles/9101/', isMature: false,
  publish: '2026-10-31T10:00:00+01:00', expiry: '2026-11-14T19:00:00Z', note: 'Aviso', tiers: [tier()], extra: 1,
  ...overrides,
});

const bodyOf = (overrides: Record<string, unknown>) => parseBundles([item(overrides)])[0]!.bundle;

describe('parseBundles', () => {
  it('keeps every official field the message needs, drops the rest and leaves the affiliate link untouched', () => {
    expect(parseBundles([item()])).toEqual([{
      id: 9101,
      bundle: {
        id: 9101, title: 'Bundle', shop: 'Humble Bundle', url: 'https://example.invalid/b?ref=x&a=1',
        details: 'https://isthereanydeal.com/specials/bundles/9101/', note: 'Aviso', mature: false,
        publish: '2026-10-31T10:00:00+01:00', expiry: '2026-11-14T19:00:00Z',
        tiers: [{
          price: { amount: 4.99, amountInt: 499, currency: 'EUR' }, addon: false,
          games: [{ id: GAME, slug: 'game-a', title: 'Game A', type: 'game', mature: false }],
        }],
      },
    }]);
  });

  it('preserves compatibility for absent bundle metadata and nullable tier prices', () => {
    const body = bodyOf({ details: undefined, note: null, expiry: null, tiers: [tier({ price: null })] });
    expect(body).toMatchObject({ details: null, note: null, expiry: null });
    expect(body?.tiers[0]?.price).toBeNull();
    expect(bodyOf({ details: null, note: undefined, expiry: undefined }))
      .toMatchObject({ details: null, note: null, expiry: null });
  });

  it.each(['banner600', 'banner400', 'banner300', 'banner145'])('preserves a safe per-game %s unchanged', size => {
    const url = 'https://assets.isthereanydeal.com/example/banner.jpg?t=1&ref=2';
    const body = bodyOf({ tiers: [tier({ games: [game({ assets: { [size]: url, boxart: 'https://example.invalid/box.jpg' } })] })] });
    expect(body?.tiers[0]?.games[0]?.banner).toBe(url);
  });

  it('chooses largest safe per-game banner and ignores unsafe/malformed/missing assets without dropping games', () => {
    const assets = [
      { banner600: 'https://example.invalid/600', banner400: 'https://example.invalid/400' },
      { banner600: 'http://unsafe.test/600', banner400: 'https://example.invalid/400' },
      { banner600: `https://example.invalid/${String.fromCharCode(0xd800)}`, banner400: 'https://example.invalid/safe400.jpg' },
      { banner600: `https://example.invalid/${String.fromCharCode(0xd800)}` },
      { banner600: '"', banner400: 4, banner300: 'javascript:1', banner145: 'https://example.invalid/145' },
      undefined, null, [], 'not assets', { boxart: 'https://example.invalid/box' },
    ];
    const body = bodyOf({ tiers: [tier({ games: assets.map(assets => game({ assets })) })] });
    expect(body?.tiers[0]?.games.map(g => g.banner)).toEqual([
      'https://example.invalid/600', 'https://example.invalid/400', 'https://example.invalid/safe400.jpg',
      undefined, 'https://example.invalid/145', undefined, undefined, undefined, undefined, undefined,
    ]);
  });

  it('accepts every documented game type, null included, and adult bundles', () => {
    const types = ['game', 'dlc', 'package', null];
    const body = bodyOf({ isMature: true, tiers: [tier({ games: types.map(type => game({ type })) })] });
    expect(body?.mature).toBe(true);
    expect(body?.tiers[0]?.games.map(entry => entry.type)).toEqual(types);
  });

  it('keeps empty tiers, empty games and addon tiers as they come', () => {
    const body = bodyOf({ tiers: [tier({ games: [] }), tier({ addon: true, price: null }), tier()] });
    expect(body?.tiers.map(entry => [entry.addon, entry.price === null, entry.games.length])).toEqual([
      [false, false, 0], [true, true, 1], [false, false, 1],
    ]);
    expect(bodyOf({ tiers: [] })?.tiers).toEqual([]);
  });

  const invalid: Array<[string, Record<string, unknown>]> = [
    ['missing title', { title: undefined }],
    ['empty title', { title: '' }],
    ['lone surrogate in the title', { title: 'x\uD800' }],
    ['missing page', { page: undefined }],
    ['page without name', { page: { id: 1 } }],
    ['empty shop name', { page: { id: 1, name: '' } }],
    ['missing url', { url: undefined }],
    ['non-http url', { url: 'ftp://example.invalid/b' }],
    ['url with credentials', { url: 'https://user:pw@example.invalid/b' }],
    ['url with whitespace', { url: 'https://example.invalid/b c' }],
    ['text instead of a url', { url: 'not a url' }],
    ['details that are not http', { details: 'javascript:alert(1)' }],
    ['non-boolean isMature', { isMature: 'no' }],
    ['missing isMature', { isMature: undefined }],
    ['impossible publish date', { publish: '2026-02-30T10:00:00Z' }],
    ['publish without a zone', { publish: '2026-10-31T10:00:00' }],
    ['expiry that is not a date', { expiry: 'tomorrow' }],
    ['non-string note', { note: 5 }],
    ['tiers that are not a list', { tiers: {} }],
    ['tier that is not an object', { tiers: [null] }],
    ['tier without the addon flag', { tiers: [tier({ addon: undefined })] }],
    ['tier without its required nullable price', { tiers: [tier({ price: undefined })] }],
    ['tier games that are not a list', { tiers: [tier({ games: null })] }],
    ['negative price', { tiers: [tier({ price: { amount: -1, amountInt: -100, currency: 'EUR' } })] }],
    ['fractional amountInt', { tiers: [tier({ price: { amount: 1, amountInt: 1.5, currency: 'EUR' } })] }],
    ['lowercase currency', { tiers: [tier({ price: { amount: 1, amountInt: 100, currency: 'eur' } })] }],
    ['game id that is not a UUID', { tiers: [tier({ games: [game({ id: 'x' })] })] }],
    ['game without the mature flag', { tiers: [tier({ games: [game({ mature: undefined })] })] }],
    ['unknown game type', { tiers: [tier({ games: [game({ type: 'season' })] })] }],
    ['game without slug', { tiers: [tier({ games: [game({ slug: undefined })] })] }],
    ['game with an empty title', { tiers: [tier({ games: [game({ title: '' })] })] }],
  ];
  for (const [name, overrides] of invalid) {
    it(`keeps the id but drops the body: ${name}`, () => {
      expect(parseBundles([item(overrides)])).toEqual([{ id: 9101, bundle: null }]);
    });
  }

  it('judges every bundle on its own and keeps the order of the list', () => {
    const entries = parseBundles([item({ id: 3 }), item({ id: 2, title: '' }), item({ id: 1 })]);
    expect(entries.map(entry => [entry.id, entry.bundle?.id ?? null])).toEqual([[3, 3], [2, null], [1, 1]]);
    expect(parseBundles([])).toEqual([]);
  });

  it('does not read the id from the body of an invalid bundle', () => {
    expect(parseBundles([{ id: 77, title: { not: 'text' } }])).toEqual([{ id: 77, bundle: null }]);
  });

  const unusable: Array<[string, unknown]> = [
    ['null', null], ['an object', {}], ['a string', 'x'], ['an entry that is not an object', [null]],
    ['an entry without id', [{}]], ['id 0', [{ id: 0 }]], ['a negative id', [{ id: -1 }]],
    ['a fractional id', [{ id: 1.5 }]], ['a text id', [{ id: '9101' }]], ['an unsafe id', [{ id: 2 ** 53 }]],
    ['an id over the stored key range', [{ id: 1e15 }]], ['NaN', [{ id: Number.NaN }]],
  ];
  for (const [name, value] of unusable) {
    it(`rejects the whole response when it is ${name}`, () => {
      expect(() => parseBundles(value)).toThrow(InputError);
    });
  }

  it('accepts the largest id that fits the stored key', () => {
    expect(parseBundles([{ id: 999_999_999_999_999 }])).toEqual([{ id: 999_999_999_999_999, bundle: null }]);
  });
});

describe('parseWaitlistGames', () => {
  const host = 'https://cdn.example/';

  it('keeps the largest usable banner and lowercases the ids', () => {
    expect(parseWaitlistGames([
      { id: OTHER, assets: { banner300: `${host}c.jpg`, banner400: `${host}b.jpg`, banner600: `${host}a.jpg?x=1&y=2` } },
      { id: GAME, assets: { banner300: `${host}c.jpg`, banner400: `${host}b.jpg` } },
      { id: '018d937f-3333-7000-8000-00000000000c', assets: { banner300: `${host}c.jpg` } },
    ])).toEqual([
      { id: OTHER.toLowerCase(), banner: `${host}a.jpg?x=1&y=2` },
      { id: GAME, banner: `${host}b.jpg` },
      { id: '018d937f-3333-7000-8000-00000000000c', banner: `${host}c.jpg` },
    ]);
  });

  it('skips an unusable banner and falls back to the next size, or to none', () => {
    const [fallback, none] = parseWaitlistGames([
      { id: GAME, assets: { banner600: 'http://cdn.example/a.jpg', banner400: 5, banner300: `${host}c.jpg` } },
      { id: OTHER, assets: { banner600: null, banner400: '', banner300: 'javascript:alert(1)' } },
    ]);
    expect(fallback?.banner).toBe(`${host}c.jpg`);
    expect(none?.banner).toBeNull();
  });

  it.each([
    ['a quote', `${host}a"b.jpg`], ['an angle bracket', `${host}a<b.jpg`], ['a closing bracket', `${host}a>b.jpg`],
    ['a space', `${host}a b.jpg`], ['a line break', `${host}a\nb.jpg`], ['http', 'http://cdn.example/a.jpg'],
    ['a scheme in capitals', 'HTTPS://cdn.example/a.jpg'], ['a relative path', '/a.jpg'],
    ['more than 2048 characters', `${host}${'a'.repeat(2029)}`],
  ])('does not use a banner URL with %s', (_name, banner600) => {
    expect(parseWaitlistGames([{ id: GAME, assets: { banner600 } }])[0]?.banner).toBeNull();
  });

  it('accepts a banner URL of exactly 2048 characters', () => {
    const banner = `${host}${'a'.repeat(2028)}`;
    expect(banner).toHaveLength(2048);
    expect(parseWaitlistGames([{ id: GAME, assets: { banner600: banner } }])[0]?.banner).toBe(banner);
  });

  it.each([['missing', undefined], ['null', null], ['an array', [`${host}a.jpg`]], ['a string', `${host}a.jpg`]])(
    'keeps the game without a banner when assets are %s', (_name, assets) => {
      expect(parseWaitlistGames([{ id: GAME, ...(assets === undefined ? {} : { assets }) }])).toEqual([{ id: GAME, banner: null }]);
    },
  );

  it.each([
    ['null', null], ['an object', {}], ['an entry that is not an object', [null]],
    ['an entry without id', [{}]], ['an id that is not a UUID', [{ id: 'x' }]], ['a numeric id', [{ id: 7 }]],
  ])('rejects the whole response when it is %s', (_name, value) => {
    expect(() => parseWaitlistGames(value)).toThrow(InputError);
  });

  it('returns an empty list for an empty Waitlist', () => {
    expect(parseWaitlistGames([])).toEqual([]);
  });
});

describe('parseGameIds', () => {
  it('keeps only the lowercased ids, in order', () => {
    expect(parseGameIds([{ id: OTHER, title: 'ignored', assets: {} }, { id: GAME }])).toEqual([OTHER.toLowerCase(), GAME]);
    expect(parseGameIds([])).toEqual([]);
  });

  it.each([
    ['null', null], ['an object', {}], ['an entry that is not an object', [1]], ['an entry without id', [{}]],
    ['an id that is not a UUID', [{ id: 'x' }]], ['a numeric id', [{ id: 7 }]],
  ])('rejects the whole response when it is %s', (_name, value) => {
    expect(() => parseGameIds(value)).toThrow(InputError);
  });
});

describe('notice keys', () => {
  it('builds the key that tells a bundle apart from an official notification', () => {
    expect(bundleKey(9101)).toBe('bundle:9101');
    expect(BUNDLE_KEY.test(bundleKey(999_999_999_999_999))).toBe(true);
  });

  it.each([GAME, OTHER, 'bundle:1', 'bundle:9101', 'bundle:999999999999999'])('accepts %s', value => {
    expect(isNoticeKey(value)).toBe(true);
  });

  it.each([
    'bundle:0', 'bundle:01', 'bundle:', 'bundle:-1', 'bundle:1.5', 'bundle:1e3', 'bundle:1234567890123456',
    'Bundle:1', ' bundle:1', 'bundle:1 ', 'bundle:1\n', `${GAME} `, 'x', '', 'waitlist:1',
  ])('rejects %j', value => {
    expect(isNoticeKey(value)).toBe(false);
  });

  it('rejects values that are not text', () => {
    for (const value of [null, undefined, 9101, {}, [GAME]]) expect(isNoticeKey(value)).toBe(false);
  });

  it('does not let a bundle key pass as a UUID', () => {
    expect(UUID.test('bundle:1')).toBe(false);
  });
});
