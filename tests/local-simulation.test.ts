import { describe, expect, it } from 'vitest';
import { SIMULATED_LARGE_NOTICE_GAMES, simulatedDetail } from '../src/local-simulation';
import { formatNotification } from '../src/notifications';
import { countBlocks, countImages, RICH_BUDGET, utf8Length } from '../src/rich';
import { parseWaitlistNotification } from '../src/validation';

const AT = '2026-10-31T12:10:00.000Z';
const noticeId = (index: number) => `00000000-0000-4000-a000-${String(index).padStart(12, '0')}`;
const notice = (index: number) => parseWaitlistNotification(simulatedDetail(noticeId(index), index, AT));

// tests/cron.integration.mjs needs a 17-part Rich backlog: the I6 drain (6 ticks) and the
// 429/403 checks run on it. The title length grows with the index, so several widths are pinned.
describe('local simulation notices', () => {
  it.each([2, 5, 8, 11, 98, 101, 1001])('splits large notice %i into exactly 17 Rich parts', index => {
    const large = notice(index);
    expect(large.games).toHaveLength(SIMULATED_LARGE_NOTICE_GAMES);
    const banners = new Map(large.games.slice(0, 2).map((game, i) => [game.id, `https://example.invalid/sim/banner-${index}-${i}.jpg`] as const));
    for (const parts of [formatNotification(large, { banners }), formatNotification(large)]) {
      expect(parts).toHaveLength(17);
      expect(Math.max(...parts.map(utf8Length))).toBeLessThanOrEqual(RICH_BUDGET.bytes);
      expect(Math.max(...parts.map(countBlocks))).toBeLessThanOrEqual(RICH_BUDGET.blocks);
      expect(Math.max(...parts.map(countImages))).toBeLessThanOrEqual(RICH_BUDGET.images);
      const joined = parts.join('');
      for (const game of large.games) {
        expect(joined).toContain(`<h3>${game.title}</h3>`);
        for (const deal of game.deals) {
          expect(joined.split(`url="${deal.url}"`)).toHaveLength(2);
        }
      }
      expect(joined.match(/style="success"/g)).toHaveLength(large.games.length * 2);
      expect(joined.match(/style="primary"/g)).toHaveLength(large.games.length);
    }
  });

  it('records the original 595-game workload with its current part count, without dropping any offers', () => {
    const large = notice(2);
    const template = large.games[0]!;
    large.games = Array.from({ length: 595 }, (_, game) => ({
      ...structuredClone(template),
      id: `00000000-0000-4000-b000-${String(2000 + game).padStart(12, '0')}`,
      slug: `simulated-game-2-${game}`, title: `Juego simulado 2.${game + 1}`,
      deals: template.deals.map(deal => ({
        ...structuredClone(deal),
        url: `https://example.invalid/sim/deal-${2000 + game}-${deal.shop.id}?ref=affiliate-sim`,
      })),
    }));
    const banners = new Map(large.games.slice(0, 2).map((game, i) =>
      [game.id, `https://example.invalid/sim/banner-2-${i}.jpg`] as const));
    for (const parts of [formatNotification(large), formatNotification(large, { banners })]) {
      expect(parts).toHaveLength(17);
      expect(Math.max(...parts.map(utf8Length))).toBeLessThanOrEqual(RICH_BUDGET.bytes);
      expect(Math.max(...parts.map(countBlocks))).toBeLessThanOrEqual(RICH_BUDGET.blocks);
      expect(parts.join('').match(/style="success"/g)).toHaveLength(1190);
      expect(parts.join('').match(/style="primary"/g)).toHaveLength(595);
      expect(utf8Length(JSON.stringify(large)) + utf8Length(JSON.stringify(parts))).toBeLessThan(2_000_000);
    }
  });

  it('keeps the stored plan of a large notice under the D1 row limit (2,000,000 bytes)', () => {
    const large = notice(1001);
    expect(utf8Length(JSON.stringify(large)) + utf8Length(JSON.stringify(formatNotification(large)))).toBeLessThan(2_000_000);
  });

  it('budgets all 1190 expiry footers as well as multipart markers without losing content', () => {
    const large = notice(2);
    for (const game of large.games) {
      for (const deal of game.deals) deal.expiry = '2024-03-21T23:59:59Z';
    }
    const parts = formatNotification(large);
    const content = parts.map(part => part.replace(/<footer>parte \d+\/\d+<\/footer>$/, '')).join('');
    expect(content.match(/<footer>Hasta el 22 de marzo<\/footer>/g)).toHaveLength(1190);
    expect(content.match(/style="success"/g)).toHaveLength(1190);
    expect(content.match(/style="primary"/g)).toHaveLength(595);
    parts.forEach((part, index) => {
      expect(part.endsWith(`<footer>parte ${index + 1}/${parts.length}</footer>`)).toBe(true);
      expect(utf8Length(part)).toBeLessThanOrEqual(RICH_BUDGET.bytes);
      expect(countBlocks(part)).toBeLessThanOrEqual(RICH_BUDGET.blocks);
    });
  });

  it.each([1, 3, 4, 6])('keeps small notice %i in a single part', index => {
    expect(notice(index).games).toHaveLength(2);
    expect(formatNotification(notice(index))).toHaveLength(1);
  });
});
