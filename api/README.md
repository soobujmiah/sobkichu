# Sobkichu API

NestJS backend. **Phase 1 scope:** Customer + Merchant modes, hyperlocal e-commerce and service booking.

Governed by [`MASTER_PROMPT.md`](../MASTER_PROMPT.md). Structure follows [backend-modules.md](../docs/architecture/backend-modules.md); the module boundary rules there are enforced by an ESLint `no-restricted-imports` rule, not just review.

## Status

The **full order lifecycle runs against real PostgreSQL** — authenticate, create, pay, confirm, delivery clock, notify. Merchants can now **publish listings** — same K1 (NID KYC) gate as order creation, plus the C8/C9 category checks. 205 tests green in CI (189 unit + 16 integration).

| File | What it is |
|---|---|
| [`src/common/money.ts`](src/common/money.ts) | Integer-poisha BDT arithmetic |
| [`src/common/ports/`](src/common/ports/) | Catalog, Location, Merchant contracts — how `order` avoids touching other modules' tables |
| [`src/common/database/unit-of-work.ts`](src/common/database/unit-of-work.ts) | The transaction boundary |
| [`src/order/domain/advance-cap.ts`](src/order/domain/advance-cap.ts) | DCOG 2021 advance-payment cap (C1/C2/C3) |
| [`src/common/compliance/delivery-clock.ts`](src/common/compliance/delivery-clock.ts) | DCOG 2021 delivery clock (C4/C5) — shared by `order` and `payment` |
| [`src/order/order.service.ts`](src/order/order.service.ts) | Order creation — applies the rules, owns the transaction |
| [`src/order/order.repository.ts`](src/order/order.repository.ts) | SQL for app_order, order_item, order_status_event |
| [`src/catalog/catalog.service.ts`](src/catalog/catalog.service.ts) | Listing creation — merchant KYC (K1) and category (C8/C9) gates |
| [`src/payment/payment.service.ts`](src/payment/payment.service.ts) | Settlement webhook — idempotent, starts the delivery clock |
| [`src/payment/webhook-signature.ts`](src/payment/webhook-signature.ts) | HMAC verification over the raw body |
| [`src/notification/`](src/notification/) | Transactional outbox — mandatory SMS alongside push |
| [`src/common/auth/`](src/common/auth/) | Session guard, tokens, `@Public()` / `@Caller()` |
| [`src/identity/domain/otp.ts`](src/identity/domain/otp.ts) | Phone OTP issuance and verification |

Adapters for all three ports are in place, so the path reads real listings, addresses and merchant KYC state.

The settlement webhook is in place, so orders now receive a regulated delivery deadline when an advance payment settles.

Notifications are queued transactionally and dispatched out of band, so SMS is guaranteed rather than hoped for.

Not yet built: outbound calls to an aggregator to *initiate* payment (we only receive settlement notices), real SMS/FCM providers (the gateways log at WARN so an unconfigured deployment is visible), a scheduler to run the dispatcher, and role switching (tokens carry an `activeRoleId` but nothing sets it yet — which means `POST /catalog/listings` is code-complete and tested, but not reachable end-to-end until login can mint a token with a merchant role selected).

## Authentication

Phone-based OTP — phone is the identifier in the BD context, not email. Numbers normalise to E.164 first, so `01712345678`, `8801712345678` and `+880 1712-345678` are one human rather than three accounts with three separate rate-limit buckets.

The guard is registered **globally** via `APP_GUARD`, so a new endpoint is protected by default and `@Public()` is an explicit opt-out. The failure mode of opt-in auth is a forgotten decorator on an endpoint that moves money. Only the two login routes and the payment webhook are public, and the webhook authenticates by HMAC instead.

Tokens are signed with `node:crypto` rather than a JWT library: the locked stack has no JWT dependency, adding one would be a deviation requiring an ADR, and one algorithm means no `alg: none` or algorithm-confusion surface. They carry only a user id and active role — KYC state is read per request, so a token minted before a merchant's KYC was revoked cannot keep asserting they are verified.

## Why notifications use an outbox

Sending inside the settlement transaction would let a slow SMS gateway hold a write transaction open, and a gateway failure would roll back a payment that genuinely settled. Sending after the commit risks the opposite: the process dies between commit and send, and a buyer is never told their order was confirmed.

The outbox writes the *intent* to notify inside the same transaction as the state change. A separate dispatcher calls the gateways. Delivery becomes at-least-once instead of maybe-once — the right trade-off for a channel a user relies on to learn their money moved.

## The transaction boundary

`UnitOfWork` uses `AsyncLocalStorage`, so a nested `withTransaction` **joins** the transaction already in flight instead of opening a second one. Without that, a service calling another service mid-transaction silently splits one atomic sequence in two — which is precisely the Order/Transaction desync the master prompt forbids.

Repository methods take a `TransactionContext`, never a pool connection. Writing half an order outside a transaction is not expressible in the API.

## Ports, and why they live in `common/`

`order` never reads the `listing`, `location` or `role` tables. It depends on interfaces in [`src/common/ports/`](src/common/ports/), so neither module imports the other and a later service extraction is a move rather than a rewrite ([ADR-0002](../docs/adr/0002-modular-monolith.md)).

The practical payoff shows up in the tests: `order.service.spec.ts` runs 26 cases against in-memory fakes with **no database at all**, while [`test/order-creation.int-spec.ts`](test/order-creation.int-spec.ts) runs the same path against real PostgreSQL + PostGIS.

## Test layers

| Command | What it covers |
|---|---|
| `npm run test:unit` | Domain rules, service orchestration, adapter mapping — no database |
| `npm run test:int` | The whole path against real PostgreSQL + PostGIS, including rollback behaviour |
| `npm run test:compliance` | The subset encoding legal obligations |

Integration tests skip themselves when `DATABASE_URL` is absent, so `npm test` stays runnable without a database. CI always provides one, and runs them `--runInBand` because they assert on row counts.

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
