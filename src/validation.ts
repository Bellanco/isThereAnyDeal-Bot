import {
  InputError, type Bundle, type BundleEntry, type BundleGame, type BundleTier, type Deal, type Game,
  type NamedId, type Price, type NotificationSummary, type WaitlistGame, type WaitlistNotification,
} from './domain';
import { safeImageUrl } from './rich';

export function isPing(value: unknown): value is 'pong' {
  return value === 'pong';
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Key of a bundle notice in the shared notice tables (ITAD bundle ids are integers). */
export const BUNDLE_KEY = /^bundle:[1-9][0-9]{0,14}$/;

export function bundleKey(id: number): string {
  return `bundle:${id}`;
}

/** Stored notice identifier: an official notification UUID or a `bundle:<id>` key. */
export function isNoticeKey(value: unknown): value is string {
  return typeof value === 'string' && (UUID.test(value) || BUNDLE_KEY.test(value));
}

function invalid(): never {
  throw new InputError('invalid_payload');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || !value.isWellFormed()) invalid();
  return value;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}

function price(value: unknown): Price {
  const item = record(value);
  const amount = number(item.amount);
  const amountInt = number(item.amountInt);
  const currency = text(item.currency);
  if (amount < 0 || !Number.isSafeInteger(amountInt) || amountInt < 0 || !/^[A-Z]{3}$/.test(currency)) invalid();
  return { amount, amountInt, currency };
}

function nullablePrice(value: unknown): Price | null {
  return value === null ? null : price(value);
}

function namedId(value: unknown): NamedId {
  const item = record(value);
  return { id: number(item.id), name: text(item.name) };
}

/**
 * Caps of the legacy webhook mock receiver only (local policy, not ITAD limits).
 * Official notification details have no documented maxima, so none is applied:
 * every game, deal and DRM/platform entry is kept or the whole detail is rejected.
 */
export interface GamesPolicy {
  maxGames: number;
  maxDeals: number;
  maxNamedEntries: number;
}

export const MOCK_RECEIVER_POLICY: Readonly<GamesPolicy> = Object.freeze({
  maxGames: 100, maxDeals: 200, maxNamedEntries: 100,
});

const OFFICIAL_NOTIFICATION_POLICY: Readonly<GamesPolicy> = Object.freeze({
  maxGames: Infinity, maxDeals: Infinity, maxNamedEntries: Infinity,
});

function namedList(value: unknown, maxEntries: number): NamedId[] {
  if (!Array.isArray(value) || value.length > maxEntries) invalid();
  return value.map(namedId);
}

function date(value: unknown): string {
  const result = text(value);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.exec(result);
  if (!parts || !Number.isFinite(Date.parse(result))) invalid();
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0) ||
      Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) invalid();
  return result;
}

function httpUrl(value: unknown): string {
  const url = text(value);
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || /\s/.test(url)) invalid();
  } catch {
    invalid();
  }
  return url;
}

function gameType(value: unknown): Game['type'] {
  if (value !== null && value !== 'game' && value !== 'dlc' && value !== 'package') invalid();
  return value;
}

function deal(value: unknown, policy: Readonly<GamesPolicy>): Deal {
  const item = record(value);
  const cut = number(item.cut);
  if (!Number.isInteger(cut) || cut < 0 || cut > 100) invalid();
  const flag = item.flag;
  if (flag !== null && flag !== 'H' && flag !== 'N' && flag !== 'S') invalid();
  const url = httpUrl(item.url);
  return {
    shop: namedId(item.shop), price: price(item.price), regular: price(item.regular), cut,
    voucher: item.voucher === null ? null : text(item.voucher, true),
    storeLow: nullablePrice(item.storeLow), flag,
    drm: namedList(item.drm, policy.maxNamedEntries), platforms: namedList(item.platforms, policy.maxNamedEntries),
    timestamp: date(item.timestamp), expiry: item.expiry === null ? null : date(item.expiry), url,
  };
}

/** Legacy webhook mock receiver: keeps its explicit local caps. */
export function parseGames(value: unknown): Game[] {
  return games(value, MOCK_RECEIVER_POLICY);
}

