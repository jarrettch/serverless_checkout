# Serverless Checkout Service

A serverless checkout service built with TypeScript, AWS Lambda, and DynamoDB. The service processes e-commerce orders with server-side pricing, idempotent checkout behavior, and deterministic error handling.

## Quick Start

```bash
pnpm install
pnpm run typecheck
pnpm test
```


## Project Structure

```
├── src/
│   ├── handlers/checkout.ts          # Lambda entry point
│   ├── services/
│   │   ├── checkoutService.ts        # Checkout orchestration (steps 1-5)
│   │   ├── pricingService.ts         # Server-side price calculation
│   │   └── orderService.ts           # DynamoDB operations
│   ├── providers/
│   │   ├── paymentProvider.ts        # Payment interface
│   │   └── mockPaymentProvider.ts    # Deterministic mock
│   ├── types/index.ts                # Shared type definitions
│   ├── utils/
│   │   ├── validation.ts             # Request validation
│   │   ├── logger.ts                 # Structured JSON logging
│   │   └── hash.ts                   # Payload hashing for idempotency
│   └── errors/index.ts              # Error classes with HTTP status codes
├── tests/
│   ├── checkout.test.ts              # Integration tests (all ACs)
│   ├── pricing.test.ts              # Pricing arithmetic tests
│   └── validation.test.ts           # Input validation tests
├── CHECKOUT_SPEC.md                  # Behavioral specification (source of truth)
└── AI_WORKFLOW.md                    # Claude usage during development
```

## Design Decisions

### Spec-First Development

[CHECKOUT_SPEC.md](CHECKOUT_SPEC.md) is the source of truth. All implementation and test decisions trace back to the spec. When behavior changed during development (e.g., adding `IDEMPOTENCY_CONFLICT`, removing per-request tax rates), the spec was updated first and the code followed.

### Server-Side Pricing

The server performs all pricing arithmetic from the request line items and ignores any client-computed totals. A production system would validate prices against a product catalog; that is out of scope here. See the [Price Authority](CHECKOUT_SPEC.md#price-authority) section in the spec.

### Idempotency Model

`cartId` serves as the idempotency key, stored as the DynamoDB partition key. On retry:

- **Same canonical request**: returns the existing order without reprocessing (200 if completed, 402 if failed)
- **Different canonical request**: returns 409 `IDEMPOTENCY_CONFLICT`

Payload identity is determined by comparing a SHA-256 hash of the canonical request (`items` + `paymentMethodId`), stored as `payloadHash` in DynamoDB. This avoids expensive deep comparisons on every retry.

### Order Lifecycle

Orders are created with status `PENDING` before payment capture is attempted. This ensures an auditable record exists regardless of payment outcome. After payment, the order is updated to `COMPLETED` or `FAILED`. `PENDING` is an internal state only — the API never exposes it to clients.

### HTTP 402 for Payment Failure

HTTP 402 (Payment Required) is used for declined payments. It is semantically accurate for payment-specific failures, and the spec is the source of truth for status codes.

## Trade-offs and Scope

### In-Flight Duplicate Handling

In-flight duplicate checkout requests are intentionally simplified for this exercise: in-flight retries replay the success response shape instead of exposing a client-visible processing state. If a retry arrives while the original checkout is still processing, the service returns the same response shape rather than introducing a separate `ORDER_PROCESSING` error or `PENDING` API state. This keeps the public API synchronous and aligned with the assignment scope, while still preventing duplicate orders through the idempotency guard. A production system would likely use a more explicit processing-state contract or stronger coordination (e.g., optimistic locking, state machines, or 202 responses with polling).

### Single Table Design

Orders and idempotency records share the same DynamoDB item keyed by `cartId`. This is pragmatic for the exercise — it makes duplicate prevention trivial with `attribute_not_exists(cartId)` conditional writes. A production design might separate an idempotency table from an orders table so order retention isn't tied to retry windows. The `ttl` attribute (7-day expiry) mitigates unbounded table growth from abandoned carts.

### Cart Validity

Cart validation is limited to structural checks: non-empty items array, valid field types, and value ranges. Product existence, duplicate line consolidation, and catalog price verification are out of scope.

### Tax Configuration

Tax rate is read from server configuration (`TAX_RATE` environment variable) only, defaulting to 8%. Clients cannot influence tax — this is an intentional design constraint for a checkout service where the server must be authoritative over pricing.

## Testing

Tests are organized across 3 suites covering all 7 acceptance criteria:

| AC | Description | Test File |
|----|-------------|-----------|
| AC-1 | Empty cart rejection | `validation.test.ts` |
| AC-2 | Server-side price calculation | `pricing.test.ts`, `checkout.test.ts` |
| AC-3 | Idempotent checkout (success) | `checkout.test.ts` |
| AC-4 | Idempotent checkout (failed) | `checkout.test.ts` |
| AC-5 | Payment after order creation | `checkout.test.ts` |
| AC-6 | Duplicate prevention under concurrency | `checkout.test.ts` |
| AC-7 | Successful checkout response | `checkout.test.ts` |

Additional coverage includes: idempotency conflict detection, payment failure handling, UUID validation, type validation, tax rate configuration, and edge cases (zero-priced items, fractional tax rounding).

DynamoDB operations are mocked in tests using Jest. The mock payment provider uses deterministic behavior based on `paymentMethodId` patterns (e.g., `pm_fail_insufficient_funds` always returns a decline).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ORDERS_TABLE` | `Orders` | DynamoDB table name |
| `TAX_RATE` | `0.08` | Tax rate as decimal |
