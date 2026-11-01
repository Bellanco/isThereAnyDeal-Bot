/** Required injection: importing these modules never enables network access. */
export type HttpTransport = (request: Request) => Promise<Response>;
export const HTTP_TIMEOUT_MS = 10_000;

export type ServiceErrorCategory =
  | 'configuration' | 'input' | 'timeout' | 'network' | 'http'
  | 'rate_limit' | 'json' | 'shape' | 'oauth' | 'state'
  | 'expired' | 'authorization_required';

const OAUTH_ERRORS = [
  'invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client',
  'unsupported_grant_type', 'invalid_scope', 'access_denied',
  'unsupported_response_type', 'server_error', 'temporarily_unavailable',
] as const;
export type OAuthErrorCode = typeof OAUTH_ERRORS[number];

export function oauthErrorCode(value: unknown): OAuthErrorCode | undefined {
  return OAUTH_ERRORS.find(code => code === value);
}

/** No external message, body, URL, credentials or cause is retained. */
export class ServiceError extends Error {
  constructor(
    readonly category: ServiceErrorCategory,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
    readonly oauthCode?: OAuthErrorCode,
  ) {
    super(category);
    this.name = 'ServiceError';
  }
}

function retryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  // HTTP-date, not arbitrary Date.parse inputs.
  if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - now) / 1000)) : undefined;
}

export class JsonHttpClient {
  #transport: HttpTransport;
  #now: () => number;

  constructor(transport: HttpTransport, now: () => number = Date.now) {
    this.#transport = transport;
    this.#now = now;
  }

  /** `maxChars` skips parsing of a body larger than a caller can afford (CPU budget). */
  async request(url: string, init: RequestInit, oauth = false, maxChars = Infinity): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ServiceError('timeout'));
        controller.abort();
      }, HTTP_TIMEOUT_MS);
    });
    const work = async (): Promise<unknown> => {
      let response: Response;
      try {
        // workerd rejects redirect 'error'; 'manual' + explicit rejection below never follows a redirect.
        response = await this.#transport(new Request(url, {
          ...init, signal: controller.signal, redirect: 'manual', cache: 'no-store',
        }));
      } catch {
        throw new ServiceError(controller.signal.aborted ? 'timeout' : 'network');
      }
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new ServiceError('http', response.status);
      }
      const retry = retryAfter(response.headers.get('Retry-After'), this.#now());
      if (response.status === 429) throw new ServiceError('rate_limit', 429, retry);
      // API errors are classified by status; do not expose reason_phrase.
      if (!response.ok && !oauth) throw new ServiceError('http', response.status, retry);
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new ServiceError(controller.signal.aborted ? 'timeout' : 'network', response.status);
      }
      if (text.length > maxChars) throw new ServiceError('shape', response.status);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ServiceError('json', response.status);
      }
      if (oauth && typeof body === 'object' && body !== null && !Array.isArray(body) && 'error' in body) {
        if (typeof body.error !== 'string' || !body.error) throw new ServiceError('shape', response.status);
        throw new ServiceError('oauth', response.status, retry, oauthErrorCode(body.error));
      }
      if (!response.ok) throw new ServiceError('http', response.status, retry);
      return body;
    };
    try {
      return await Promise.race([work(), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }
}

export function bearer(value: unknown, category: 'input' | 'shape' = 'input'): string {
  // RFC 6750; no fixed length or decoding of ITAD's variable-length JWT.
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(value)) {
    throw new ServiceError(category);
  }
  return value;
}
