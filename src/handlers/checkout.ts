import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { validateCheckoutRequest } from '../utils/validation';
import { processCheckout } from '../services/checkoutService';
import { MockPaymentProvider } from '../providers/mockPaymentProvider';
import { CheckoutError } from '../errors';
import * as logger from '../utils/logger';

const paymentProvider = new MockPaymentProvider();

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  logger.setLogContext({ requestId: event.requestContext?.requestId });

  try {
    const body = JSON.parse(event.body || '{}');
    const request = validateCheckoutRequest(body);

    logger.setLogContext({
      requestId: event.requestContext?.requestId,
      cartId: request.cartId,
    });

    const result = await processCheckout(request, paymentProvider);

    return {
      statusCode: result.statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result.body),
    };
  } catch (err: unknown) {
    if (err instanceof CheckoutError) {
      logger.warn('checkout.error', {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
      });

      return {
        statusCode: err.statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
          },
        }),
      };
    }

    if (err instanceof SyntaxError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Malformed JSON in request body',
          },
        }),
      };
    }

    logger.error('checkout.error', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      }),
    };
  }
}
