import { processCheckout } from '../src/services/checkoutService';
import * as orderService from '../src/services/orderService';
import { PaymentProvider, Order } from '../src/types';
import { computePayloadHash } from '../src/utils/hash';
import { CheckoutError } from '../src/errors';

// Mock orderService
jest.mock('../src/services/orderService');
const mockGetOrder = orderService.getOrderByCartId as jest.MockedFunction<typeof orderService.getOrderByCartId>;
const mockCreateOrder = orderService.createOrder as jest.MockedFunction<typeof orderService.createOrder>;
const mockUpdateStatus = orderService.updateOrderStatus as jest.MockedFunction<typeof orderService.updateOrderStatus>;

// Mock logger to keep test output clean
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLogContext: jest.fn(),
}));

const successPaymentProvider: PaymentProvider = {
  capturePayment: jest.fn().mockResolvedValue({
    success: true,
    transactionId: 'txn_test_123',
  }),
};

const failedPaymentProvider: PaymentProvider = {
  capturePayment: jest.fn().mockResolvedValue({
    success: false,
    errorCode: 'insufficient_funds',
    errorMessage: 'The card has insufficient funds',
  }),
};

const validRequest = {
  cartId: '550e8400-e29b-41d4-a716-446655440000',
  items: [{ productId: 'prod_1', quantity: 2, unitPrice: 1000 }],
  paymentMethodId: 'pm_success_123',
};

function buildExistingOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: 'ord_existing',
    cartId: validRequest.cartId,
    status: 'COMPLETED',
    items: [{ productId: 'prod_1', quantity: 2, unitPrice: 1000, lineTotal: 2000 }],
    pricing: { subtotal: 2000, taxRate: 0.08, taxAmount: 160, total: 2160 },
    currency: 'USD',
    paymentMethodId: validRequest.paymentMethodId,
    payloadHash: computePayloadHash(validRequest.items, validRequest.paymentMethodId),
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    ttl: 1735689600,
    ...overrides,
  };
}

