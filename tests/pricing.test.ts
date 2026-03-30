import { calculatePricing, getTaxRate } from '../src/services/pricingService';

describe('pricingService', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getTaxRate', () => {
    it('returns default 0.08 when TAX_RATE env is not set', () => {
      delete process.env.TAX_RATE;
      expect(getTaxRate()).toBe(0.08);
    });

    it('returns configured rate from TAX_RATE env', () => {
      process.env = { ...originalEnv, TAX_RATE: '0.10' };
      expect(getTaxRate()).toBe(0.10);
    });

    it('falls back to default for invalid TAX_RATE', () => {
      process.env = { ...originalEnv, TAX_RATE: 'abc' };
      expect(getTaxRate()).toBe(0.08);
    });
  });

  describe('calculatePricing', () => {
    // AC-2: Server-side price calculation
    it('calculates line totals, subtotal, tax, and total correctly', () => {
      const items = [
        { productId: 'prod_1', quantity: 2, unitPrice: 1000 },
        { productId: 'prod_2', quantity: 1, unitPrice: 500 },
      ];

      const { orderItems, pricing } = calculatePricing(items);

      expect(orderItems[0].lineTotal).toBe(2000); // 2 × 1000
      expect(orderItems[1].lineTotal).toBe(500);  // 1 × 500
      expect(pricing.subtotal).toBe(2500);
      expect(pricing.taxRate).toBe(0.08);
      expect(pricing.taxAmount).toBe(200); // floor(2500 × 0.08)
      expect(pricing.total).toBe(2700);
    });

    it('uses Math.floor for tax to avoid overcharging', () => {
      // 999 × 0.08 = 79.92 → floor → 79
      const items = [{ productId: 'prod_1', quantity: 1, unitPrice: 999 }];
      const { pricing } = calculatePricing(items);

      expect(pricing.taxAmount).toBe(79);
      expect(pricing.total).toBe(1078);
    });

    it('handles single item', () => {
      const items = [{ productId: 'prod_1', quantity: 1, unitPrice: 5000 }];
      const { orderItems, pricing } = calculatePricing(items);

      expect(orderItems).toHaveLength(1);
      expect(orderItems[0].lineTotal).toBe(5000);
      expect(pricing.subtotal).toBe(5000);
      expect(pricing.taxAmount).toBe(400); // floor(5000 × 0.08)
      expect(pricing.total).toBe(5400);
    });

    it('handles zero-priced items', () => {
      const items = [{ productId: 'prod_free', quantity: 3, unitPrice: 0 }];
      const { pricing } = calculatePricing(items);

      expect(pricing.subtotal).toBe(0);
      expect(pricing.taxAmount).toBe(0);
      expect(pricing.total).toBe(0);
    });

    it('preserves product details in order items', () => {
      const items = [{ productId: 'prod_abc', quantity: 5, unitPrice: 250 }];
      const { orderItems } = calculatePricing(items);

      expect(orderItems[0]).toEqual({
        productId: 'prod_abc',
        quantity: 5,
        unitPrice: 250,
        lineTotal: 1250,
      });
    });
  });
});
