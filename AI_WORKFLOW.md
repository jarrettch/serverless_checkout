# AI Workflow: Claude Usage During Development

## Approach

Claude Code was used as a collaborative development partner throughout this project, not as a code generator to blindly trust. The workflow followed a spec-first pattern: requirements were written and refined in `CHECKOUT_SPEC.md` before any implementation began, and Claude was used to stress-test the spec, identify gaps, and then implement against it.

## How Claude Was Used

### 1. Spec Review and Hardening

The initial spec was written first, then Claude reviewed it against the assignment requirements (Task-1.docx) as a staff software architect. This surfaced several gaps:

- **Pricing authority ambiguity**: The spec accepted `unitPrice` from clients but claimed server-side pricing. Claude helped articulate the "Price Authority" section to clarify that the server performs all arithmetic while acknowledging that catalog validation is out of scope.
- **Idempotency edge cases**: The original spec only covered happy-path retries. Claude identified the missing case of same `cartId` with a different payload, leading to the `IDEMPOTENCY_CONFLICT` rule and `payloadHash` mechanism.
- **Tax rate source**: The spec originally said tax was configurable "per request or via environment variable." Claude flagged that client-supplied tax rates are inappropriate for a checkout service, and the wording was tightened to server config only.
- **PENDING state leakage**: Discussion revealed that exposing `PENDING` as a client-visible state would require defining async response semantics. The decision was made to keep it internal and document the simplification in the README.

### Early Scoping Decisions

Several design decisions were made during spec writing, before implementation began:

- **Coupons and discounts**: Deliberately scoped out. The pricing module is structured for extensibility (the spec lists discounts, tiered pricing, and shipping as future additions), but implementing them would exceed the assignment scope. The decision was to design for it structurally without building it.
- **Prices in cents**: All monetary values use integers in cents rather than floating-point dollars. This avoids rounding errors in arithmetic (e.g., `0.1 + 0.2 !== 0.3` in JavaScript) and is standard practice for payment systems.
- **Minimal cart assumptions**: The assignment doesn't define a cart service or product catalog, so cart validation was scoped to structural checks only (non-empty, valid types and ranges). No assumptions were made about cart persistence, product existence, or duplicate line consolidation.
- **Mock payment provider**: Rather than stubbing payments as a no-op, a deterministic mock was built with pattern-based behavior (`pm_fail_*` triggers specific failure modes). This makes the checkout flow testable end-to-end without external dependencies.

### 2. Implementation

Claude scaffolded the implementation module by module, following the spec's file structure. Each module was written to match the spec's behavioral definitions:

- Types were derived directly from the spec's request/response schemas
- Error classes mapped 1:1 to the spec's error codes table
- The checkout orchestrator followed the spec's flow diagram steps 1-5
- The mock payment provider matched the spec's deterministic behavior table

### 3. Testing

Claude wrote tests mapped to each acceptance criterion (AC-1 through AC-7). The test structure mirrors the spec's AC definitions, with additional edge case coverage for validation and pricing.

## Example Prompts

**Spec review:**
- "Check CHECKOUT_SPEC.md against Task-1.docx as a staff software architect."
- "The biggest mismatch is that the request schema requires items[].unitPrice, while the assignment says the server must recalculate the full price on the server..."

**Edge case identification:**
- "Minor inconsistency, in the diagram we have 'status: COMPLETE' but it looks like the actual status we plan to use is 'COMPLETED'"
- "Does the idempotency model cover same cartId with different payload?"

**Implementation:**
- "Let's update the spec with 1 and 2, and also make that pricingService.ts vs pricing.ts change"
- "Starting with scaffolding sounds good." (after agreeing on implementation order: types → errors → validation → services → handler)

## What I Verified Myself

- **Spec completeness**: Reviewed the spec against the assignment requirements before asking Claude to audit it. Claude's review confirmed coverage but I had already identified the major structural alignment.
- **Architectural decisions**: The choice to use `cartId` as both idempotency key and partition key, the decision to keep `PENDING` internal, and the HTTP 402 choice were all deliberate decisions I made and defended, not suggestions I accepted without evaluation.
- **External spec review**: Ran the spec through a second review pass outside Claude to catch contract drift and edge cases. Several refinements came from this external review, which I then brought back to Claude for implementation.
- **Test correctness**: Verified that test assertions matched the spec's expected behavior, not just that tests passed. For example, the AC-5 test needed a specific implementation (capturing status at call time) to actually verify order-before-payment sequencing rather than just checking final state.
- **Consistency audit**: After implementation, ran a systematic check across all 10 consistency dimensions (pricing authority, idempotency behavior, status naming, error codes, etc.) to ensure spec, code, and tests aligned.
