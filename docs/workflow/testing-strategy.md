# Testing Strategy

Testing runs in GitHub (Actions / Codespaces), not on a personal machine. See [GitHub workflow](github-workflow.md).

## Test pyramid

| Level | Scope | Where |
|---|---|---|
| Unit | Pure logic — advance-cap calculation, delivery-clock arithmetic, address normalization, search transliteration | Both codebases, every PR |
| Integration | API + real Postgres/PostGIS + Redis as CI services | `api-ci.yml` |
| Contract | Payment aggregator and SMS gateway responses, including retries and duplicate webhooks | Recorded fixtures |
| Widget | Flutter screens against the accessibility checklist | `mobile-ci.yml` |
| Manual / device | Real-device functional pass, then a separate low-end pass | Redmi + low-end profile |

## Compliance regression tests

These are not optional and they are not ordinary unit tests — they encode legal obligations. Each maps to a row in the [compliance matrix](../compliance/compliance-matrix.md).

| Test | Asserts | Row |
|---|---|---|
| Advance cap, standard item | Order with a non-`ready_to_ship` item rejects an advance above 10% of total | C1 |
| Advance cap, ready-to-ship | All items `ready_to_ship` → 100% advance permitted | C2 |
| Advance cap, escrow | `is_escrow` → 100% advance permitted regardless of ready-to-ship | C3 |
| Advance cap, mixed cart | One non-ready item in the cart → the 10% cap applies to the whole order | C1/C2 |
| Delivery clock, same city | `delivery_deadline_at` = `advance_paid_at` + 5 days | C4 |
| Delivery clock, different city | = `advance_paid_at` + 10 days | C4 |
| Clock not started without payment | No `advance_paid_at` → `delivery_deadline_at` is null | C4 |
| Bangla legal text present | Every `legal.*` and `checkout.terms.*` key exists in `bn` | C6 |
| Restricted category blocked | Listing creation in a restricted category fails | C8 |
| Order history retained | Cancelled/refunded orders and their event timeline are not hard-deleted | C10 |
| Webhook idempotency | Duplicate aggregator webhook produces exactly one Transaction | consistency |
| Order/Transaction atomicity | Injected failure mid-write leaves no order confirmed without its transaction | consistency |

A change that breaks one of these is a compliance regression, not a failing test. It does not get a `skip`.

## Offline and connectivity tests

| Scenario | Expected |
|---|---|
| Launch in airplane mode | Cached catalog and order state render |
| Add to cart offline, kill app, relaunch | Cart intact |
| Place order with network dropped mid-request | Action queued, visibly, and retried on reconnect |
| Reconnect after a price change | Server state wins; user is told plainly |
| Throttled 3G profile | Core loop completes without a dead-end spinner |

## Device testing — the rule that gets broken

The **Redmi Turbo 4 Pro is not the target device.** It is a Snapdragon 8s Gen 4 with 12–16GB RAM; the Phase 1 target is 2–4GB RAM budget Android.

| Device | Answers | Does not answer |
|---|---|---|
| Redmi Turbo 4 Pro | Does the flow work? Does it feel right? Any functional bug? | Anything about performance on target hardware |
| Low-end profile (≤2GB RAM emulator or device-farm equivalent) | Cold start, scroll smoothness, memory pressure, OOM behaviour | — |

**No performance claim is signed off on the Redmi pass alone.** Any PR asserting a performance improvement states which low-end profile it was measured on. "Feels fast" on flagship hardware is not evidence.

Low-end pass required before merge when a change touches: list rendering, animation, image loading, app startup, or local cache size.

## Accessibility testing

Every UI-facing PR runs the [accessibility checklist](../ux/accessibility-baseline.md), for every role — merchant flows included.

Automatable in widget tests: touch target sizes, contrast ratios, absence of hardcoded strings, presence of a text alternative for every icon-only control.

Not automatable, still required: can a first-time low-literacy user complete the core loop? That needs a human, periodically, with a real user — not a developer imagining one.
