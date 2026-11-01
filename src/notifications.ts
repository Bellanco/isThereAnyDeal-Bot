import { InputError, type Deal, type Game, type WaitlistNotification } from './domain';
import { attr, buttonRow, esc, gameUrl, money, pack, partLabel, safeImageUrl, when, type Frame, type Unit } from './rich';
import { parseWaitlistNotification } from './validation';

/** Banner URL by game id, from the user's Waitlist. Optional decoration only. */
export type BannerMap = ReadonlyMap<string, string>;

export interface FormatOptions {
  banners?: BannerMap;
}

const FLAG_LABEL = {
  H: 'Mínimo histórico', N: 'Nuevo mínimo histórico', S: 'Mínimo de la tienda',
} as const;
const TYPE_LABEL = { dlc: 'DLC', package: 'Paquete' } as const;

function present<T>(value: T | null | false | undefined | ''): value is T {
  return value !== null && value !== false && value !== undefined && value !== '';
}

function bannerImage(url: string | undefined): string {
  const safe = safeImageUrl(url);
  return safe === null ? '' : `<img src="${attr(safe)}"/>`;
}

function gameHead(game: Game, banner: string | undefined): string {
  const facts = [
    game.historyLow && `Mínimo histórico: ${money(game.historyLow)}`,
    game.lastPrice && `Precio anterior: ${money(game.lastPrice)}`,
  ].filter(present).map(esc);
  const tags = [
    game.type !== null && game.type !== 'game' ? TYPE_LABEL[game.type] : null,
    game.mature ? 'Contenido para adultos' : null,
  ].filter(present);
  return `${bannerImage(banner)}<h3>${esc(game.title)}</h3>` +
    (facts.length ? `<p>${facts.join(' · ')}</p>` : '') +
    (tags.length ? `<p>${tags.join(' · ')}</p>` : '');
}

function dealBlock(game: Game, deal: Deal, itad: boolean): string {
  const headline = [
    `<mark>-${deal.cut}%</mark> <b>${esc(money(deal.price))}</b>`,
    esc(deal.shop.name),
    deal.flag === null ? null : FLAG_LABEL[deal.flag],
  ].filter(present).join(' · ');
  const prices = [
    `Precio habitual: ${esc(money(deal.regular))}`,
    deal.storeLow && `Mínimo en tienda: ${esc(money(deal.storeLow))}`,
  ].filter(present).join(' · ');
  const offer = [
    deal.voucher && `Cupón: <code>${esc(deal.voucher)}</code>`,
    deal.expiry !== null ? `Caduca: ${when(deal.expiry)}` : null,
  ].filter(present).join(' · ');
  const store = [
    deal.drm.length ? `DRM: ${esc(deal.drm.map(item => item.name).join(', '))}` : null,
    deal.platforms.length ? `Plataformas: ${esc(deal.platforms.map(item => item.name).join(', '))}` : null,
  ].filter(present).join(' · ');
  return `<p>${headline}</p><p>${prices}</p>` +
    (offer ? `<p>${offer}</p>` : '') +
    (store ? `<p>${store}</p>` : '') +
    `<p>Oferta publicada: ${when(deal.timestamp)}</p>` +
    buttonRow([
      ...(itad ? [{ label: 'Ver en ITAD', url: gameUrl(game.slug), primary: true }] : []),
      { label: `Comprar en ${deal.shop.name}`, url: deal.url },
    ]);
}

/**
 * Rich HTML of one official notice, never filtered or reduced. It is split between
 * parts only when Telegram's rich message limits require it, always at a game/offer
 * boundary. Offer URLs are used exactly as received.
 */
export function formatNotification(notification: WaitlistNotification, options: FormatOptions = {}): string[] {
  // Also protect callers passing unvalidated runtime data through typed interfaces.
  const valid = parseWaitlistNotification(notification);
  const units: Unit[] = [];
  valid.games.forEach((game, gameIndex) => {
    const head = gameHead(game, options.banners?.get(game.id.toLowerCase()));
    const joiner = gameIndex > 0 ? { joiner: '<hr/>' } : {};
    if (game.deals.length === 0) {
      units.push({
        html: head + buttonRow([{ label: 'Ver en ITAD', url: gameUrl(game.slug), primary: true }]), ...joiner,
      });
      return;
    }
    game.deals.forEach((deal, dealIndex) => {
      if (dealIndex === 0) {
        units.push({ html: head + dealBlock(game, deal, true), ...joiner });
      } else {
        units.push({ html: dealBlock(game, deal, false), opener: `<h3>${esc(game.title)} (continuación)</h3>` });
      }
    });
  });
  const count = valid.games.length;
  const summary = count > 0 ? ` · ${count} ${count === 1 ? 'juego' : 'juegos'} en oferta` : '';
  const read = valid.read === null ? 'no' : when(valid.read);
  const frame: Frame = (body, index, total) =>
    `<p><b>ITAD · Waitlist</b>${summary}</p>${body}` +
    `<footer>Aviso ITAD ${valid.id}${partLabel(index, total)} · ${when(valid.timestamp)} · Leído en ITAD: ${read}</footer>`;
  return pack(units, frame);
}

export interface FormattedNotification {
  notification: WaitlistNotification;
  parts: string[];
}

/** Complete validation/formatting before a future caller starts any delivery. */
export function prepareNotificationBatch(value: unknown, options: FormatOptions = {}): FormattedNotification[] {
  if (!Array.isArray(value)) throw new InputError('invalid_payload');
  const notifications = value.map((entry: unknown) => parseWaitlistNotification(entry));
  return notifications.map(notification => ({ notification, parts: formatNotification(notification, options) }));
}