describe('checkoutService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrder.mockResolvedValue(null);
    mockCreateOrder.mockResolvedValue(true);
    mockUpdateStatus.mockResolvedValue(undefined);
  });

  // AC-7: Successful checkout response
  it('processes a valid checkout and returns COMPLETED with full pricing', async () => {
    const result = await processCheckout(validRequest, successPaymentProvider);

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      cartId: validRequest.cartId,
      status: 'COMPLETED',
      items: [{ productId: 'prod_1', quantity: 2, unitPrice: 1000, lineTotal: 2000 }],
      pricing: { subtotal: 2000, taxRate: 0.08, taxAmount: 160, total: 2160 },
      currency: 'USD',
    });
    expect(result.body).toHaveProperty('orderId');
    expect(result.body).toHaveProperty('createdAt');
    expect(result.body).toHaveProperty('completedAt');
  });

  // AC-2: Server-side price calculation
  it('calculates pricing server-side and includes full breakdown', async () => {
    const request = {
      ...validRequest,
      items: [
        { productId: 'prod_1', quantity: 3, unitPrice: 1500 },
        { productId: 'prod_2', quantity: 1, unitPrice: 750 },
      ],
    };
    const result = await processCheckout(request, successPaymentProvider);

    expect(result.statusCode).toBe(200);
    const body = result.body as any;
    expect(body.pricing.subtotal).toBe(5250);        // 4500 + 750
    expect(body.pricing.taxAmount).toBe(420);         // floor(5250 × 0.08)
    expect(body.pricing.total).toBe(5670);
  });

  // AC-5: Payment after order creation
  it('creates order with PENDING status before capturing payment', async () => {
    let capturedStatus: string | undefined;
    mockCreateOrder.mockImplementation(async (order) => {
      capturedStatus = order.status;
      return true;
    });

    await processCheckout(validRequest, successPaymentProvider);

    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    expect(capturedStatus).toBe('PENDING');

    // Payment capture happens after createOrder
    expect(successPaymentProvider.capturePayment).toHaveBeenCalledTimes(1);
  });

  // AC-3: Idempotent checkout (success)
  it('returns existing completed order without reprocessing', async () => {
    const existing = buildExistingOrder({ status: 'COMPLETED' });
    mockGetOrder.mockResolvedValue(existing);

    const result = await processCheckout(validRequest, successPaymentProvider);

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      orderId: 'ord_existing',
      status: 'COMPLETED',
    });
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(successPaymentProvider.capturePayment).not.toHaveBeenCalled();
  });

  // AC-4: Idempotent checkout (failed)
  it('returns existing failed order without retrying payment', async () => {
    const existing = buildExistingOrder({
      status: 'FAILED',
      errorDetails: { reason: 'insufficient_funds' },
    });
    mockGetOrder.mockResolvedValue(existing);

    const result = await processCheckout(validRequest, successPaymentProvider);

    expect(result.statusCode).toBe(402);
    expect(result.body).toMatchObject({
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Payment was declined',
      },
    });
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(successPaymentProvider.capturePayment).not.toHaveBeenCalled();
  });

  // Idempotency conflict: same cartId, different payload
  it('throws IDEMPOTENCY_CONFLICT when cartId is reused with different payload', async () => {
    const existing = buildExistingOrder();
    mockGetOrder.mockResolvedValue(existing);

    const differentRequest = {
      ...validRequest,
      items: [{ productId: 'prod_different', quantity: 1, unitPrice: 500 }],
    };

    try {
      await processCheckout(differentRequest, successPaymentProvider);
      fail('Expected IDEMPOTENCY_CONFLICT error');
    } catch (err) {
      expect(err).toBeInstanceOf(CheckoutError);
      expect((err as CheckoutError).code).toBe('IDEMPOTENCY_CONFLICT');
      expect((err as CheckoutError).statusCode).toBe(409);
    }
  });

  // Payment failure
  it('marks order as FAILED and throws PaymentFailedError on payment decline', async () => {
    try {
      await processCheckout(validRequest, failedPaymentProvider);
      fail('Expected PAYMENT_FAILED error');
    } catch (err) {
      expect(err).toBeInstanceOf(CheckoutError);
      expect((err as CheckoutError).code).toBe('PAYMENT_FAILED');
      expect((err as CheckoutError).statusCode).toBe(402);
    }

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      validRequest.cartId,
      'FAILED',
      expect.any(String),
      expect.objectContaining({ reason: 'insufficient_funds' })
    );
  });

  // AC-6: Duplicate prevention under concurrency
  it('returns winning order when conditional write fails (same payload)', async () => {
    mockCreateOrder.mockResolvedValue(false); // Lost the race
    const winningOrder = buildExistingOrder({ status: 'COMPLETED' });
    // First call returns null (no order yet), second call returns the winning order
    mockGetOrder.mockResolvedValueOnce(null).mockResolvedValueOnce(winningOrder);

    const result = await processCheckout(validRequest, successPaymentProvider);

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      orderId: 'ord_existing',
      status: 'COMPLETED',
    });
    expect(successPaymentProvider.capturePayment).not.toHaveBeenCalled();
  });

  it('throws IDEMPOTENCY_CONFLICT when conditional write fails with different payload', async () => {
    mockCreateOrder.mockResolvedValue(false);
    const winningOrder = buildExistingOrder(); // has hash for validRequest
    mockGetOrder.mockResolvedValueOnce(null).mockResolvedValueOnce(winningOrder);

    const differentRequest = {
      ...validRequest,
      paymentMethodId: 'pm_different',
    };

    try {
      await processCheckout(differentRequest, successPaymentProvider);
      fail('Expected IDEMPOTENCY_CONFLICT error');
    } catch (err) {
      expect((err as CheckoutError).code).toBe('IDEMPOTENCY_CONFLICT');
    }
  });

  it('uses USD as default currency when not provided', async () => {
    const result = await processCheckout(validRequest, successPaymentProvider);

    const body = result.body as any;
    expect(body.currency).toBe('USD');
  });

  it('falls back to createdAt for completedAt on PENDING in-flight retry', async () => {
    const pendingOrder = buildExistingOrder({ status: 'PENDING', completedAt: undefined });
    mockGetOrder.mockResolvedValue(pendingOrder);

    const result = await processCheckout(validRequest, successPaymentProvider);

    expect(result.statusCode).toBe(200);
    const body = result.body as any;
    expect(body.completedAt).toBe(pendingOrder.createdAt);
    expect(successPaymentProvider.capturePayment).not.toHaveBeenCalled();
  });
});
