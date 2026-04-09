import { CheckoutRequest } from '../types';
import {
  InvalidRequestError,
  EmptyCartError,
  InvalidQuantityError,
  InvalidPriceError,
} from '../errors';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_ID_LENGTH = 128;
const MAX_ITEMS = 100;
const CURRENCY_LENGTH = 3;

export function validateCheckoutRequest(body: unknown): CheckoutRequest {
  if (!body || typeof body !== 'object') {
    throw new InvalidRequestError('Request body must be a JSON object');
  }

  const req = body as Record<string, unknown>;

  if (!req.cartId || typeof req.cartId !== 'string') {
    throw new InvalidRequestError('cartId is required and must be a string');
  }

  if (!UUID_REGEX.test(req.cartId)) {
    throw new InvalidRequestError('cartId must be a valid UUID');
  }

  if (!req.paymentMethodId || typeof req.paymentMethodId !== 'string') {
    throw new InvalidRequestError('paymentMethodId is required and must be a string');
  }

  if (req.paymentMethodId.length > MAX_ID_LENGTH) {
    throw new InvalidRequestError(`paymentMethodId must be ${MAX_ID_LENGTH} characters or fewer`);
  }

  if (!Array.isArray(req.items)) {
    throw new InvalidRequestError('items is required and must be an array');
  }

  if (req.items.length === 0) {
    throw new EmptyCartError();
  }

  if (req.items.length > MAX_ITEMS) {
    throw new InvalidRequestError(`items must contain ${MAX_ITEMS} or fewer entries`);
  }

  if (req.currency !== undefined) {
    if (typeof req.currency !== 'string') {
      throw new InvalidRequestError('currency must be a string');
    }
    if (req.currency.length !== CURRENCY_LENGTH) {
      throw new InvalidRequestError('currency must be a 3-character ISO 4217 code');
    }
  }

  const items = req.items.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') {
      throw new InvalidRequestError(`items[${index}] must be an object`);
    }

    const i = item as Record<string, unknown>;

    if (!i.productId || typeof i.productId !== 'string') {
      throw new InvalidRequestError(`items[${index}].productId is required and must be a string`);
    }

    if (i.productId.length > MAX_ID_LENGTH) {
      throw new InvalidRequestError(`items[${index}].productId must be ${MAX_ID_LENGTH} characters or fewer`);
    }

    if (typeof i.quantity !== 'number' || !Number.isInteger(i.quantity)) {
      throw new InvalidRequestError(`items[${index}].quantity must be an integer`);
    }

    if (i.quantity < 1) {
      throw new InvalidQuantityError(i.productId);
    }

    if (typeof i.unitPrice !== 'number' || !Number.isInteger(i.unitPrice)) {
      throw new InvalidRequestError(`items[${index}].unitPrice must be an integer`);
    }

    if (i.unitPrice < 0) {
      throw new InvalidPriceError(i.productId);
    }

    return {
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    };
  });

  // Validate total won't exceed MAX_SAFE_INTEGER
  const estimatedTotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
  if (estimatedTotal > Number.MAX_SAFE_INTEGER) {
    throw new InvalidRequestError('Order total exceeds maximum safe value');
  }

  return {
    cartId: req.cartId,
    items,
    paymentMethodId: req.paymentMethodId,
    currency: typeof req.currency === 'string' ? req.currency : undefined,
  };
}
