# Sobkichu Documentation

Documentation index. The [master prompt](../MASTER_PROMPT.md) is the governing specification — everything here elaborates it, and nothing here overrides it. Where a doc and the master prompt disagree, the master prompt wins and the doc is a bug.

## How to read this

Start here if you are… | Read in this order
---|---
New to the project | [Architecture overview](architecture/overview.md) → [Data model](data-model/canonical-model.md) → [Roadmap](roadmap.md)
Building a Phase 1 feature | [Data model](data-model/canonical-model.md) → [Compliance matrix](compliance/compliance-matrix.md) → [Accessibility baseline](ux/accessibility-baseline.md)
Setting up to contribute | [Contributing](../CONTRIBUTING.md) → [Dev workflow](workflow/github-workflow.md)
Making a design decision | [ADR index](adr/README.md) → write a new ADR

## Map

### Architecture
- [Overview & system context](architecture/overview.md) — services, boundaries, request flow
- [Backend module layout](architecture/backend-modules.md) — NestJS domain split
- [Mobile app structure](architecture/mobile-app.md) — Flutter layering, offline strategy

### Data
- [Canonical data model](data-model/canonical-model.md) — User, Role, Listing, Order, Transaction, Location
- [Phase 1 schema DDL](data-model/phase-1-schema.sql) — PostgreSQL + PostGIS
- [Extension rules](data-model/extension-rules.md) — how to add entities without forking the model

### Localization
- [Bangladesh localization](localization/bangladesh-localization.md) — geography, address hierarchy, currency, payments
- [i18n conventions](localization/i18n-conventions.md) — translation keys, no hardcoded strings

### UX
- [Accessibility & low-literacy baseline](ux/accessibility-baseline.md) — the design floor for every role

### Compliance
- [Regulatory context](compliance/regulatory-context.md) — the landscape (informational, not legal advice)
- [Compliance matrix](compliance/compliance-matrix.md) — each rule mapped to the field/logic that enforces it

### Engineering
- [Non-functional requirements](engineering/non-functional-requirements.md) — offline, low-end devices, SMS, scale, consistency
- [GitHub-centric workflow](workflow/github-workflow.md) — Actions, Codespaces, devcontainer, secrets
- [Testing strategy](workflow/testing-strategy.md) — including the test-device ≠ target-device rule

### Decisions
- [ADR index](adr/README.md) — architecture decision records

### Reference
- [Glossary](glossary.md) — BD-specific and project-specific terms
- [Roadmap](roadmap.md) — phase gating and what "done" means per phase

## Documentation rules

1. **Phase 1 unless stated.** Any doc describing later-phase behaviour must say so in its first paragraph and mark the feature as flag-gated.
2. **Don't restate the master prompt.** Link to the relevant section instead. Docs add specifics (schemas, flows, decisions) the prompt deliberately leaves open.
3. **Decisions go in ADRs, not prose.** If you find yourself explaining *why* an alternative was rejected inside a how-to doc, that belongs in an ADR.
4. **Compliance claims cite the rule.** Reference the guideline/act by name, and mark anything needing legal sign-off explicitly — never present it as settled.
5. **Diagrams are Mermaid, in-repo.** No external image hosts; diagrams must survive a repo clone and render on GitHub.
