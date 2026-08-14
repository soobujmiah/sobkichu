# GitHub-Centric Workflow

Master prompt §4. **The GitHub repo is the single source of truth.** There is no canonical local copy of this project — code, build, debug, and test all happen through GitHub, not on any one machine.

## Why this is written down

Two people (or an AI and a person) working from different local environments produce drift that nobody can reproduce. Making GitHub authoritative means a green CI run is a fact about the project, not a fact about someone's laptop.

## The AI's role: brain, not build environment

When an AI assistant produces code under the master prompt, it outputs **complete, ready-to-commit file contents** — or a clear diff against a file already in the repo. It does **not** install project dependencies, run the app, or execute a build/test cycle as part of generating a response.

Build, debug, and test happen in GitHub (Actions and/or Codespaces). Not locally, and not inside an AI session sandbox.

**Narrow exception:** quick, dependency-free logic checks — tracing an algorithm, sanity-checking a snippet's output in isolation — are fine when they help verify correctness before handing code over. That is never a substitute for a real build/test pass, and never involves pulling in project dependencies.

## CI/CD

Lint, build, and test run via **GitHub Actions**, for both Flutter and Node/NestJS.

| Workflow | Does | Active now? |
|---|---|---|
| [`schema-ci.yml`](../../.github/workflows/schema-ci.yml) | Applies the Phase 1 schema to real PostGIS, runs [`schema_assertions.sql`](../../tools/schema_assertions.sql) — 22 compliance and integrity assertions | **Yes** |
| [`i18n-check.yml`](../../.github/workflows/i18n-check.yml) | Bangla coverage (fails on missing `bn` legal keys) + hardcoded-string scan | **Yes** (no-ops until `locales/` and source exist) |
| [`docs-ci.yml`](../../.github/workflows/docs-ci.yml) | Internal Markdown link and anchor check | **Yes** |
| [`api-ci.yml`](../../.github/workflows/api-ci.yml) | NestJS: lint → typecheck → unit → integration, with Postgres/PostGIS + Redis services | Skips until `api/` exists |
| [`mobile-ci.yml`](../../.github/workflows/mobile-ci.yml) | Flutter: format → analyze → test → split-ABI release APK with size reporting | Skips until `mobile/` exists |

The two application workflows detect their codebase and no-op cleanly, so they were merged ahead of the code rather than waiting.

**`schema-ci.yml` is the one that matters most right now.** It is [ADR-0005](../adr/0005-compliance-in-schema.md) under test: it proves the advance-payment cap, the delivery clock, category gating and webhook idempotency are enforced by the database, not by a UI that any caller can bypass. Drop the `advance_within_cap` constraint and CI goes red.

Branch protection on `main`: no direct pushes, PR required, CI must be green.

## Interactive debugging

Happens in a **GitHub-connected environment** — Codespaces — not on a personal machine. The point is that the debugging environment is defined in the repo and identical for everyone who opens it.

## Devcontainer

A `.devcontainer` config lets a GitHub-connected environment spin up **Flutter + Node + PostgreSQL/PostGIS + Redis** with no manual local setup.

Generated setup instructions point here first. Not to "install X on your machine."

Contents ([`.devcontainer/`](../../.devcontainer/)):

| Component | Purpose |
|---|---|
| Flutter SDK (pinned) | Mobile analyze and test |
| Node.js 20 | NestJS API |
| PostgreSQL 16 + PostGIS 3.4 | System of record, geo queries |
| Redis 7 | Cache, sessions, rate limits |
| [`post-create.sh`](../../.devcontainer/post-create.sh) | Applies the Phase 1 schema and seed, installs deps if the codebases exist |
| [`seed.sql`](../../.devcontainer/seed.sql) | Dhaka-area locations, categories, merchants and listings |

The seed is built to exercise the awkward paths, not just the happy one: a listing with **no GPS point** (manual address fallback), a **not-ready-to-ship** listing (10% advance cap), a **Chattogram** location (10-day delivery clock), a merchant **mid-KYC** who must not be able to publish, and one human holding **both** customer and merchant roles.

The Android SDK is deliberately not in the image — CI builds the APK, and leaving it out keeps the container an order of magnitude smaller to spin up.

## Config and secrets

**GitHub Actions secrets and repo-level environment configuration are the primary mechanism.** Generated CI config references them directly; do not assume a local `.env` file is the only path.

| Secret | Used by |
|---|---|
| `PAYMENT_AGGREGATOR_KEY` / `_SECRET` | API — payment integration |
| `SMS_GATEWAY_KEY` | API — SMS fallback |
| `FCM_SERVER_KEY` | API — push |
| `NID_VERIFY_API_KEY` | API — merchant KYC |
| `DATABASE_URL` | CI services / deploy environments |

A committed `.env` is a security incident, not a convenience. `.env` is in `.gitignore`; `.env.example` documents required keys with empty values.

## Physical test device

A **Redmi Turbo 4 Pro** (Snapdragon 8s Gen 4, 12/16GB LPDDR5X RAM) is the developer's hands-on QA device.

It is a current-generation, high-RAM chipset — well above the Phase 1 target baseline of 2–4GB RAM budget Android devices. Treat it as a functional/UX sanity check, **never** as evidence that the low-end performance target is met. See [testing strategy](testing-strategy.md).

## Branching and commits

| Branch | Purpose |
|---|---|
| `main` | Always deployable, protected |
| `feat/<scope>-<short-name>` | Feature work |
| `fix/<scope>-<short-name>` | Bug fixes |
| `docs/<short-name>` | Documentation only |

Commits: conventional-commit style (`feat(order): enforce advance-payment cap`). Scope matches the module or doc area, so history is greppable by domain.

## Pull requests

Every PR states:

1. **Phase** — Phase 1 unless explicitly justified; later-phase work must be flag-gated
2. **Deviations** — any departure from the locked stack or a new NFR trade-off, in one line
3. **Compliance impact** — if it touches payment, delivery timing, or user-generated content, name the affected [compliance matrix](../compliance/compliance-matrix.md) rows
4. **Device testing** — which profile it was verified on; a Redmi-only pass is explicitly not a performance sign-off
