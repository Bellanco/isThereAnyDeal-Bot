import type { NotificationSummary, WaitlistNotification } from './domain';
import { bearer, JsonHttpClient, ServiceError, type HttpTransport } from './itad-http';
import { parseNotificationList, parseWaitlistNotification, UUID } from './validation';

export class ItadClient {
  #http: JsonHttpClient;

  constructor(transport: HttpTransport) {
    this.#http = new JsonHttpClient(transport);
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

  #get(path: string, accessToken: string): Promise<unknown> {
    return this.#http.request(`https://api.isthereanydeal.com${path}`, {
      method: 'GET', headers: { Authorization: `Bearer ${bearer(accessToken)}`, Accept: 'application/json' },
    });
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
