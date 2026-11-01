import type { Bundle, BundleGame, BundleNotice, BundleTier } from './domain';
import { buttonRow, attr, esc, gameUrl, money, pack, partLabel, when, type Frame, type Unit } from './rich';

const TYPE_LABEL = { dlc: 'DLC', package: 'Paquete' } as const;

function present<T>(value: T | null | false): value is T {
  return value !== null && value !== false;
}

function head(bundle: Bundle): string {
  return `<h3>${esc(bundle.title)}</h3><p><b>${esc(bundle.shop)}</b></p>` +
    (bundle.note ? `<p>Nota de ITAD: ${esc(bundle.note)}</p>` : '') +
    (bundle.mature ? '<p>Contenido para adultos</p>' : '') +
    (bundle.expiry !== null ? `<p>Caduca: ${when(bundle.expiry)}</p>` : '') +
    buttonRow([
      ...(bundle.details !== null ? [{ label: 'Ver en ITAD', url: bundle.details, primary: true }] : []),
      { label: `Ver bundle en ${bundle.shop}`, url: bundle.url },
    ]);
}

function tierTitle(tier: BundleTier, index: number): string {
  // The meaning of `addon` is not documented by ITAD: it is shown as received.
  return `Nivel ${index + 1} · ${tier.price === null ? 'precio no indicado' : money(tier.price)}` +
    (tier.addon ? ' · addon' : '');
}

function gameLine(game: BundleGame, waitlist: ReadonlySet<string>, collection: ReadonlySet<string>): string {
  const id = game.id.toLowerCase();
  const kind = [
    game.type !== null && game.type !== 'game' ? TYPE_LABEL[game.type] : null,
    game.mature ? 'adultos' : null,
  ].filter(present).join(' · ');
  const marks = [
    waitlist.has(id) ? '<mark>en tu Waitlist</mark>' : null,
    collection.has(id) ? '<mark>en tu Colección</mark>' : null,
  ].filter(present).join(' ');
  return `<p><a href="${attr(gameUrl(game.slug))}">${esc(game.title)}</a>` +
    `${kind ? ` · ${kind}` : ''}${marks ? ` ${marks}` : ''}</p>`;
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
  const matched = new Set(bundle.tiers.flatMap(tier => tier.games)
    .map(game => game.id.toLowerCase()).filter(id => waitlist.has(id)));
  const units: Unit[] = [{ html: head(bundle) }];
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
        : { html: line, opener: `<h4>${esc(`${tierTitle(tier, tierIndex)} (continuación)`)}</h4>` });
    });
  });
  const summary = matched.size > 0
    ? ` · incluye ${matched.size} ${matched.size === 1 ? 'juego' : 'juegos'} de tu Waitlist` : '';
  const frame: Frame = (body, index, total) =>
    `<p><b>ITAD · Bundle</b>${summary}</p>${body}` +
    `<footer>Bundle ITAD ${bundle.id}${partLabel(index, total)} · publicado ${when(bundle.publish)}</footer>`;
  return pack(units, frame);
}
