import { describe, expect, it } from 'vitest';
import { SIMULATED_LARGE_NOTICE_GAMES, simulatedDetail } from '../src/local-simulation';
import { formatNotification } from '../src/notifications';
import { utf8Length } from '../src/rich';
import { parseWaitlistNotification } from '../src/validation';

const AT = '2026-10-31T12:10:00.000Z';
const noticeId = (index: number) => `00000000-0000-4000-a000-${String(index).padStart(12, '0')}`;
const notice = (index: number) => parseWaitlistNotification(simulatedDetail(noticeId(index), index, AT));

// tests/cron.integration.mjs needs a 20-part Rich backlog: the I6 drain (7 ticks) and the
// 429/403 checks run on it. The title length grows with the index, so several widths are pinned.
describe('local simulation notices', () => {
  it.each([2, 5, 8, 11, 98, 101, 1001])('splits large notice %i into exactly 20 Rich parts', index => {
    const large = notice(index);
    expect(large.games).toHaveLength(SIMULATED_LARGE_NOTICE_GAMES);
    const banners = new Map(large.games.slice(0, 2).map((game, i) => [game.id, `https://example.invalid/sim/banner-${index}-${i}.jpg`] as const));
    for (const parts of [formatNotification(large, { banners }), formatNotification(large)]) {
      expect(parts).toHaveLength(20);
      expect(Math.max(...parts.map(utf8Length))).toBeLessThanOrEqual(32768);
    }
  });

  it('keeps the stored plan of a large notice under the D1 row limit (2,000,000 bytes)', () => {
    const large = notice(1001);
    expect(utf8Length(JSON.stringify(large)) + utf8Length(JSON.stringify(formatNotification(large)))).toBeLessThan(2_000_000);
  });

  it.each([1, 3, 4, 6])('keeps small notice %i in a single part', index => {
    expect(notice(index).games).toHaveLength(2);
    expect(formatNotification(notice(index))).toHaveLength(1);
  });
});
