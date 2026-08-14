## What this changes

<!-- Lead with the decision and the trade-off, not a restatement of the spec. -->

## Phase

- [ ] Phase 1 (default active scope)
- [ ] Later phase — **flag-gated and off by default**, justification below

## Checklist

<!-- From CONTRIBUTING.md. Delete rows that genuinely don't apply. -->

- [ ] Scoped to what was asked — no adjacent features "for completeness"
- [ ] Extends the canonical model (User/Role/Listing/Order/Transaction/Location); no parallel tables
- [ ] **Deviations** from the locked stack stated in one line below, with an ADR if significant
- [ ] No hardcoded user-facing strings — in Bangla *or* English
- [ ] New `legal.*` / `checkout.terms.*` keys present in `bn`
- [ ] Order/Transaction state changes happen in a single database transaction
- [ ] Accessibility baseline applied, for **every** role the change touches
- [ ] Compliance regression tests still green

## Compliance impact

<!-- If this touches payment, delivery timing, or user-generated content,
     name the affected rows from docs/compliance/compliance-matrix.md.
     Write "none" if genuinely unaffected. -->

## Deviations

<!-- Any departure from the locked stack or a new NFR trade-off. One line.
     Silent substitution is the failure mode this section exists to prevent. -->

## Device testing

<!-- Which profile did you verify on?
     A pass on the Redmi Turbo 4 Pro is a functional smoke test and is
     explicitly NOT a performance sign-off against the 2-4GB RAM target. -->

- [ ] Functional check (Redmi Turbo 4 Pro or equivalent)
- [ ] Low-end profile check (≤2GB RAM) — required for changes to list rendering, animation, image loading, startup, or cache size
- [ ] N/A (no UI or performance surface)
