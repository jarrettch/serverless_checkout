# Checkout Service Specification

> **Source of Truth**: This document defines the expected behavior of the checkout service. Implementation must conform to this spec.

## Overview

A serverless checkout service that processes e-commerce orders with guaranteed idempotency. The service calculates prices server-side, prevents duplicate orders, and provides clear error responses.

---

## Checkout Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      POST /checkout                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │  1. Validate Request   │
                 │     - cartId present   │
                 │     - items non-empty  │
                 │     - valid structure  │
                 └────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │  2. Check Idempotency  │
                 │     (DynamoDB lookup)  │
                 └────────────────────────┘
                         │         │
            ┌────────────┘         └────────────┐
            │ EXISTS                            │ NOT EXISTS
            ▼                                   ▼
   ┌──────────────────┐               ┌─────────────────────┐
   │ Compare payload  │               │ 3. Calculate Price  │
   │ hash             │               │    (server-side)    │
   └──────────────────┘               └─────────────────────┘
        │            │
   MATCH │            │ MISMATCH
        ▼            ▼
 ┌──────────────┐ ┌───────────────┐
 │Return existing│ │ Return 409    │
 │    order      │ │ IDEMPOTENCY_  │
 └──────────────┘ │ CONFLICT      │
                  └───────────────┘
                                                │
                                                ▼
                                      ┌─────────────────────┐
                                      │ 4. Create Order     │
                                      │    (status: PENDING)│
                                      └─────────────────────┘
                                                │
                                                ▼
                                      ┌─────────────────────┐
                                      │ 5. Capture Payment  │
                                      └─────────────────────┘
                                           │         │
                              ┌────────────┘         └────────────┐
                              │ SUCCESS                           │ FAILURE
                              ▼                                   ▼
                    ┌─────────────────┐                ┌─────────────────┐
                    │ Update order    │                │ Update order    │
                    │status: COMPLETED│                │ status: FAILED  │
                    └─────────────────┘                └─────────────────┘
                              │                                   │
                              ▼                                   ▼
                    ┌─────────────────┐                ┌─────────────────┐
                    │ Return order    │                │ Return error    │
                    │ (HTTP 200)      │                │ (HTTP 402)      │
                    └─────────────────┘                └─────────────────┘
```

---

## API Specification

### Endpoint

```
POST /checkout
Content-Type: application/json
```

### Request Body

```json
{
  "cartId": "string (UUID, required)",
  "items": [
    {
      "productId": "string (required)",
      "quantity": "integer (required, >= 1)",
      "unitPrice": "integer (required, cents, >= 0)"
    }
  ],
  "paymentMethodId": "string (required)",
  "currency": "string (optional, default: USD)"
}
```

#### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cartId` | string (UUID) | Yes | Unique identifier for the cart. Used as idempotency key. |
| `items` | array | Yes | List of items to purchase. Must have at least one item. |
| `items[].productId` | string | Yes | Identifier for the product. |
| `items[].quantity` | integer | Yes | Number of units. Must be >= 1. |
| `items[].unitPrice` | integer | Yes | Price per unit in cents. Must be >= 0. |
| `paymentMethodId` | string | Yes | Reference to payment method (e.g., tokenized card). |
| `currency` | string | No | ISO 4217 currency code. Defaults to "USD". |

### Cart Validity

Cart validity is limited to structural validation: non-empty items array, valid field types, and value ranges (quantity >= 1, unitPrice >= 0). Product existence, duplicate line consolidation, and catalog price verification are out of scope for this exercise.

### Response Body (Success)

```json
{
  "orderId": "string (UUID)",
  "cartId": "string (UUID)",
  "status": "COMPLETED",
  "items": [
    {
      "productId": "string",
      "quantity": "integer",
      "unitPrice": "integer",
      "lineTotal": "integer"
    }
  ],
  "pricing": {
    "subtotal": "integer (cents)",
    "taxRate": "number (decimal, e.g., 0.08)",
    "taxAmount": "integer (cents)",
    "total": "integer (cents)"
  },
  "currency": "string",
  "createdAt": "string (ISO 8601)",
  "completedAt": "string (ISO 8601)"
}
```

