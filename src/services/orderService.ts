import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Order, OrderStatus } from '../types';

const TABLE_NAME = process.env.ORDERS_TABLE || 'Orders';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function getOrderByCartId(cartId: string): Promise<Order | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { cartId },
    })
  );
  return (result.Item as Order) || null;
}

export async function createOrder(order: Order): Promise<boolean> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: order,
        ConditionExpression: 'attribute_not_exists(cartId)',
      })
    );
    return true;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      return false;
    }
    throw err;
  }
}

export async function updateOrderStatus(
  cartId: string,
  status: OrderStatus,
  completedAt?: string,
  errorDetails?: Record<string, unknown>
): Promise<void> {
  const updateExprParts = ['#status = :status'];
  const exprNames: Record<string, string> = { '#status': 'status' };
  const exprValues: Record<string, unknown> = { ':status': status };

  if (completedAt) {
    updateExprParts.push('completedAt = :completedAt');
    exprValues[':completedAt'] = completedAt;
  }

  if (errorDetails) {
    updateExprParts.push('errorDetails = :errorDetails');
    exprValues[':errorDetails'] = errorDetails;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { cartId },
      UpdateExpression: `SET ${updateExprParts.join(', ')}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
    })
  );
}
