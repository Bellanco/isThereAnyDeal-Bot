import { InputError, type Deal, type Game, type WaitlistNotification } from './domain';
import { attr, buttonRow, esc, expiryFooter, gameUrl, money, pack, safeImageUrl, type Frame, type Unit } from './rich';
import { parseWaitlistNotification } from './validation';

/** Banner URL by game id, from the user's Waitlist. Optional decoration only. */
export type BannerMap = ReadonlyMap<string, string>;

export interface FormatOptions {
  banners?: BannerMap;
}

const FLAG_LABEL = 'Mínimo histórico';

function present<T>(value: T | null | false | undefined | ''): value is T {
  return value !== null && value !== false && value !== undefined && value !== '';
}

function bannerImage(url: string | undefined): string {
  const safe = safeImageUrl(url);
  return safe === null ? '' : `<img src="${attr(safe)}"/>`;
}

function gameHead(game: Game, banner: string | undefined): string {
  return `${bannerImage(banner)}<h3>${esc(game.title)}</h3>`;
}

function gameSecondary(game: Game): string {
  const facts = [
    game.historyLow && `Mínimo histórico: ${money(game.historyLow)}`,
  ].filter(present);
  return facts.map(fact => `<p>${esc(fact)}</p>`).join('');
}

function dealBlock(deal: Deal, showHistoryFlag: boolean): string {
  const offer = [
    deal.voucher && `Cupón: <code>${esc(deal.voucher)}</code>`,
  ].filter(present);
  return `<h4>${esc(money(deal.price))}${deal.cut > 0 ? ` · <mark>-${deal.cut}%</mark>` : ''}</h4>` +
    `<p><b>${esc(deal.shop.name)}</b></p>` +
    offer.map(line => `<p>${line}</p>`).join('') +
    expiryFooter(deal.expiry) +
    (showHistoryFlag && (deal.flag === 'H' || deal.flag === 'N') ? `<p>${FLAG_LABEL}</p>` : '');
}

function dealButtons(game: Game, deal: Deal, itad: boolean): string {
  return buttonRow([{ label: `Comprar en ${deal.shop.name}`, url: deal.url, style: 'success' }]) +
    (itad ? buttonRow([{ label: 'Ver en ITAD', url: gameUrl(game.slug), style: 'primary' }]) : '');
}

/**
 * Rich HTML keeps all games and offers, with secondary fields omitted by design. It is split between
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
        html: head + gameSecondary(game) +
          buttonRow([{ label: 'Ver en ITAD', url: gameUrl(game.slug), style: 'primary' }]), ...joiner,
      });
      return;
    }
    game.deals.forEach((deal, dealIndex) => {
      if (dealIndex === 0) {
        units.push({
          // A known game history-low already labels this first H/N offer; don't
          // repeat the same signal beside its numeric comparison.
          html: head + dealBlock(deal, !(game.historyLow !== null && (deal.flag === 'H' || deal.flag === 'N'))) +
            gameSecondary(game) + dealButtons(game, deal, true), ...joiner,
        });
      } else {
        units.push({
          html: dealBlock(deal, true) + dealButtons(game, deal, false), joiner: '<hr/>',
          opener: `<h3>${esc(game.title)} (continuación)</h3>`,
        });
      }
    });
  });
  const frame: Frame = (body, index, total) =>
    body + (total > 1 ? `<footer>parte ${index}/${total}</footer>` : '');
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