### Response Body (Error)

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": "object (optional)"
  }
}
```

---

## Pricing Rules

### Price Authority

Unit prices are provided in the request as input only. The server performs all pricing arithmetic and never trusts any client-computed total. A production system would typically validate prices against a product catalog, but that is out of scope for this exercise.

### Calculation

1. **Line Total**: `quantity × unitPrice` (per item)
2. **Subtotal**: Sum of all line totals
3. **Tax Amount**: `floor(subtotal × taxRate)`
4. **Total**: `subtotal + taxAmount`

### Tax Rate

- Default tax rate: **8%** (0.08)
- Tax rate is configurable via environment variable or server configuration only (never client-supplied)
- All monetary values are integers in cents (no floating point)

### Rounding

- Tax is calculated using `Math.floor()` to avoid overcharging
- All intermediate calculations maintain cent precision

### Extensibility Notes

The pricing calculation is isolated in a dedicated module (`pricingService.ts`) to allow future additions:
- Discount codes / coupons
- Tiered pricing
- Shipping costs
- Multiple tax jurisdictions

---

## Idempotency

### Mechanism

- **Key**: `cartId` serves as the idempotency key
- **Storage**: DynamoDB with `cartId` as partition key
- **Behavior**: If an order exists for a `cartId`, return the existing order without reprocessing

### Guarantees

| Scenario | Behavior |
|----------|----------|
| First request with `cartId` | Process checkout, create order, return result |
| Retry with same `cartId` (order COMPLETED) | Return existing order (HTTP 200) |
| Retry with same `cartId` (order FAILED) | Return existing failed order (HTTP 402) |
| Retry with same `cartId` but different payload (items, paymentMethodId) | Return HTTP 409 with error code `IDEMPOTENCY_CONFLICT` |
| Different `cartId` | Process as new checkout |

### Race Condition Handling

- DynamoDB conditional writes prevent duplicate order creation
- If two requests arrive simultaneously with the same `cartId` and identical payloads (matching `payloadHash`), only one order is created; the other returns the existing order
- If two requests arrive with the same `cartId` but different payloads (mismatched `payloadHash`), the second returns `IDEMPOTENCY_CONFLICT` (HTTP 409)
- In-flight duplicate checkout requests are intentionally simplified for this exercise; a production system would add stronger coordination or an explicit processing-state contract. See README for trade-off discussion

---

## Error Handling

### Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `INVALID_REQUEST` | Malformed JSON or missing required fields |
| 400 | `EMPTY_CART` | Cart has no items |
| 400 | `INVALID_QUANTITY` | Item quantity is less than 1 |
| 400 | `INVALID_PRICE` | Item price is negative |
| 402 | `PAYMENT_FAILED` | Payment capture was declined |
| 409 | `IDEMPOTENCY_CONFLICT` | Same `cartId` resubmitted with a different payload |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### Error Response Examples

#### Empty Cart
```json
{
  "error": {
    "code": "EMPTY_CART",
    "message": "Cart must contain at least one item"
  }
}
```

#### Payment Failed
```json
{
  "error": {
    "code": "PAYMENT_FAILED",
    "message": "Payment was declined",
    "details": {
      "orderId": "ord_abc123",
      "reason": "insufficient_funds"
    }
  }
}
```

---

## Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| Empty `items` array | Return 400 `EMPTY_CART` |
| `quantity: 0` on an item | Return 400 `INVALID_QUANTITY` |
| `unitPrice: -100` | Return 400 `INVALID_PRICE` |
| Missing `cartId` | Return 400 `INVALID_REQUEST` |
| Missing `paymentMethodId` | Return 400 `INVALID_REQUEST` |
| Very large order (overflow risk) | Validate total doesn't exceed MAX_SAFE_INTEGER |
| `cartId` reused after successful order | Return existing completed order |
| `cartId` reused after failed order | Return existing failed order (do not retry payment) |
| Payment timeout | Mark order as FAILED, return 402 |

---

## Security Considerations

### Input Validation

- All fields are validated before processing
- `cartId` must be a valid UUID format
- String lengths are bounded to prevent abuse
- Numeric values are validated for reasonable ranges

### Data Handling

- No secrets stored in code (use environment variables)
- Payment method IDs are tokens, not raw card data
- Structured logging excludes sensitive fields

### Request Authentication

- API Gateway handles authentication (out of scope for Lambda)
- Assume requests reaching Lambda are authenticated
- `userId` can be extracted from auth context if needed (future enhancement)

---

## Logging

All log entries are structured JSON with the following fields:

```json
{
  "timestamp": "ISO 8601",
  "level": "INFO | WARN | ERROR",
  "requestId": "AWS request ID",
  "cartId": "string",
  "orderId": "string (if available)",
  "action": "string (e.g., 'checkout.start', 'payment.capture')",
  "duration": "number (ms, for timed operations)",
  "error": "object (if applicable)"
}
```

### Key Log Events

| Action | Level | When |
|--------|-------|------|
| `checkout.start` | INFO | Request received |
| `checkout.idempotent_hit` | INFO | Returning existing order |
| `checkout.price_calculated` | INFO | Pricing complete |
| `order.created` | INFO | Order written to DynamoDB |
| `payment.capture.start` | INFO | Payment capture initiated |
| `payment.capture.success` | INFO | Payment successful |
| `payment.capture.failed` | WARN | Payment declined |
| `checkout.complete` | INFO | Request completed successfully |
| `checkout.error` | ERROR | Unhandled error |

---

## DynamoDB Schema

### Table: `Orders`

| Attribute | Type | Description |
|-----------|------|-------------|
| `cartId` (PK) | String | Partition key, idempotency key |
| `orderId` | String | Unique order identifier |
| `status` | String | `PENDING`, `COMPLETED`, `FAILED` |
| `items` | List | Order items with pricing |
| `pricing` | Map | Subtotal, tax, total |
| `currency` | String | ISO 4217 code |
| `paymentMethodId` | String | Payment reference |
| `createdAt` | String | ISO 8601 timestamp |
| `completedAt` | String | ISO 8601 timestamp (when finalized) |
| `errorDetails` | Map | Present if status is FAILED |
| `payloadHash` | String | SHA-256 hash of canonical request payload (`items` + `paymentMethodId`). Used to detect idempotency conflicts on retry. |
| `ttl` | Number | Unix epoch expiry (7 days after `createdAt`). Enables DynamoDB TTL to auto-delete stale records, preventing unbounded table growth from abandoned carts. |

### Access Patterns

1. **Get order by cartId**: Direct lookup using partition key
2. **Conditional create**: `attribute_not_exists(cartId)` to prevent duplicates

---

## Acceptance Criteria

### AC-1: Empty Cart Rejection
**Given** a checkout request with an empty `items` array
**When** the request is processed
**Then** return HTTP 400 with error code `EMPTY_CART`

### AC-2: Server-Side Price Calculation
**Given** a checkout request with items
**When** the request is processed
**Then** the `pricing.total` is calculated server-side as `subtotal + taxAmount`
**And** the response includes full pricing breakdown

### AC-3: Idempotent Checkout (Success)
**Given** a completed order exists for `cartId: "abc-123"`
**When** a new checkout request arrives with `cartId: "abc-123"`
**Then** return the existing order without creating a duplicate
**And** return HTTP 200

### AC-4: Idempotent Checkout (Failed)
**Given** a failed order exists for `cartId: "abc-123"`
**When** a new checkout request arrives with `cartId: "abc-123"`
**Then** return the existing failed order
**And** return HTTP 402
**And** do not retry payment

### AC-5: Payment After Order Creation
**Given** a valid checkout request
**When** the request is processed
**Then** the order is created in DynamoDB with status `PENDING`
**Before** payment capture is attempted

### AC-6: Duplicate Prevention Under Concurrency
**Given** two simultaneous requests with the same `cartId`
**When** both are processed
**Then** only one order is created
**And** both requests return the same order

### AC-7: Successful Checkout Response
**Given** a valid checkout request with valid payment
**When** the request is processed
**Then** return HTTP 200
**And** response includes `orderId`, `status: "COMPLETED"`, and full pricing

---

## Payment Provider Interface

### Interface Definition

```typescript
interface PaymentProvider {
  capturePayment(params: CapturePaymentParams): Promise<CapturePaymentResult>;
}

