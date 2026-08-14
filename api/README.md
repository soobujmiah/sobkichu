# Sobkichu API

NestJS backend. **Phase 1 scope:** Customer + Merchant modes, hyperlocal e-commerce and service booking.

Governed by [`MASTER_PROMPT.md`](../MASTER_PROMPT.md). Structure follows [backend-modules.md](../docs/architecture/backend-modules.md); the module boundary rules there are enforced by an ESLint `no-restricted-imports` rule, not just review.

## Status

Scaffolded, pre-framework-wiring. What exists is the **compliance core** — the domain logic that the rest of the order path will be built around:

| File | What it is |
|---|---|
| [`src/common/money.ts`](src/common/money.ts) | Integer-poisha BDT arithmetic |
| [`src/order/domain/advance-cap.ts`](src/order/domain/advance-cap.ts) | DCOG 2021 advance-payment cap (rows C1/C2/C3) |
| [`src/order/domain/delivery-clock.ts`](src/order/domain/delivery-clock.ts) | DCOG 2021 delivery clock (rows C4/C5) |

Each has a colocated `.spec.ts`. Not yet built: NestJS modules, controllers, repositories, the aggregator integration.

## Why this came first

The order-creation path is where the compliance rules actually bite, and both are pure functions of server-resolved data. Writing them as **dependency-free domain logic** means:

- They are testable without a database, a framework, or a running app
- `npm run test:compliance` is meaningful from the first commit
- The rules live in one readable place instead of being smeared across a controller

They pair with [`tools/schema_assertions.sql`](../tools/schema_assertions.sql), which asserts the same rules at the database level. Application logic is the primary mechanism; the `CHECK` constraint is the last line of defence ([ADR-0005](../docs/adr/0005-compliance-in-schema.md)).

## Two decisions worth knowing

**Money is integer poisha, never float.** `1234.56 * 0.1` is `123.45600000000002` in IEEE-754. This code computes a legally-capped payment amount, so all arithmetic runs in integer 1/100-taka units and converts at the `NUMERIC(12,2)` boundary. `percentageOf` rounds **down**, because it computes a legal maximum and rounding up would authorise an advance above the permitted ceiling.

**Mixed carts take the conservative reading.** If any line item is not `ready_to_ship`, the 10% cap applies to the whole order. The alternative — per-line caps summed — would let a merchant collect 100% on nine ready items and stall on the tenth, which is the behaviour the guideline exists to prevent. This is a documented judgement call awaiting counsel; if they read it per-line, only `computeAdvanceCap` changes.

## Scripts

```bash
npm run lint          # ESLint, incl. the module-boundary rule
npm run typecheck     # tsc --noEmit
npm test              # all unit tests
npm run test:compliance   # the compliance regression subset
```

`test:compliance` is run by CI **without** `--if-present`: if the script goes missing, the build breaks rather than quietly passing.

## Errors and i18n

User-facing errors carry a `messageKey` (e.g. `error.checkout.advance_exceeds_cap`); the client renders it. The `Error.message` alongside it is developer-facing and is never shown to a user.

Plain `throw new Error(...)` is for invariant violations — programmer errors that should never reach a user. Only HTTP exceptions (`BadRequestException` and friends) surface to clients, and those must use translation keys. [`tools/hardcoded_string_check.py`](../tools/hardcoded_string_check.py) enforces exactly that distinction.

## Adding a module

1. Read the ownership table in [backend-modules.md](../docs/architecture/backend-modules.md) — one module owns each table
2. No cross-module database access; call the owning module's interface
3. Dependencies point downward: `order` may depend on `catalog`, never the reverse
4. Later-phase modules are wired but flag-gated, returning 404 when off
