import { randomUUID } from 'crypto';
import { CheckoutRequest, CheckoutSuccessResponse, ErrorResponse, Order } from '../types';
import { PaymentProvider } from '../providers/paymentProvider';
import { calculatePricing } from './pricingService';
import { getOrderByCartId, createOrder, updateOrderStatus } from './orderService';
import { computePayloadHash } from '../utils/hash';
import { IdempotencyConflictError, PaymentFailedError, InternalError } from '../errors';
import * as logger from '../utils/logger';

const TTL_DAYS = 7;

function buildSuccessResponse(order: Order): CheckoutSuccessResponse {
  return {
    orderId: order.orderId,
    cartId: order.cartId,
    status: 'COMPLETED',
    items: order.items,
    pricing: order.pricing,
    currency: order.currency,
    createdAt: order.createdAt,
    // Fall back to createdAt for in-flight retries where completedAt is not yet set.
    // See README "In-Flight Duplicate Handling" for the simplification rationale.
    completedAt: order.completedAt ?? order.createdAt,
  };
}

function buildErrorResponse(order: Order): ErrorResponse {
  return {
    error: {
      code: 'PAYMENT_FAILED',
      message: 'Payment was declined',
      details: {
        orderId: order.orderId,
        reason: order.errorDetails?.reason as string,
      },
    },
  };
}

export async function processCheckout(
  request: CheckoutRequest,
  paymentProvider: PaymentProvider
): Promise<{ statusCode: number; body: CheckoutSuccessResponse | ErrorResponse }> {
  const { cartId, items, paymentMethodId, currency = 'USD' } = request;

  // Step 1: Check idempotency
  logger.info('checkout.start', { cartId });

  const payloadHash = computePayloadHash(items, paymentMethodId);
  const existingOrder = await getOrderByCartId(cartId);

  if (existingOrder) {
    if (existingOrder.payloadHash !== payloadHash) {
      throw new IdempotencyConflictError(cartId);
    }

    logger.info('checkout.idempotent_hit', { cartId, orderId: existingOrder.orderId });

    if (existingOrder.status === 'COMPLETED') {
      return { statusCode: 200, body: buildSuccessResponse(existingOrder) };
    }
    if (existingOrder.status === 'FAILED') {
      return { statusCode: 402, body: buildErrorResponse(existingOrder) };
    }
    // Simplified in-flight retry handling:
    // we replay the success response shape instead of exposing a PENDING state externally.
    return { statusCode: 200, body: buildSuccessResponse(existingOrder) };
  }

  // Step 2: Calculate pricing
  const { orderItems, pricing } = calculatePricing(items);
  logger.info('checkout.price_calculated', { cartId, total: pricing.total });

  // Step 3: Create order with PENDING status
  const now = new Date();
  const orderId = `ord_${randomUUID()}`;
  const ttl = Math.floor(now.getTime() / 1000) + TTL_DAYS * 24 * 60 * 60;

  const order: Order = {
    orderId,
    cartId,
    status: 'PENDING',
    items: orderItems,
    pricing,
    currency,
    paymentMethodId,
    payloadHash,
    createdAt: now.toISOString(),
    ttl,
  };

  const created = await createOrder(order);

  if (!created) {
    // Lost the race — another request created the order first
    const winningOrder = await getOrderByCartId(cartId);
    if (!winningOrder) {
      throw new InternalError('Order disappeared after conditional write conflict');
    }

    if (winningOrder.payloadHash !== payloadHash) {
      throw new IdempotencyConflictError(cartId);
    }

    logger.info('checkout.idempotent_hit', { cartId, orderId: winningOrder.orderId });

    if (winningOrder.status === 'COMPLETED') {
      return { statusCode: 200, body: buildSuccessResponse(winningOrder) };
    }
    return { statusCode: 402, body: buildErrorResponse(winningOrder) };
  }

  logger.info('order.created', { cartId, orderId });

  // Step 4: Capture payment
  logger.info('payment.capture.start', { cartId, orderId, amount: pricing.total });

  const paymentResult = await paymentProvider.capturePayment({
    paymentMethodId,
    amount: pricing.total,
    currency,
    orderId,
  });

  if (!paymentResult.success) {
    logger.warn('payment.capture.failed', {
      cartId,
      orderId,
      errorCode: paymentResult.errorCode,
    });

    const errorDetails = {
      reason: paymentResult.errorCode || 'unknown',
      message: paymentResult.errorMessage,
    };
    const completedAt = new Date().toISOString();
    await updateOrderStatus(cartId, 'FAILED', completedAt, errorDetails);

    order.status = 'FAILED';
    order.completedAt = completedAt;
    order.errorDetails = errorDetails;

    throw new PaymentFailedError(orderId, paymentResult.errorCode || 'unknown');
  }

  // Step 5: Update order to COMPLETED
  logger.info('payment.capture.success', {
    cartId,
    orderId,
    transactionId: paymentResult.transactionId,
  });

  const completedAt = new Date().toISOString();
  await updateOrderStatus(cartId, 'COMPLETED', completedAt);

  order.status = 'COMPLETED';
  order.completedAt = completedAt;

  logger.info('checkout.complete', { cartId, orderId, total: pricing.total });

  return { statusCode: 200, body: buildSuccessResponse(order) };
}
