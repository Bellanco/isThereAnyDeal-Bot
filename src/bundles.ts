import type { Bundle, BundleGame, BundleNotice, BundleTier } from './domain';
import { buttonRow, attr, esc, expiryFooter, gameUrl, money, pack, safeImageUrl, type Frame, type Unit } from './rich';

function present<T>(value: T | null | false): value is T {
  return value !== null && value !== false;
}

function head(bundle: Bundle): string {
  return `<h3>${esc(bundle.title)}</h3>` +
    expiryFooter(bundle.expiry) +
    buttonRow([{ label: `Comprar en ${bundle.shop}`, url: bundle.url, style: 'success' }]) +
    (bundle.details !== null ? buttonRow([{ label: 'Ver en ITAD', url: bundle.details, style: 'primary' }]) : '');
}

function tierTitle(tier: BundleTier, index: number): string {
  // The meaning of `addon` is not documented by ITAD: it is shown as received.
  return `Nivel ${index + 1}` + (tier.price === null ? '' : ` · ${money(tier.price)}`) +
    (tier.addon ? ' · addon' : '');
}

function gameLine(game: BundleGame, waitlist: ReadonlySet<string>, collection: ReadonlySet<string>): string {
  const id = game.id.toLowerCase();
  const marks = [
    waitlist.has(id) ? '<mark>En tu lista de deseos</mark>' : null,
    collection.has(id) ? '<mark>En tu Colección</mark>' : null,
  ].filter(present).join(' · ');
  return `<p><a href="${attr(gameUrl(game.slug))}">${esc(game.title)}</a></p>` +
    (marks ? `<p>${marks}</p>` : '');
}

/**
 * Rich HTML of a bundle that contains games of the user's Waitlist. Every tier and
 * game is listed; the message is split between parts only at a game boundary, with
 * the tier heading repeated. Store and game links are used as received or built
 * from the official slug.
 */
export function formatBundle(notice: BundleNotice): string[] {
  const { bundle } = notice;
  const waitlist = new Set(notice.waitlist.map(id => id.toLowerCase()));
  const collection = new Set(notice.collection.map(id => id.toLowerCase()));
  const games = bundle.tiers.flatMap(tier => tier.games);
  const hasBanner = (game: BundleGame) => safeImageUrl(game.banner) !== null;
  const imageGame = games.find(game => waitlist.has(game.id.toLowerCase()) && hasBanner(game));
  const image = imageGame
    ? `<img src="${attr(safeImageUrl(imageGame.banner)!)}"/>`
    : '';
  const units: Unit[] = [{ html: image + head(bundle) }];
  bundle.tiers.forEach((tier, tierIndex) => {
    const heading = `<h4>${esc(tierTitle(tier, tierIndex))}</h4>`;
    if (tier.games.length === 0) {
      units.push({ html: heading, joiner: '<hr/>' });
      return;
    }
    tier.games.forEach((game, gameIndex) => {
      const line = gameLine(game, waitlist, collection);
      units.push(gameIndex === 0
        ? { html: heading + line, joiner: '<hr/>' }
        : {
          html: line,
          joiner: '<hr/>',
          opener: `<h4>${esc(`${tierTitle(tier, tierIndex)} (continuación)`)}</h4>`,
        });
    });
  });
  const frame: Frame = (body, index, total) =>
    body + (total > 1 ? `<footer>parte ${index}/${total}</footer>` : '');
  return pack(units, frame);
}
