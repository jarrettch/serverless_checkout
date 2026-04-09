import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../src/handlers/checkout';
import * as orderService from '../src/services/orderService';

jest.mock('../src/services/orderService');
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLogContext: jest.fn(),
}));

const mockGetOrder = orderService.getOrderByCartId as jest.MockedFunction<
  typeof orderService.getOrderByCartId
>;
const mockCreateOrder = orderService.createOrder as jest.MockedFunction<
  typeof orderService.createOrder
>;
const mockUpdateStatus = orderService.updateOrderStatus as jest.MockedFunction<
  typeof orderService.updateOrderStatus
>;

function buildEvent(body: string | null): APIGatewayProxyEvent {
  return {
    body,
    requestContext: { requestId: 'test-request-id' } as any,
  } as APIGatewayProxyEvent;
}

const validBody = JSON.stringify({
  cartId: '550e8400-e29b-41d4-a716-446655440000',
  items: [{ productId: 'prod_1', quantity: 1, unitPrice: 1000 }],
  paymentMethodId: 'pm_success_123',
});

describe('checkout handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrder.mockResolvedValue(null);
    mockCreateOrder.mockResolvedValue(true);
    mockUpdateStatus.mockResolvedValue(undefined);
  });

  it('returns 400 INVALID_REQUEST for malformed JSON', async () => {
    const result = await handler(buildEvent('{not valid json'));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toMatch(/JSON/i);
  });

  it('returns 400 for validation errors with structured error body', async () => {
    const result = await handler(buildEvent(JSON.stringify({ cartId: 'not-a-uuid' })));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 EMPTY_CART when items array is empty', async () => {
    const body = JSON.stringify({
      cartId: '550e8400-e29b-41d4-a716-446655440000',
      items: [],
      paymentMethodId: 'pm_success_123',
    });
    const result = await handler(buildEvent(body));

    expect(result.statusCode).toBe(400);
    const parsed = JSON.parse(result.body);
    expect(parsed.error.code).toBe('EMPTY_CART');
  });

  it('returns 500 INTERNAL_ERROR for unexpected exceptions', async () => {
    mockGetOrder.mockRejectedValue(new Error('DynamoDB unavailable'));

    const result = await handler(buildEvent(validBody));

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 200 with Content-Type header for a successful checkout', async () => {
    const result = await handler(buildEvent(validBody));

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.status).toBe('COMPLETED');
  });
});
