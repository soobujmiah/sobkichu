# Contributing to Sobkichu

The [master prompt](MASTER_PROMPT.md) governs. This document is the practical checklist for working inside it. Where the two disagree, the master prompt wins.

## Before you start

1. Read the [architecture overview](docs/architecture/overview.md) and the [canonical data model](docs/data-model/canonical-model.md)
2. Confirm your work is **Phase 1**. If it isn't, it must be flag-gated and off by default
3. If it touches payment, delivery timing, or user-generated content, read the [compliance matrix](docs/compliance/compliance-matrix.md) first

## Environment

There is no canonical local copy of this project. Use **Codespaces** with the repo's devcontainer — it provides Flutter + Node + PostgreSQL/PostGIS + Redis with no manual setup. Build, test, and interactive debugging happen in a GitHub-connected environment, not on a personal machine. See the [GitHub workflow](docs/workflow/github-workflow.md).

Secrets come from GitHub Actions secrets and repo environment config. A committed `.env` is a security incident.

## The rules that get broken most

**1. Scope to what was asked.** Building the merchant onboarding flow means building that — not also generating rider dispatch "for completeness." Cross-reference other roles only where the data model requires it.

**2. Extend the canonical model.** User / Role / Listing / Order / Transaction / Location. No parallel `Booking2` or `Job` tables. See [extension rules](docs/data-model/extension-rules.md).

**3. State deviations explicitly.** Departing from the locked stack, or introducing a new NFR trade-off, needs one line in the PR saying so — and usually an [ADR](docs/adr/README.md). Silent substitution is the failure mode.

**4. No hardcoded strings — in either language.** Hardcoding Bangla is the same bug as hardcoding English. Everything routes through a translation key.

**5. The Redmi is not the target device.** "Runs fine on the Redmi Turbo 4 Pro" is a smoke test, not a performance sign-off. Name the low-end profile you measured on.

**6. Compliance goes in the schema, not the UI.** A rule enforced only in the client is not enforced. See [ADR-0005](docs/adr/0005-compliance-in-schema.md).

**7. Accessibility applies to every role.** Merchant onboarding gets the same low-literacy baseline as customer checkout.

## Branches and commits

Branches: `feat/<scope>-<name>`, `fix/<scope>-<name>`, `docs/<name>`.
Commits: conventional style — `feat(order): enforce advance-payment cap`. Scope matches the module or doc area.

`main` is protected: PR required, CI green, no direct pushes.

## Pull request checklist

- [ ] **Phase** stated — Phase 1, or flag-gated with justification
- [ ] **Deviations** from the locked stack stated in one line, with an ADR if significant
- [ ] **Compliance rows** named if this touches payment, delivery timing, or UGC
- [ ] Canonical model extended, not duplicated
- [ ] No hardcoded user-facing strings; new `legal.*` keys present in `bn`
- [ ] Order/Transaction changes are inside a single database transaction
- [ ] Compliance regression tests still green
- [ ] Accessibility checklist run, for every role the change touches
- [ ] **Device testing** stated — and a Redmi-only pass is explicitly not a performance sign-off

## For AI assistants working in this repo

Per master prompt §4 and §10.10: produce **complete, ready-to-commit file contents or clear diffs**. Do not install project dependencies, run the app, or execute a build/test cycle as part of generating a response — build and test happen in GitHub Actions and Codespaces.

Quick, dependency-free logic checks (tracing an algorithm, sanity-checking a snippet in isolation) are fine and often useful. They are not a substitute for a real build/test pass, and they never involve pulling in project dependencies.

Lead with the decision and the trade-off. Don't restate the master prompt back.
