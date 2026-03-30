import { createHash } from 'crypto';
import { CartItem } from '../types';

export function computePayloadHash(items: CartItem[], paymentMethodId: string): string {
  const canonical = JSON.stringify({
    items: items
      .map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
    paymentMethodId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
