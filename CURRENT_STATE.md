# Current State

Read this first, every session. Governed by [`MASTER_PROMPT.md`](MASTER_PROMPT.md); process rules in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Status

**Phase 1 (MVP), backend in progress.** Full documentation set, dev environment, and CI have been in place since the initial commits. The NestJS API is now real code with a working vertical slice — not just scaffolding. The Flutter mobile app (`mobile/`) does not exist yet.

## What's built (api/)

The order lifecycle runs end-to-end against real PostgreSQL: **authenticate → create an address → register as merchant against it → switch into that role → publish a listing (denormalising its GPS position) → search nearby / create order → pay (settlement webhook) → confirm → delivery clock starts → notify.** 225 tests green in CI (209 unit + 16 integration) as of the last commit.

- **Identity**: phone OTP auth (E.164 normalized), merchant onboarding (`POST /merchants` — registers the Role; relies on the `location` foreign key rather than adding identity → location as a new module dependency), role switching (`POST /auth/roles/switch` re-issues the token with a new `activeRoleId`, checked against roles the caller actually holds), global `APP_GUARD`, `@Public()` opt-out, Redis rate limiting, session tokens signed with `node:crypto` (no JWT lib — deliberate, stack-locked)
- **Location**: address creation (`POST /locations`) — BD Division→District→Upazila/Thana hierarchy, `unionWard`/`villageMohalla`/`addressLine` optional, GPS `lat`/`lng` optional but must be paired. No compliance gate (creating an address carries no legal weight until referenced as a pickup or delivery location, which is where the existing K1/C4 checks already live)
- **Catalog**: listing creation (`POST /catalog/listings`) — merchant KYC gate (K1), prohibited/DGDA category gates (C8/C9), owner and pickup location resolved server-side from the caller's active role, never from the request body. Creation also denormalises the pickup location's GPS coordinates onto `listing.geo` (via `LOCATION_PORT`, now exposing `lat`/`lng` alongside `hasGeo`). Radius search (`GET /catalog/listings/nearby`, public, 1–10 km, `ST_DWithin`) runs entirely against that column — no join back to `location`
- **Order**: create-order path, advance-payment cap (DCOG 2021, `src/order/domain/advance-cap.ts`), transaction boundary via `UnitOfWork` (`AsyncLocalStorage`-joined, not nested)
- **Payment**: settlement webhook, HMAC-verified, idempotent, starts the delivery clock
- **Notification**: transactional outbox — SMS is guaranteed-delivery alongside push, not best-effort
- **Ports** (`src/common/ports/`): catalog, location, merchant — `order` never touches another module's tables directly (ADR-0002)
- Money is integer poisha throughout (`src/common/money.ts`) — no floats near currency

Full narrative and rationale: [`api/README.md`](api/README.md).

## Not yet built

- Outbound aggregator calls to *initiate* payment (currently only receives settlement notices)
- Real SMS/FCM provider wiring (gateways log at WARN when unconfigured — intentional, so a misconfigured deploy is loud)
- A scheduler to actually run the notification dispatcher
- Merchant NID KYC submission flow (the `role.kyc_status` / `app_user.nid_verification_status` columns and the K1 gate exist; nothing sets either to `verified`) — this is now the actual blocker on exercising listing creation end-to-end with real data. A merchant can register (`POST /merchants`) and switch into the role, but cannot publish until KYC clears.
- The manual-address discovery path (category/hierarchy browse) that GPS radius search must always be paired with, per `docs/localization/bangladesh-localization.md` — "a discovery implementation that requires a GPS fix is incomplete, not merely degraded." Radius search alone is half of that DoD item.
- Listing read/update paths beyond radius search (no single-listing fetch, no edit, no list-my-listings, no deactivate)
- Offline cart sync, Central Admin Panel, accessibility pass — most of the rest of the Phase 1 DoD checklist in [`docs/roadmap.md`](docs/roadmap.md)
- `mobile/` (Flutter) — nothing scaffolded yet
- `api/package-lock.json` — not committed. CI falls back to `npm install` and prints a reproducibility warning on every run. Generate and commit one on the next `api/` PR (needs `npm install` in Codespaces/CI — do not run it locally, per `CONTRIBUTING.md` §"For AI assistants").

