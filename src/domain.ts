export interface Price {
  amount: number;
  amountInt: number;
  currency: string;
}

export interface NamedId {
  id: number;
  name: string;
}

export interface Deal {
  shop: NamedId;
  price: Price;
  regular: Price;
  cut: number;
  voucher: string | null;
  storeLow: Price | null;
  flag: 'H' | 'N' | 'S' | null;
  drm: NamedId[];
  platforms: NamedId[];
  timestamp: string;
  expiry: string | null;
  url: string;
}

export interface Game {
  id: string;
  slug: string;
  title: string;
  type: 'game' | 'dlc' | 'package' | null;
  mature: boolean;
  historyLow: Price | null;
  lastPrice: Price | null;
  deals: Deal[];
}

export interface NotificationSummary {
  id: string;
  type: 'waitlist';
  title: string;
  timestamp: string;
  read: string | null;
}

export interface WaitlistNotification {
  id: string;
  timestamp: string;
  read: string | null;
  games: Game[];
}

export class InputError extends Error {}

export const MAX_TEXT = 4096;

export function formatDeal(game: Game, deal: Deal): string[] {
  if (deal.url.length > MAX_TEXT) throw new InputError('link_too_long');
  const lines = [
    game.title,
    deal.shop.name,
    `${deal.price.amount} ${deal.price.currency} (-${deal.cut}%)`,
    ...(deal.voucher === null ? [] : [`Cupon: ${deal.voucher}`]),
    ...(deal.expiry === null ? [] : [`Caduca: ${deal.expiry}`]),
  ];
  const messages: string[] = [];
  let current = '';
  for (const line of lines) {
    for (const character of `${current ? '\n' : ''}${line}`) {
      if (current.length + character.length > MAX_TEXT) {
        messages.push(current);
        current = '';
      }
      current += character;
    }
  }
  if (current.length + 1 + deal.url.length > MAX_TEXT) {
    messages.push(current);
    current = '';
  }
  current += `${current ? '\n' : ''}${deal.url}`;
  messages.push(current);
  return messages;
}