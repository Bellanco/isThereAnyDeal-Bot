import type { BundleEntry, NotificationSummary, WaitlistGame, WaitlistNotification } from './domain';
import { bearer, JsonHttpClient, ServiceError, type HttpTransport } from './itad-http';
import {
  parseBundles, parseGameIds, parseNotificationList, parseWaitlistGames, parseWaitlistNotification, UUID,
} from './validation';

/** Bundle query decided with the user: Spanish store prices, adult bundles included. */
const BUNDLE_QUERY = 'country=ES&mature=true';
export const MAX_BUNDLE_PAGE = 50;
/** Larger Waitlist/Collection bodies are not parsed: their marks and banners are optional. */
const MAX_WAITLIST_CHARS = 3_000_000;
const MAX_COLLECTION_CHARS = 1_500_000;
const API_KEY = /^[\x21-\x7e]{8,256}$/;

export interface ItadClientOptions {
  /** Application API key for key-authenticated endpoints (bundles); optional. */
  apiKey?: string;
}

export class ItadClient {
  #http: JsonHttpClient;
  #apiKey: string | undefined;

  constructor(transport: HttpTransport, options: ItadClientOptions = {}) {
    if (options.apiKey !== undefined && !API_KEY.test(options.apiKey)) throw new ServiceError('configuration');
    this.#http = new JsonHttpClient(transport);
    this.#apiKey = options.apiKey;
  }

  async list(accessToken: string): Promise<NotificationSummary[]> {
    const body = await this.#get('/notifications/v1', accessToken);
    return this.#parse(() => parseNotificationList(body));
  }

  async waitlist(id: string, accessToken: string): Promise<WaitlistNotification> {
    if (!UUID.test(id)) throw new ServiceError('input');
    const body = await this.#get(`/notifications/waitlist/v1?id=${encodeURIComponent(id)}`, accessToken);
    const detail = this.#parse(() => parseWaitlistNotification(body));
    if (detail.id.toLowerCase() !== id.toLowerCase()) throw new ServiceError('shape');
    return detail;
  }

  /** Games of the user's Waitlist with their best banner (OAuth `wait_read`). */
  async waitlistGames(accessToken: string): Promise<WaitlistGame[]> {
    const body = await this.#get('/waitlist/games/v1', accessToken, MAX_WAITLIST_CHARS);
    return this.#parse(() => parseWaitlistGames(body));
  }

  /** Ids of the user's Collection games (OAuth `coll_read`). */
  async collectionGameIds(accessToken: string): Promise<string[]> {
    const body = await this.#get('/collection/games/v1', accessToken, MAX_COLLECTION_CHARS);
    return this.#parse(() => parseGameIds(body));
  }

  /** One page of active bundles, newest first (application API key, no OAuth). */
  async bundles(offset: number, limit: number): Promise<BundleEntry[]> {
    if (this.#apiKey === undefined) throw new ServiceError('configuration');
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BUNDLE_PAGE) throw new ServiceError('input');
    const body = await this.#http.request(
      `https://api.isthereanydeal.com/bundles/v1?${BUNDLE_QUERY}&offset=${offset}&limit=${limit}`,
      { method: 'GET', headers: { 'ITAD-API-Key': this.#apiKey, Accept: 'application/json' } },
    );
    return this.#parse(() => parseBundles(body));
  }

  #get(path: string, accessToken: string, maxChars?: number): Promise<unknown> {
    return this.#http.request(`https://api.isthereanydeal.com${path}`, {
      method: 'GET', headers: { Authorization: `Bearer ${bearer(accessToken)}`, Accept: 'application/json' },
    }, false, maxChars);
  }

  #parse<T>(parse: () => T): T {
    try {
      return parse();
    } catch {
      // Do not propagate parser errors with external data.
      throw new ServiceError('shape');
    }
  }
}