## Recent changes (most recent first)

- `feat(catalog)`: GPS radius search — `GET /catalog/listings/nearby`
- `feat(location)`: address creation — `POST /locations`
- `feat(identity)`: merchant onboarding — `POST /merchants`
- `feat(identity)`: role switching — `POST /auth/roles/switch`, `GET /auth/roles`
- `feat(catalog)`: listing creation, gated on merchant KYC and category rules
- `docs`: land CURRENT_STATE.md, point roadmap at it, fix stale README status
- `docs(api)`: 195 tests, authentication documented
- `fix(auth)`: fail-closed test was vacuous — fixed
- `refactor(auth)`: auth primitives moved to `common/`, Prettier fixed
- `feat(identity)`: phone OTP auth, global guard, Redis rate limiting
- `feat(notification)`: mandatory SMS via transactional outbox
- `feat(payment)`: settlement webhook — delivery clock now starts
- `feat(api)`: port adapters — order path reaches PostgreSQL
- `feat(order)`: NestJS shell — ports, transaction boundary, create-order path
- `feat(order)`: compliance core — advance-payment cap and delivery clock
- `ci`: devcontainer, CI workflows, executable compliance checks
- `docs`: full documentation set — architecture, data model, compliance, UX, workflow, ADRs

Full history: `git log` on `main`.

## Next immediate steps

1. Merchant NID KYC submission flow — sets `role.kyc_status` / `app_user.nid_verification_status`; needs a decision on document upload (S3-compatible storage is locked-stack but not wired up anywhere yet)
2. The manual-address discovery path (category/hierarchy browse, `GET /catalog/listings` with no `near` param) -- radius search alone is an incomplete implementation of the "GPS with mandatory manual fallback" DoD item
3. A single-listing fetch (`GET /catalog/listings/:id`) and "my listings" for a merchant -- catalog currently has create + search, no other reads
4. Wire a real aggregator client to *initiate* payment (SSLCommerz/ShurjoPay/bKash-Nagad direct — see ADR-0004), not just receive settlement webhooks
5. Generate and commit `api/package-lock.json`
6. First Flutter scaffold in `mobile/`, once there's enough API surface to bind a screen to

## Known blockers / open questions

Four compliance judgement calls await counsel sign-off (tracked in [`docs/compliance/compliance-matrix.md`](docs/compliance/compliance-matrix.md), each confined to `computeAdvanceCap` and callers if the answer changes):

- Mixed-cart advance-cap rule (currently: any non-`ready_to_ship` line item caps the *whole* order at 10%)
- Whether the 10% advance basis includes the delivery fee
- Rounding direction on the cap (currently rounds down — conservative)
- Escrow provider configuration

No infrastructure blockers. CI is green on `main`. Everything happens in Codespaces / GitHub Actions per [`docs/workflow/github-workflow.md`](docs/workflow/github-workflow.md) — there is no canonical local copy, so any local exploration (including this file's authoring) is read-only staging, not a dev environment.

## Key config / architecture decisions already locked

See ADRs for full rationale — do not relitigate without a new ADR:

- [ADR-0002](docs/adr/0002-modular-monolith.md): modular monolith, not microservices, at this phase
- [ADR-0003](docs/adr/0003-postgres-fts-before-search-engine.md): Postgres full-text search before Elasticsearch/Meilisearch
- [ADR-0004](docs/adr/0004-payments-via-licensed-aggregator.md): payments via licensed aggregator, no custom stored-value wallet
- [ADR-0005](docs/adr/0005-compliance-in-schema.md): compliance rules enforced in the schema (`CHECK` constraints), application logic is primary, schema is last line of defence

Stack is locked per root `README.md`: Flutter mobile, NestJS backend, PostgreSQL+PostGIS, Redis, Postgres FTS, S3-compatible storage, FCM+mandatory-SMS notifications. Deviations require an ADR and an explicit PR note — never silent substitution.
