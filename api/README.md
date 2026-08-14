# Sobkichu API

NestJS backend. **Phase 1 scope:** Customer + Merchant modes, hyperlocal e-commerce and service booking.

Governed by [`MASTER_PROMPT.md`](../MASTER_PROMPT.md). Structure follows [backend-modules.md](../docs/architecture/backend-modules.md); the module boundary rules there are enforced by an ESLint `no-restricted-imports` rule, not just review.

## Status

The **create-order path works end to end**, 66 tests green in CI.

| File | What it is |
|---|---|
| [`src/common/money.ts`](src/common/money.ts) | Integer-poisha BDT arithmetic |
| [`src/common/ports/`](src/common/ports/) | Catalog, Location, Merchant contracts — how `order` avoids touching other modules' tables |
| [`src/common/database/unit-of-work.ts`](src/common/database/unit-of-work.ts) | The transaction boundary |
| [`src/order/domain/advance-cap.ts`](src/order/domain/advance-cap.ts) | DCOG 2021 advance-payment cap (C1/C2/C3) |
| [`src/order/domain/delivery-clock.ts`](src/order/domain/delivery-clock.ts) | DCOG 2021 delivery clock (C4/C5) |
| [`src/order/order.service.ts`](src/order/order.service.ts) | Order creation — applies the rules, owns the transaction |
| [`src/order/order.repository.ts`](src/order/order.repository.ts) | SQL for app_order, order_item, order_status_event |

Not yet built: the catalog/location/identity adapters behind those ports, the payment aggregator integration and its webhook, and the auth guard (the controller currently hardcodes a customer id with a `TODO(identity)`).

## The transaction boundary

`UnitOfWork` uses `AsyncLocalStorage`, so a nested `withTransaction` **joins** the transaction already in flight instead of opening a second one. Without that, a service calling another service mid-transaction silently splits one atomic sequence in two — which is precisely the Order/Transaction desync the master prompt forbids.

Repository methods take a `TransactionContext`, never a pool connection. Writing half an order outside a transaction is not expressible in the API.

## Ports, and why they live in `common/`

`order` never reads the `listing`, `location` or `role` tables. It depends on interfaces in [`src/common/ports/`](src/common/ports/), so neither module imports the other and a later service extraction is a move rather than a rewrite ([ADR-0002](../docs/adr/0002-modular-monolith.md)).

The practical payoff shows up in the tests: `order.service.spec.ts` runs 26 cases against in-memory fakes with **no database at all**.

## Why this came first

The order-creation path is where the compliance rules actually bite, and both are pure functions of server-resolved data. Writing them as **dependency-free domain logic** means:

- They are testable without a database, a framework, or a running app
- `npm run test:compliance` is meaningful from the first commit
- The rules live in one readable place instead of being smeared across a controller

They pair with [`tools/schema_assertions.sql`](../tools/schema_assertions.sql), which asserts the same rules at the database level. Application logic is the primary mechanism; the `CHECK` constraint is the last line of defence ([ADR-0005](../docs/adr/0005-compliance-in-schema.md)).

## Two decisions worth knowing

**Money is integer poisha, never float.** `1234.56 * 0.1` is `123.45600000000002` in IEEE-754. This code computes a legally-capped payment amount, so all arithmetic runs in integer 1/100-taka units and converts at the `NUMERIC(12,2)` boundary. `percentageOf` rounds **down**, because it computes a legal maximum and rounding up would authorise an advance above the permitted ceiling.

**Mixed carts take the conservative reading.** If any line item is not `ready_to_ship`, the 10% cap applies to the whole order. The alternative — per-line caps summed — would let a merchant collect 100% on nine ready items and stall on the tenth, which is the behaviour the guideline exists to prevent.

That is one of **four judgement calls awaiting counsel**, all tabled in the [compliance matrix](../docs/compliance/compliance-matrix.md): the mixed-cart rule, whether the 10% basis includes the delivery fee, rounding direction, and escrow provider configuration. Each takes the more restrictive reading, and each is confined to `computeAdvanceCap` and its callers if counsel disagrees.

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
