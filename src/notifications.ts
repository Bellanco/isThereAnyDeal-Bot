import { InputError, MAX_TEXT, type Price, type WaitlistNotification } from './domain';
import { parseWaitlistNotification } from './validation';

interface Segment {
  text: string;
  atomic: boolean;
}

function priceText(price: Price): string {
  return `${price.amount} ${price.currency}`;
}

function segments(notification: WaitlistNotification): Segment[] {
  const result: Segment[] = [];
  function line(text: string, atomic = false) {
    if (result.length) result.push({ text: '\n', atomic: false });
    result.push({ text, atomic });
  }
  line(`Fecha del aviso: ${notification.timestamp}`);
  line(`Leido en ITAD: ${notification.read ?? 'no'}`);
  notification.games.forEach((game, gameIndex) => {
    line('');
    line(`Juego ${gameIndex + 1}: ${game.title}`);
    if (game.type !== null) line(`Tipo: ${game.type}`);
    if (game.mature) line('Contenido para adultos');
    if (game.historyLow !== null) line(`Minimo historico: ${priceText(game.historyLow)}`);
    if (game.lastPrice !== null) line(`Precio anterior: ${priceText(game.lastPrice)}`);
    game.deals.forEach((deal, dealIndex) => {
      line(`Oferta ${gameIndex + 1}.${dealIndex + 1}: ${deal.shop.name}`);
      line(`Precio: ${priceText(deal.price)} (-${deal.cut}%)`);
      line(`Precio habitual: ${priceText(deal.regular)}`);
      if (deal.storeLow !== null) line(`Minimo en tienda: ${priceText(deal.storeLow)}`);
      if (deal.voucher !== null) line(`Cupon: ${deal.voucher}`);
      if (deal.expiry !== null) line(`Caduca: ${deal.expiry}`);
      if (deal.drm.length) line(`DRM: ${deal.drm.map(item => item.name).join(', ')}`);
      if (deal.platforms.length) line(`Plataformas: ${deal.platforms.map(item => item.name).join(', ')}`);
      if (deal.flag !== null) line(`Indicador ITAD: ${deal.flag}`);
      line(`Fecha de oferta: ${deal.timestamp}`);
      line(deal.url, true);
    });
  });
  return result;
}

function split(segments: Segment[], capacity: number): string[] {
  const parts: string[] = [];
  let current = '';
  function append(text: string) {
    if (current.length + text.length > capacity) {
      parts.push(current);
      current = '';
    }
    current += text;
  }
  for (const segment of segments) {
    if (segment.atomic) {
      if (segment.text.length > capacity) throw new InputError('link_too_long');
      append(segment.text);
    } else {
      // Iteration by code point preserves surrogate pairs, including at a boundary.
      for (const character of segment.text) append(character);
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Plain text, one official notice only. No delivery, filters or URL rewriting. */
export function formatNotification(notification: WaitlistNotification): string[] {
  // Also protect callers passing unvalidated runtime data through typed interfaces.
  const valid = parseWaitlistNotification(notification);
  const content = segments(valid);
  const header = `Aviso ITAD ${valid.id}`;
  const body = content.map(segment => segment.text).join('');
  if (header.length + 1 + body.length <= MAX_TEXT) return [`${header}\n${body}`];

  // Reserve enough space for both counters. Re-split if the count gains a digit.
  let digits = 1;
  for (;;) {
    const capacity = MAX_TEXT - `${header} · parte ${'9'.repeat(digits)}/${'9'.repeat(digits)}\n`.length;
    const parts = split(content, capacity);
    const requiredDigits = String(parts.length).length;
    if (requiredDigits > digits) {
      digits = requiredDigits;
      continue;
    }
    return parts.map((part, index) => `${header} · parte ${index + 1}/${parts.length}\n${part}`);
  }
}

export interface FormattedNotification {
  notification: WaitlistNotification;
  parts: string[];
}

/** Complete validation/formatting before a future caller starts any delivery. */
export function prepareNotificationBatch(value: unknown): FormattedNotification[] {
  if (!Array.isArray(value)) throw new InputError('invalid_payload');
  const notifications = value.map((entry: unknown) => parseWaitlistNotification(entry));
  return notifications.map(notification => ({ notification, parts: formatNotification(notification) }));
}
