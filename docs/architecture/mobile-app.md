# Mobile App Structure (Flutter)

**Scope: Phase 1** — Customer mode + Merchant mode in one app, with role switching. Flutter, single codebase; **Android matters far more** given BD device demographics.

Two constraints shape everything below and are not negotiable: the [low-literacy accessibility baseline](../ux/accessibility-baseline.md) and the ~2GB RAM device target.

## Layering

```
lib/
  core/
    i18n/           # translation key resolution, bn-first
    network/        # API client, retry, connectivity awareness
    offline/        # local cache + action queue
    design/         # tokens: touch targets, contrast, typography
  features/
    discovery/      # radius search, manual address fallback, voice input
    listing/        # listing detail
    cart/           # offline-capable cart
    checkout/       # payment method, Bangla terms, advance-cap display
    orders/         # tracking, delivery-deadline countdown
    merchant/       # onboarding/KYC, listing management, order management
    account/        # role switching, language, saved addresses
```

`core/offline` and `core/i18n` are used by every feature. A feature that bypasses them is a bug — that is how hardcoded strings and non-cached screens get in.

## Offline architecture

Two distinct mechanisms; conflating them causes the silent-failure bug this market cannot tolerate.

### Read cache

Every successful fetch writes to a local store. Catalog browsing and order state render from it when offline. Staleness is shown honestly ("last updated 2 hours ago") rather than presented as live.

### Action queue

Writes — place order, update listing, accept order — go into a **durable, user-visible queue**:

| Property | Requirement |
|---|---|
| Durable | Survives app kill (load-shedding), persisted to disk |
| Visible | The user always sees that an action is pending; never a spinner that resolves to nothing |
| Idempotent | Each queued action carries a client-generated key so a retry cannot double-create an order |
| Ordered per entity | Two edits to the same listing apply in order |
| Honest on conflict | If server state changed (price, stock), the user is told plainly in Bangla |

The client-generated idempotency key pairs with server-side webhook idempotency. Together they mean a flaky connection cannot produce duplicate orders — the specific failure that destroys trust in a market that has already been burned.

## Role switching

One User identity, multiple Role assignments. Switching is a UI mode change, not a re-login. Merchant mode gets the **same** accessibility baseline as customer mode — a merchant is not automatically a sophisticated user.

## Performance budget

Target: smooth on ~2GB RAM Android.

| Area | Rule |
|---|---|
| Animation | Lightweight vector loops over heavy Lottie/Rive compositions, especially on list-heavy screens |
| Lists | Lazy-built, recycled; no unbounded in-memory list of listings |
| Images | Server-compressed at upload; client requests sized variants, never originals |
| Startup | Defer non-critical initialization; ≤3s cold start to interactive on the low-end profile |
| Cache size | Bounded with eviction — a cache that grows unbounded is an OOM on a 2GB device |

Confirmation animations are one-shot and short. A janky confirmation reads as failure to a user who is unsure whether their order went through.

## Testing

Widget tests assert the mechanical parts of the accessibility checklist: touch target sizes, contrast, no hardcoded strings, a text alternative for every icon-only control.

Device testing follows the [test device ≠ target device](../workflow/testing-strategy.md) rule. The Redmi Turbo 4 Pro answers "does this work"; it never answers "is this fast enough." Any performance claim names the low-end profile it was measured on.
