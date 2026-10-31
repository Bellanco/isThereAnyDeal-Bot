import { formatDeal, InputError, type Game } from './domain';
import { DeliveryError, type Delivery, type DeliveryStore, type Message } from './ports';

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function notify(
  games: Game[], hook: string, chat: string, delivery: Delivery, store: DeliveryStore,
): Promise<{ sent: number; skipped: number }> {
  const plan: { identity: string; message: Message }[] = [];
  for (const game of games) {
    for (const deal of game.deals) {
      const texts = formatDeal(game, deal);
      if (plan.length + texts.length > 500) throw new InputError('too_many_messages');
      const identity = await digest(JSON.stringify([
        hook.toLowerCase(), game.id.toLowerCase(), deal.shop.id, deal.timestamp, deal.url, chat, texts,
      ]));
      texts.forEach((text, index) => {
        plan.push({
          identity: JSON.stringify([identity, index]),
          message: { chat_id: chat, text },
        });
      });
    }
  }
  let sent = 0;
  let skipped = 0;
  for (const item of plan) {
    const key = await digest(item.identity);
    const claim = await store.claim(key);
    if (claim === 'confirmed') {
      skipped += 1;
      continue;
    }
    if (claim === 'busy') throw new DeliveryError('delivery_busy', 1);
    try {
      const receipt = await delivery.send(item.message);
      if (!Number.isSafeInteger(receipt.message_id) || receipt.message_id <= 0) throw new DeliveryError('invalid_response');
      await store.confirm(key, receipt.message_id);
      sent += 1;
    } catch (error) {
      await store.release(key);
      throw error;
    }
  }
  return { sent, skipped };
}