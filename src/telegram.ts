import { MAX_TEXT } from './domain';
import { HTTP_TIMEOUT_MS, type HttpTransport } from './itad-http';

/**
 * rate_limit: retry after parameters.retry_after; transient: retry with backoff
 * (duplicates possible if Telegram accepted it); rejected: this message is refused;
 * destination: bot/chat configuration problem, halt all delivery; unverified: Telegram
 * may have accepted it but the receipt cannot be validated, never retried automatically.
 */
export type TelegramFailure = 'rate_limit' | 'transient' | 'rejected' | 'destination' | 'unverified' | 'input';

export type TelegramReason =
  | 'flood' | 'timeout' | 'network' | 'http_5xx' | 'http_4xx' | 'bad_request' | 'unauthorized'
  | 'forbidden' | 'not_found' | 'migrated' | 'json' | 'shape' | 'message_id' | 'chat_mismatch'
  | 'not_private' | 'text' | 'redirect';

/** Category and reason only: never URL, token, chat, text or Telegram description. */
export class TelegramError extends Error {
  constructor(
    readonly category: TelegramFailure,
    readonly reason: TelegramReason,
    readonly retryAfterSeconds?: number,
    readonly status?: number,
  ) {
    super(`${category}:${reason}`);
    this.name = 'TelegramError';
  }
}

export class TelegramConfigurationError extends Error {
  constructor() {
    super('telegram_configuration');
    this.name = 'TelegramConfigurationError';
  }
}

export interface TelegramReceipt {
  messageId: number;
}

/** Fallback only when a 429 lacks parameters.retry_after; not an official value. */
export const RATE_LIMIT_FALLBACK_SECONDS = 30;
const BOT_TOKEN = /^\d{1,20}:[A-Za-z0-9_-]{20,128}$/;

/** Private chats only (positive IDs); group/channel destinations are deliberately unsupported. */
export function parsePrivateChatId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value)) throw new TelegramConfigurationError();
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2 ** 52) throw new TelegramConfigurationError();
  return id;
}

export function validBotToken(value: unknown): value is string {
  return typeof value === 'string' && BOT_TOKEN.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export class TelegramClient {
  #transport: HttpTransport;
  #token: string;
  #chatId: number;

  constructor(transport: HttpTransport, token: string, chatId: number) {
    if (typeof transport !== 'function' || !validBotToken(token) ||
        !Number.isSafeInteger(chatId) || chatId < 1) throw new TelegramConfigurationError();
    this.#transport = transport;
    this.#token = token;
    this.#chatId = chatId;
  }

  /** Plain text to the configured chat only; no parse_mode, entities or chat migration. */
  async send(text: string): Promise<TelegramReceipt> {
    if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TEXT || !text.isWellFormed()) {
      throw new TelegramError('input', 'text');
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TelegramError('transient', 'timeout'));
        controller.abort();
      }, HTTP_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.#send(text, controller.signal), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }

  async #send(text: string, signal: AbortSignal): Promise<TelegramReceipt> {
    let response: Response;
    try {
      response = await this.#transport(new Request(`https://api.telegram.org/bot${this.#token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ chat_id: this.#chatId, text }),
        // workerd rejects redirect 'error'; 'manual' + explicit rejection below never follows a redirect.
        signal, redirect: 'manual', cache: 'no-store',
      }));
    } catch {
      throw new TelegramError('transient', signal.aborted ? 'timeout' : 'network');
    }
    const status = response.status;
    if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
      throw new TelegramError('rejected', 'redirect', undefined, status);
    }
    let body: Record<string, unknown> | null;
    try {
      body = record(JSON.parse(await response.text()));
    } catch {
      body = null;
      if (signal.aborted) throw new TelegramError('transient', 'timeout', undefined, status);
      if (response.ok) throw new TelegramError('unverified', 'json', undefined, status);
    }
    if (body?.ok === true) {
      if (!response.ok) throw new TelegramError('unverified', 'shape', undefined, status);
      return this.#receipt(body.result, status);
    }
    if (body !== null && body.ok !== false && response.ok) throw new TelegramError('unverified', 'shape', undefined, status);
    const parameters = record(body?.parameters);
    if (parameters && 'migrate_to_chat_id' in parameters) {
      // Never follow automatically: the configured destination stays fixed.
      throw new TelegramError('destination', 'migrated', undefined, status);
    }
    const errorCode = typeof body?.error_code === 'number' ? body.error_code : undefined;
    if (status === 429 || errorCode === 429) {
      const retry = parameters?.retry_after;
      const seconds = typeof retry === 'number' && Number.isSafeInteger(retry) && retry >= 0 && retry <= 86_400
        ? retry : RATE_LIMIT_FALLBACK_SECONDS;
      throw new TelegramError('rate_limit', 'flood', seconds, status);
    }
    if (status >= 500) throw new TelegramError('transient', 'http_5xx', undefined, status);
    if (status === 401) throw new TelegramError('destination', 'unauthorized', undefined, status);
    if (status === 403) throw new TelegramError('destination', 'forbidden', undefined, status);
    if (status === 404) throw new TelegramError('destination', 'not_found', undefined, status);
    if (status === 400) throw new TelegramError('rejected', 'bad_request', undefined, status);
    if (response.ok) throw new TelegramError('rejected', 'shape', undefined, status);
    throw new TelegramError('rejected', 'http_4xx', undefined, status);
  }

  #receipt(value: unknown, status: number): TelegramReceipt {
    const message = record(value);
    const chat = record(message?.chat);
    const messageId = message?.message_id;
    // message_id 0 means ephemeral/scheduled per Bot API: not a usable confirmation.
    if (typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId < 1) {
      throw new TelegramError('unverified', 'message_id', undefined, status);
    }
    if (!chat || chat.id !== this.#chatId) throw new TelegramError('unverified', 'chat_mismatch', undefined, status);
    if (chat.type !== 'private') throw new TelegramError('unverified', 'not_private', undefined, status);
    return { messageId };
  }
}