function games(value: unknown, policy: Readonly<GamesPolicy>): Game[] {
  if (!Array.isArray(value) || value.length > policy.maxGames) invalid();
  let total = 0;
  return value.map((entry: unknown) => {
    const item = record(entry);
    const id = text(item.id);
    if (!UUID.test(id) || typeof item.mature !== 'boolean') invalid();
    const type = gameType(item.type);
    if (!Array.isArray(item.deals) || (total += item.deals.length) > policy.maxDeals) invalid();
    return {
      id, slug: text(item.slug), title: text(item.title), type, mature: item.mature,
      historyLow: nullablePrice(item.historyLow), lastPrice: nullablePrice(item.lastPrice),
      deals: item.deals.map((entry: unknown) => deal(entry, policy)),
    };
  });
}

function notificationMetadata(item: Record<string, unknown>) {
  const id = text(item.id);
  if (!UUID.test(id)) invalid();
  return {
    id, timestamp: date(item.timestamp),
    read: item.read === null ? null : date(item.read),
  };
}

export function parseNotificationList(value: unknown): NotificationSummary[] {
  if (!Array.isArray(value)) invalid();
  return value.map((entry: unknown) => {
    const item = record(entry);
    if (item.type !== 'waitlist') invalid();
    return { ...notificationMetadata(item), type: 'waitlist', title: text(item.title, true) };
  });
}

export function parseWaitlistNotification(value: unknown): WaitlistNotification {
  const item = record(value);
  return {
    ...notificationMetadata(item),
    // The mock receiver keeps its existing caps; official notices are never cut
    // down to a local subset of games, deals or DRM/platform entries.
    games: games(item.games, OFFICIAL_NOTIFICATION_POLICY),
  };
}

const MAX_BUNDLE_ID = 999_999_999_999_999;
const BANNER_SIZES = ['banner600', 'banner400', 'banner300'] as const;

function bundleGame(value: unknown): BundleGame {
  const item = record(value);
  const id = text(item.id);
  if (!UUID.test(id) || typeof item.mature !== 'boolean') invalid();
  return { id, slug: text(item.slug), title: text(item.title), type: gameType(item.type), mature: item.mature };
}

function bundleTier(value: unknown): BundleTier {
  const item = record(value);
  if (typeof item.addon !== 'boolean' || !Array.isArray(item.games)) invalid();
  return { price: nullablePrice(item.price), addon: item.addon, games: item.games.map(bundleGame) };
}

function bundleBody(item: Record<string, unknown>, id: number): Bundle {
  if (typeof item.isMature !== 'boolean' || !Array.isArray(item.tiers)) invalid();
  return {
    id, title: text(item.title), shop: text(record(item.page).name), url: httpUrl(item.url),
    details: item.details === undefined || item.details === null ? null : httpUrl(item.details),
    note: item.note === undefined || item.note === null ? null : text(item.note, true),
    mature: item.isMature, publish: date(item.publish),
    expiry: item.expiry === undefined || item.expiry === null ? null : date(item.expiry),
    tiers: item.tiers.map(bundleTier),
  };
}

/**
 * One entry per listed bundle. A body that fails validation keeps its id with
 * `bundle: null`, so a single odd bundle never hides the others; only a response
 * that is not a list of objects with usable ids is rejected as a whole.
 */
export function parseBundles(value: unknown): BundleEntry[] {
  if (!Array.isArray(value)) invalid();
  return value.map((entry: unknown) => {
    const item = record(entry);
    const id = item.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > MAX_BUNDLE_ID) invalid();
    try {
      return { id, bundle: bundleBody(item, id) };
    } catch {
      return { id, bundle: null };
    }
  });
}

/** Waitlist games with their best banner; a game without a usable banner keeps `null`. */
export function parseWaitlistGames(value: unknown): WaitlistGame[] {
  if (!Array.isArray(value)) invalid();
  return value.map((entry: unknown) => {
    const item = record(entry);
    const id = text(item.id);
    if (!UUID.test(id)) invalid();
    const assets = typeof item.assets === 'object' && item.assets !== null && !Array.isArray(item.assets)
      ? item.assets as Record<string, unknown> : {};
    let banner: string | null = null;
    for (const size of BANNER_SIZES) {
      banner = safeImageUrl(assets[size]);
      if (banner !== null) break;
    }
    return { id: id.toLowerCase(), banner };
  });
}

/** Game ids only (Collection): every other field is ignored. */
export function parseGameIds(value: unknown): string[] {
  if (!Array.isArray(value)) invalid();
  return value.map((entry: unknown) => {
    const id = text(record(entry).id);
    if (!UUID.test(id)) invalid();
    return id.toLowerCase();
  });
}