interface CapturePaymentParams {
  paymentMethodId: string;
  amount: number; // cents
  currency: string;
  orderId: string;
  metadata?: Record<string, string>;
}

interface CapturePaymentResult {
  success: boolean;
  transactionId?: string;
  errorCode?: string;
  errorMessage?: string;
}
```

### Mock Implementation Behavior

The mock provider uses deterministic behavior based on `paymentMethodId`:

| `paymentMethodId` Pattern | Behavior |
|---------------------------|----------|
| `pm_success_*` | Returns success |
| `pm_fail_insufficient_funds` | Returns failure: insufficient_funds |
| `pm_fail_card_declined` | Returns failure: card_declined |
| `pm_fail_*` | Returns failure: generic_error |
| (default) | Returns success |

---

## File Structure

```
├── src/
│   ├── handlers/
│   │   └── checkout.ts          # Lambda entry point
│   ├── services/
│   │   ├── checkoutService.ts   # Orchestration logic
│   │   ├── pricingService.ts    # Price calculation
│   │   └── orderService.ts      # DynamoDB operations
│   ├── providers/
│   │   ├── paymentProvider.ts   # Interface definition
│   │   └── mockPaymentProvider.ts
│   ├── types/
│   │   └── index.ts             # Shared types
│   ├── utils/
│   │   ├── logger.ts            # Structured logging
│   │   └── validation.ts        # Input validation
│   └── errors/
│       └── index.ts             # Custom error classes
├── tests/                       # Unit tests covering all acceptance criteria
│   ├── checkout.test.ts
│   ├── pricing.test.ts
│   └── validation.test.ts
├── CHECKOUT_SPEC.md             # This file — behavioral source of truth
├── AI_WORKFLOW.md               # Claude usage explanation and example prompts
└── README.md                    # Design decisions, trade-offs, and run instructions
```
