# Non-Functional Requirements

Master prompt §8. These are acceptance criteria, not aspirations. A feature that meets its functional spec and violates one of these is not done.

## Offline tolerance

Catalog browsing and cart building **must work offline** from cached data, with sync-on-reconnect. For this market that is core UX, not optional polish.

| Requirement | Acceptance criterion |
|---|---|
| Offline browse | App launched in airplane mode shows last-viewed catalog and order state |
| Offline cart | Items can be added and removed; cart survives app kill |
| Queued actions | "Place order" issued with no network is queued, visibly, and retried on reconnect |
| No silent failure | Every queued or failed action has a user-visible state — never a spinner that resolves to nothing |
| Conflict handling | On sync, server state wins for price and stock; the user is told plainly if something changed |

The user-visible-queue requirement matters as much as the queue itself. A user who cannot tell whether their order went through will re-order or leave.

## Low-end device support

Target smooth performance on **~2GB RAM Android devices**. Budget animation accordingly: prefer lightweight vector loops over heavy Lottie/Rive compositions, especially on list-heavy screens.

| Budget | Target |
|---|---|
| Cold start to interactive | ≤3s on the low-end profile |
| List scroll | No dropped frames on a 50-item listing feed |
| Memory | No OOM kill during a full browse → cart → checkout loop |
| APK size | Kept small deliberately — download cost is real on metered data |

## Test device ≠ target device

The developer's physical QA device is a **Redmi Turbo 4 Pro** (Snapdragon 8s Gen 4, 12/16GB LPDDR5X). That is a current-generation, high-RAM device, far above the Phase 1 target baseline of 2–4GB RAM budget Android.

Treat it as a **functional and UX sanity check** — does the flow work at all, does it feel right on decent hardware. Never as evidence that the 2–4GB target is met.

> "Runs fine on the Redmi Turbo 4 Pro" is not a performance sign-off. It is a smoke test.

Low-end performance is verified separately, against emulator profiles or a device farm standing in for actual target hardware, before any performance claim is signed off. See [testing strategy](../workflow/testing-strategy.md).

## SMS fallback

Order confirmations, OTPs, and critical status changes go via **SMS as well as push**. Feature phones and low-data users are a real segment, not an edge case.

| Event | Push | SMS |
|---|---|---|
| OTP / login | — | Required |
| Order confirmed | Yes | Required |
| Payment received | Yes | Required |
| Delivery status change (out for delivery, delivered) | Yes | Required |
| Promotional | Yes | Never |

SMS is not a retry-on-push-failure mechanism for these events; it is sent alongside. Push delivery cannot be confirmed reliably enough to gate a compliance-relevant notification on it.

## Scale target (Phase 1)

Design for **single-city concurrent load — tens of thousands of DAU**. Not global scale.

Over-engineering for a scale that does not exist is tech debt, not future-proofing. Concretely, Phase 1 does not get: service mesh, multi-region, sharding, event-sourcing, a message broker, or a read-replica topology. The modular monolith and a single Postgres primary are correct at this size ([ADR-0002](../adr/0002-modular-monolith.md)).

What *is* in scope at this size: connection pooling, Redis caching on hot read paths, rate limiting, sensible indexes, and the PostGIS GIST indexes the radius search depends on.

## Data consistency

Order and Transaction state changes **must be transactional**. A payment confirmation and an order-status update can never desync — especially with COD-to-digital reconciliation.

Rules:

1. Order status change + Transaction write happen in **one database transaction**. No "write the payment, then update the order" across two calls.
2. Payment webhooks are **idempotent** — enforced by `UNIQUE (aggregator, aggregator_ref)` on `transaction`. Aggregators retry; duplicates must be inert.
3. Status transitions are **append-only events** (`order_status_event`), not column overwrites. The timeline is retained evidence (compliance C10).
4. No cache-first writes. Redis is derived state; anything in it must be rebuildable from Postgres.

## Security baseline

- KYC documents and NID data in access-restricted storage, never in the public media bucket, never inline in the database
- No client-supplied price, status, role, or advance amount is ever trusted — all recomputed server-side
- Secrets via GitHub Actions secrets and repo environment config, not committed `.env` files ([workflow](../workflow/github-workflow.md))
- Rate limiting on OTP issuance, login, and order creation
