export class CheckoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export class InvalidRequestError extends CheckoutError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_REQUEST', message, 400, details);
  }
}

export class EmptyCartError extends CheckoutError {
  constructor() {
    super('EMPTY_CART', 'Cart must contain at least one item', 400);
  }
}

export class InvalidQuantityError extends CheckoutError {
  constructor(productId: string) {
    super('INVALID_QUANTITY', `Item quantity must be at least 1`, 400, { productId });
  }
}

export class InvalidPriceError extends CheckoutError {
  constructor(productId: string) {
    super('INVALID_PRICE', `Item price must not be negative`, 400, { productId });
  }
}

export class PaymentFailedError extends CheckoutError {
  constructor(orderId: string, reason: string) {
    super('PAYMENT_FAILED', 'Payment was declined', 402, { orderId, reason });
  }
}

export class IdempotencyConflictError extends CheckoutError {
  constructor(cartId: string) {
    super('IDEMPOTENCY_CONFLICT', 'Cart ID resubmitted with a different payload', 409, { cartId });
  }
}

export class InternalError extends CheckoutError {
  constructor(message = 'An unexpected error occurred') {
    super('INTERNAL_ERROR', message, 500);
  }
}
