# Backend Module Layout (NestJS)

**Scope: Phase 1.** One NestJS application, strict module boundaries ([ADR-0002](../adr/0002-modular-monolith.md)). Modules are drawn as if they were separate services so that later extraction is a move, not a rewrite.

## Modules

```
src/
  identity/       # User, Role, auth, OTP, NID KYC          [Phase 1]
  location/       # BD address hierarchy, geocoding, radius  [Phase 1]
  catalog/        # Listing, Category, search                [Phase 1]
  order/          # Order, OrderItem, status timeline        [Phase 1]
  payment/        # Transaction, aggregator, COD, escrow     [Phase 1]
  notification/   # FCM push + SMS fallback                  [Phase 1]
  admin/          # Central Admin Panel, feature flags       [Phase 1]
  i18n/           # translation key resolution               [Phase 1]

  dispatch/       # rider assignment                         [Phase 2, flag off]
  ledger/         # Digital Khata                            [Phase 2, flag off]
  community/      # UGC, moderation                          [Phase 4, flag off]
```

## Boundary rules

1. **No cross-module database access.** `order` does not query the `listing` table directly; it calls `catalog`'s interface. Enforced by review and by import-boundary lint rules.
2. **One module owns each table.** Ownership is listed below. A second module reading it goes through the owner.
3. **Modules depend downward, not sideways.** `order` may depend on `catalog`, `payment`, and `location`. `catalog` may not depend on `order`.
4. **Flag-gated modules are wired but disabled.** They compile and are tested; their controllers return 404 when the flag is off.

## Ownership

| Module | Owns | May be called by |
|---|---|---|
| `identity` | `app_user`, `role`, `user_saved_location` | all |
| `location` | `location` | all |
| `catalog` | `listing`, `category` | `order`, `admin` |
| `order` | `app_order`, `order_item`, `order_status_event` | `payment`, `dispatch`, `admin` |
| `payment` | `transaction` | `order`, `ledger`, `admin` |
| `notification` | (none — stateless) | all |
| `admin` | feature flags, audit | — |

## The order-creation path

The compliance-bearing path, and the one place several modules meet. Sequence:

1. `order` receives the request, validates the cart against `catalog` (price, stock, `ready_to_ship`, restricted category)
2. `location` resolves the delivery address and determines `is_same_city` against the merchant's district
3. `order` computes `advance_cap_bdt` server-side — never from client input
4. **One database transaction:** insert `app_order`, `order_item` rows with `ready_to_ship_at_order` snapshots, initial `order_status_event`, and the pending `transaction`
5. `payment` initiates with the aggregator (or marks COD pending-on-delivery)
6. On the aggregator webhook: `payment` writes settlement **and** `order` writes status **in one transaction**, then stamps `advance_paid_at` and `delivery_deadline_at`
7. `notification` sends push **and** SMS

Steps 4 and 6 being single transactions is the non-negotiable part — Order and Transaction may never desync (master prompt §8).

## Cross-cutting concerns

| Concern | Implementation |
|---|---|
| Auth | Guard reading the active Role from the session; role claims never trusted from the client |
| Feature flags | Interceptor resolving flags from `admin`; later-phase controllers return 404 when off |
| i18n | Responses carry keys, not rendered strings; the client resolves them |
| Idempotency | `UNIQUE (aggregator, aggregator_ref)` on `transaction`; webhook handlers are replay-safe |
| Rate limiting | Redis-backed, on OTP issuance, login, and order creation |
| Audit | Append-only `order_status_event`; no hard deletes on Orders or Transactions |

## Testing boundaries

Each module has unit tests for its own logic and integration tests through its public interface. A test that reaches into another module's tables is testing the wrong thing — and quietly cements a boundary violation.
