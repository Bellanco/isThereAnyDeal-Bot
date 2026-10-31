export interface Message {
  chat_id: string;
  text: string;
}

export interface Delivery {
  send(message: Message): Promise<{ message_id: number }>;
}

export interface DeliveryStore {
  claim(key: string): Promise<'claimed' | 'confirmed' | 'busy'>;
  confirm(key: string, messageId: number): Promise<void>;
  release(key: string): Promise<void>;
}

export class DeliveryError extends Error {
  constructor(public readonly kind: string, public readonly retryAfter: number | undefined = undefined) {
    super(kind);
  }
}