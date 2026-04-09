import { validateCheckoutRequest } from '../src/utils/validation';

const validRequest = {
  cartId: '550e8400-e29b-41d4-a716-446655440000',
  items: [{ productId: 'prod_1', quantity: 2, unitPrice: 1000 }],
  paymentMethodId: 'pm_success_123',
};

describe('validateCheckoutRequest', () => {
  // AC-1: Empty cart rejection
  it('throws EMPTY_CART when items array is empty', () => {
    expect(() =>
      validateCheckoutRequest({ ...validRequest, items: [] })
    ).toThrow(expect.objectContaining({ code: 'EMPTY_CART' }));
  });

  it('throws INVALID_REQUEST when body is null', () => {
    expect(() => validateCheckoutRequest(null)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' })
    );
  });

  it('throws INVALID_REQUEST when cartId is missing', () => {
    const { cartId, ...rest } = validRequest;
    expect(() => validateCheckoutRequest(rest)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' })
    );
  });

  it('throws INVALID_REQUEST when cartId is not a valid UUID', () => {
    expect(() =>
      validateCheckoutRequest({ ...validRequest, cartId: 'not-a-uuid' })
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('throws INVALID_REQUEST when paymentMethodId is missing', () => {
    const { paymentMethodId, ...rest } = validRequest;
    expect(() => validateCheckoutRequest(rest)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' })
    );
  });

  it('throws INVALID_REQUEST when items is not an array', () => {
    expect(() =>
      validateCheckoutRequest({ ...validRequest, items: 'not-array' })
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('throws INVALID_QUANTITY when quantity is 0', () => {
    expect(() =>
      validateCheckoutRequest({
        ...validRequest,
        items: [{ productId: 'prod_1', quantity: 0, unitPrice: 1000 }],
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_QUANTITY' }));
  });

  it('throws INVALID_QUANTITY when quantity is negative', () => {
    expect(() =>
      validateCheckoutRequest({
        ...validRequest,
        items: [{ productId: 'prod_1', quantity: -1, unitPrice: 1000 }],
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_QUANTITY' }));
  });

  it('throws INVALID_PRICE when unitPrice is negative', () => {
    expect(() =>
      validateCheckoutRequest({
        ...validRequest,
        items: [{ productId: 'prod_1', quantity: 1, unitPrice: -100 }],
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_PRICE' }));
  });

  it('throws INVALID_REQUEST when unitPrice is not an integer', () => {
    expect(() =>
      validateCheckoutRequest({
        ...validRequest,
        items: [{ productId: 'prod_1', quantity: 1, unitPrice: 10.5 }],
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('throws INVALID_REQUEST when quantity is not an integer', () => {
    expect(() =>
      validateCheckoutRequest({
        ...validRequest,
        items: [{ productId: 'prod_1', quantity: 1.5, unitPrice: 1000 }],
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('throws INVALID_REQUEST when productId is missing', () => {
    expect(() =>
      validateCheckoutRequest({
        ...validRequest,
        items: [{ quantity: 1, unitPrice: 1000 }],
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('throws INVALID_REQUEST when order total exceeds MAX_SAFE_INTEGER', () => {
    expect(() =>
      validateCheckoutRequest({
        ...validRequest,
        items: [
          { productId: 'prod_1', quantity: Number.MAX_SAFE_INTEGER, unitPrice: 2 },
        ],
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('returns a valid CheckoutRequest for valid input', () => {
    const result = validateCheckoutRequest(validRequest);
    expect(result).toEqual({
      cartId: validRequest.cartId,
      items: validRequest.items,
      paymentMethodId: validRequest.paymentMethodId,
      currency: undefined,
    });
  });

  it('passes through optional currency', () => {
    const result = validateCheckoutRequest({ ...validRequest, currency: 'EUR' });
    expect(result.currency).toBe('EUR');
  });

  it('defaults currency to undefined when not provided', () => {
    const result = validateCheckoutRequest(validRequest);
    expect(result.currency).toBeUndefined();
  });
});
