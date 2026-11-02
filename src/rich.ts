import { InputError, type Price } from './domain';

/** Hard limit of Telegram rich messages: 32768 UTF-8 characters of text. */
export const MAX_RICH_BYTES = 32_768;

/**
 * Per-part budget kept below the documented limits (32768 UTF-8 characters, 500
 * blocks, 50 media) because HTML markup and URLs are counted as text and the block
 * count below is a conservative estimate. Nothing is ever dropped to fit: the
 * content is split between parts instead.
 */
export const RICH_BUDGET = Object.freeze({ bytes: 30_000, blocks: 400, images: 40 });

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

/** Plain https image URL that is safe inside an HTML attribute; anything else is not shown. */
export function safeImageUrl(value: unknown): string | null {
  return typeof value === 'string' && value.isWellFormed() &&
    value.length <= 2048 && /^https:\/\/[^\s"<>]+$/.test(value) ? value : null;
}

/** Text content: only & < > are significant. */
export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Double-quoted attribute value. */
export function attr(value: string): string {
  return esc(value).replace(/"/g, '&quot;');
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Spanish price format; the currency and amount come from ITAD unchanged. */
export function money(price: Price): string {
  try {
    let formatter = formatters.get(price.currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: price.currency });
      formatters.set(price.currency, formatter);
    }
    return formatter.format(price.amount);
  } catch {
    return `${price.amount} ${price.currency}`;
  }
}

const madridDateFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  day: 'numeric',
  month: 'long',
});

/** Fixed visible date for mainland Spain and the Balearic Islands, independent of the reader. */
export function when(iso: string): string {
  return madridDateFormatter.format(new Date(Date.parse(iso)));
}

/** Native Rich footer, not CSS font sizing. Telegram determines its rendering. */
export function expiryFooter(iso: string | null): string {
  return iso === null ? '' : `<footer>Hasta el ${when(iso)}</footer>`;
}

/** ITAD page of a game; the slug comes from the official payload. */
export function gameUrl(slug: string): string {
  return `https://isthereanydeal.com/game/${encodeURIComponent(slug)}/`;
}

/** Documented URL-button styles; Telegram chooses theme-specific colors. */
export type ButtonStyle = 'primary' | 'success';

/** Row of URL buttons. URLs are never rewritten; callers choose one button per row. */
export function buttonRow(buttons: readonly { label: string; url: string; style?: ButtonStyle }[]): string {
  if (buttons.length === 0) return '';
  const items = buttons.map(button =>
    `<tg-button type="url"${button.style ? ` style="${button.style}"` : ''} url="${attr(button.url)}">${esc(button.label)}</tg-button>`);
  return `<tg-button-row>${items.join('')}</tg-button-row>`;
}

const BLOCK = /<(?:h[1-6]|p|ul|ol|li|hr|img|figure|figcaption|blockquote|aside|footer|pre|details|summary|table|tr|td|th|tg-button-row|tg-button)[\s>/]/g;

/** Conservative block estimate: every block-level tag, button and image counts once. */
export function countBlocks(html: string): number {
  return html.match(BLOCK)?.length ?? 0;
}

export function countImages(html: string): number {
  return html.match(/<img[\s/>]/g)?.length ?? 0;
}

/** Banner-less fallback for a message Telegram refused because of an image. */
export function stripImages(html: string): string {
  return html.replace(/<img\b[^>]*\/>(?:<footer>Imagen de juego: [^<]*<\/footer>)?/g, '');
}

/**
 * Indivisible piece of a message. `joiner` goes before it when it follows another
 * unit in the same part (a separator); `opener` goes before it when it starts a
 * later part (so a game or tier split across parts is introduced again).
 */
export interface Unit {
  html: string;
  joiner?: string;
  opener?: string;
}

interface Size {
  bytes: number;
  blocks: number;
  images: number;
}

const EMPTY: Size = { bytes: 0, blocks: 0, images: 0 };

function size(html: string): Size {
  return { bytes: utf8Length(html), blocks: countBlocks(html), images: countImages(html) };
}

function add(a: Size, b: Size): Size {
  return { bytes: a.bytes + b.bytes, blocks: a.blocks + b.blocks, images: a.images + b.images };
}

function fits(used: Size, room: Size): boolean {
  return used.bytes <= room.bytes && used.blocks <= room.blocks && used.images <= room.images;
}

export type Frame = (body: string, index: number, total: number) => string;

/**
 * Greedy packing of whole units into as few parts as the budget allows. `frame`
 * wraps each body with the header/footer, which carry the "part i/n" counter; its
 * size is reserved for the widest counter and the packing is repeated if the part
 * count gains a digit. A unit that cannot fit alone is rejected, never cut.
 */
export function pack(units: readonly Unit[], frame: Frame): string[] {
  if (units.length === 0) return [frame('', 1, 1)];
  const own = units.map(unit => size(unit.html));
  const joined = units.map(unit => size(unit.joiner ?? ''));
  const opened = units.map(unit => size(unit.opener ?? ''));
  for (let digits = 1; digits <= 6; digits++) {
    const widest = Number('9'.repeat(digits));
    const overhead = size(frame('', widest, widest));
    const room: Size = {
      bytes: RICH_BUDGET.bytes - overhead.bytes,
      blocks: RICH_BUDGET.blocks - overhead.blocks,
      images: RICH_BUDGET.images - overhead.images,
    };
    const bodies: string[] = [];
    let current = '';
    let used = EMPTY;
    let count = 0;
    for (let index = 0; index < units.length; index++) {
      const unit = units[index]!;
      if (count > 0) {
        const cost = add(used, add(own[index]!, joined[index]!));
        if (fits(cost, room)) {
          current += (unit.joiner ?? '') + unit.html;
          used = cost;
          count++;
          continue;
        }
        bodies.push(current);
      }
      // The very first unit already carries its own title: no opener.
      const lead = index > 0 ? opened[index]! : EMPTY;
      const cost = add(own[index]!, lead);
      if (!fits(cost, room)) throw new InputError('rich_too_large');
      current = (index > 0 ? unit.opener ?? '' : '') + unit.html;
      used = cost;
      count = 1;
    }
    bodies.push(current);
    if (String(bodies.length).length <= digits) {
      return bodies.map((body, index) => frame(body, index + 1, bodies.length));
    }
  }
  throw new InputError('rich_too_large');
}

/** "parte i/n" marker; empty for a single-part message. */
export function partLabel(index: number, total: number): string {
  return total > 1 ? ` · parte ${index}/${total}` : '';
}
