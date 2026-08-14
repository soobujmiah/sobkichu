# sobkichu

**Bangladesh hyperlocal super-app** — one unified app with dynamic role switching (Customer, Merchant, Provider/Rider, Professional, Community), built Bangla-first for Bangladeshi geography, payment rails, connectivity conditions, and regulation.

This repository is the **single source of truth** for the project. Code, build, debug, and test all happen through GitHub (Actions / Codespaces) — there is no canonical local copy.

## Contents

| Path | Purpose |
|---|---|
| [`MASTER_PROMPT.md`](MASTER_PROMPT.md) | The persistent master prompt / architecture specification. **Read this first** — it governs everything else. |
| [`docs/`](docs/README.md) | Documentation set — architecture, data model, compliance, UX, workflow, ADRs |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to work in this repo, and the rules that get broken most |
| `docs/sobkichu.pdf` | Original PDF source of the master prompt |

### Start here

- **New to the project:** [architecture overview](docs/architecture/overview.md) → [canonical data model](docs/data-model/canonical-model.md) → [roadmap](docs/roadmap.md)
- **Building something:** [compliance matrix](docs/compliance/compliance-matrix.md) → [accessibility baseline](docs/ux/accessibility-baseline.md) → [contributing](CONTRIBUTING.md)
- **Why is it like this:** [ADRs](docs/adr/README.md)

## Current scope

**Phase 1 (MVP)** is the active scope unless a task explicitly names a later phase:
Customer mode + Merchant mode, hyperlocal e-commerce + service booking, bKash/Nagad + COD payment, single-city launch (design for Dhaka, generalize later). Anything beyond Phase 1 built early ships dark behind a feature flag.

## Locked tech stack

- **Mobile:** Flutter (Android-priority; target 2–4GB RAM devices)
- **Backend:** Node.js + NestJS
- **Database:** PostgreSQL + PostGIS, Redis for cache/session/rate-limiting
- **Search:** Postgres full-text (no Elasticsearch/Meilisearch until Phase 2+ justifies it)
- **Media:** S3-compatible object storage with aggressive upload-time compression
- **Notifications:** FCM push + **mandatory SMS fallback**
- **Payments:** licensed local aggregator (SSLCommerz / ShurjoPay / direct bKash–Nagad merchant APIs) — no custom stored-value wallet without flagging Bangladesh Bank licensing

Deviations from this stack must be stated explicitly, never silently substituted. See `MASTER_PROMPT.md` §3–§4.

## Non-negotiables

- **Bangla-first** — every user-facing string routes through a translation key; legal/policy text must be available in Bangla (Digital Commerce Operation Guidelines 2021).
- **Low-literacy accessibility baseline** — icon-first navigation, voice input, large touch targets, across *every* role.
- **Offline tolerance** — browse and cart building work offline with sync-on-reconnect.
- **Compliance in the schema** — advance-payment 10%/100%-escrow rule, 5-day/10-day delivery clock, NID KYC, BRTA verification. See the [compliance matrix](docs/compliance/compliance-matrix.md).
- **Test device ≠ target device** — a pass on the Redmi Turbo 4 Pro is a smoke test, never a performance sign-off against the 2–4GB RAM target.

## Documentation map

```
docs/
  architecture/   overview · backend-modules · mobile-app
  data-model/     canonical-model · phase-1-schema.sql · extension-rules
  localization/   bangladesh-localization · i18n-conventions
  ux/             accessibility-baseline
  compliance/     regulatory-context · compliance-matrix
  engineering/    non-functional-requirements
  workflow/       github-workflow · testing-strategy
  adr/            0001–0005
  glossary.md · roadmap.md
```

## Status

Phase 1, pre-code. The specification and documentation set are in place; the Flutter and NestJS codebases are not yet scaffolded. `docs/data-model/phase-1-schema.sql` is the ready-to-apply starting schema.
