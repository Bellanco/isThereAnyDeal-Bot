import { InputError } from './domain';
import { notify } from './notify';
import { DeliveryError, type Delivery, type DeliveryStore } from './ports';
import { isPing, parseGames, UUID } from './validation';

export const MAX_BODY_BYTES = 256 * 1024;

async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new InputError('body_too_large');
  }
  if (!request.body) throw new InputError('invalid_json');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InputError('body_too_large');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new InputError('invalid_json');
  }
}

export function createReceiver(config: { key: string; chat: string }, delivery: Delivery, store: DeliveryStore) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== '/webhooks/itad') return Response.json({ error: 'not_found' }, { status: 404 });
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });
    if (request.headers.get('x-mock-receiver-key') !== config.key) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      return Response.json({ error: 'unsupported_media_type' }, { status: 415 });
    }
    const hook = request.headers.get('itad-hook-id');
    const event = request.headers.get('itad-event');
    if (!hook || !UUID.test(hook) || !['ping', 'notification-waitlist'].includes(event ?? '') ||
        request.headers.get('user-agent') !== 'ITAD-Webhooks/1.0 (+https://isthereanydeal.com)') {
      return Response.json({ error: 'invalid_headers' }, { status: 400 });
    }
    try {
      const body = await readJson(request);
      if (event === 'ping') {
        if (!isPing(body)) throw new InputError('invalid_ping');
        return Response.json({ mode: 'mock', pong: true });
      }
      const result = await notify(parseGames(body), hook, config.chat, delivery, store);
      return Response.json({ mode: 'mock', ...result });
    } catch (error) {
      if (error instanceof InputError) {
        return Response.json({ error: error.message }, { status: error.message === 'body_too_large' ? 413 : 400 });
      }
      const retryAfter = error instanceof DeliveryError ? error.retryAfter : undefined;
      return Response.json({ error: 'delivery_unconfirmed', mode: 'mock' }, {
        status: 503, headers: retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) },
      });
    }
  };
}