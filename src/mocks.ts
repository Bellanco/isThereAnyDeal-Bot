import { MAX_TEXT } from './domain';
import { DeliveryError, type Delivery, type DeliveryStore, type Message } from './ports';

export class MemoryStore implements DeliveryStore {
  private readonly entries = new Map<string, number | 'pending'>();

  constructor(private readonly capacity = 10_000) {}

  async claim(key: string): Promise<'claimed' | 'confirmed' | 'busy'> {
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing === 'pending' ? 'busy' : 'confirmed';
    if (this.entries.size >= this.capacity) throw new DeliveryError('storage_full');
    this.entries.set(key, 'pending');
    return 'claimed';
  }

  async confirm(key: string, messageId: number): Promise<void> {
    if (this.entries.get(key) !== 'pending') throw new DeliveryError('invalid_claim');
    this.entries.set(key, messageId);
  }

  async release(key: string): Promise<void> {
    if (this.entries.get(key) === 'pending') this.entries.delete(key);
  }
}

export const FAILURES = ['none', 'network', 'http', 'rejected', 'rate-limit', 'invalid-response'] as const;
export type MockFailure = typeof FAILURES[number];

export class MockDelivery implements Delivery {
  private calls = 0;

  constructor(private readonly failure: MockFailure = 'none', private readonly failAt = 1) {}

  async send(message: Message): Promise<{ message_id: number }> {
    if (!message.chat_id.startsWith('mock:') || !message.text || message.text.length > MAX_TEXT) {
      throw new DeliveryError('invalid_message');
    }
    this.calls += 1;
    if (this.calls === this.failAt && this.failure !== 'none') {
      throw new DeliveryError(this.failure, this.failure === 'rate-limit' ? 2 : undefined);
    }
    return { message_id: this.calls };
  }
}