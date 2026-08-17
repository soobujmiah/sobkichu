# Current State

Read this first, every session. Governed by [`MASTER_PROMPT.md`](MASTER_PROMPT.md); process rules in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Status

**Phase 1 (MVP), backend in progress.** Full documentation set, dev environment, and CI have been in place since the initial commits. The NestJS API is now real code with a working vertical slice — not just scaffolding. The Flutter mobile app (`mobile/`) does not exist yet.

Root `README.md`'s "Status" line and CI table still say "pre-code" / "api-ci skips until `api/`" — that's now stale text, not current fact. `api-ci` self-detects `api/package.json` and has been running for real since the first `api/` commit. Fix the README wording next time it's touched; not urgent enough to justify a docs-only PR on its own.

## What's built (api/)

The order lifecycle runs end-to-end against real PostgreSQL: **authenticate → create order → pay (settlement webhook) → confirm → delivery clock starts → notify.** 195 tests green in CI (179 unit + 16 integration) as of the last commit.

- **Identity**: phone OTP auth (E.164 normalized), global `APP_GUARD`, `@Public()` opt-out, Redis rate limiting, session tokens signed with `node:crypto` (no JWT lib — deliberate, stack-locked)
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
- Role switching (`activeRoleId` exists on the token; nothing sets it yet)
- Catalog/listing write paths, merchant onboarding + NID KYC flow, GPS radius discovery, offline cart sync, Central Admin Panel, accessibility pass — i.e. most of the Phase 1 DoD checklist in [`docs/roadmap.md`](docs/roadmap.md)
- `mobile/` (Flutter) — nothing scaffolded yet
- `api/package-lock.json` — not committed. CI falls back to `npm install` and prints a reproducibility warning on every run. Generate and commit one on the next `api/` PR.

## Recent changes (most recent first)

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

Full history: `git log` on `main` (all commits currently on `main`, no open feature branches).

## Next immediate steps

1. Wire a real aggregator client to *initiate* payment (SSLCommerz/ShurjoPay/bKash-Nagad direct — see ADR-0004), not just receive settlement webhooks
2. Scaffold `catalog` module's write path (listing creation, `ready_to_ship` flag) — merchant mode needs this before anything else in the roadmap DoD
3. Merchant NID KYC flow
4. Generate and commit `api/package-lock.json`
5. Update root `README.md` Status section and CI table (stale "pre-code" wording)
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
