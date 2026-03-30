import { CartItem, OrderItem, Pricing } from '../types';

const DEFAULT_TAX_RATE = 0.08;

export function getTaxRate(): number {
  const envRate = process.env.TAX_RATE;
  if (envRate !== undefined) {
    const parsed = parseFloat(envRate);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_TAX_RATE;
}

export function calculateLineTotal(item: CartItem): number {
  return item.quantity * item.unitPrice;
}

export function calculatePricing(items: CartItem[]): { orderItems: OrderItem[]; pricing: Pricing } {
  const taxRate = getTaxRate();

  const orderItems: OrderItem[] = items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: calculateLineTotal(item),
  }));

  const subtotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxAmount = Math.floor(subtotal * taxRate);
  const total = subtotal + taxAmount;

  return {
    orderItems,
    pricing: {
      subtotal,
      taxRate,
      taxAmount,
      total,
    },
  };
}
