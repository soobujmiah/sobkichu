# ADR-0005: Encode compliance rules in the schema, not the UI

**Status:** Accepted
**Date:** 2026-08-14

## Context

Several Digital Commerce Operation Guidelines 2021 rules are quantitative and order-specific: the 10%/100% advance-payment cap, and the 5-day/10-day delivery clock.

The path of least resistance is to enforce these in the checkout UI — grey out the amount field, show a delivery estimate. That satisfies a demo and fails an audit. A rule enforced only in the client is not enforced: any API caller, any older app version, any internal tool bypasses it, and there is no record of what was applied at the time.

The master prompt is direct about this: compliance is a **first-class constraint, not a footnote** — reflect Section 9 constraints "in the schema/logic itself" (§10.6).

## Decision

Compliance rules live in the data model and in server-side logic, with the UI as a presentation layer over them.

| Rule | Encoded as |
|---|---|
| Advance cap | `app_order.advance_cap_bdt` computed server-side; `CHECK (advance_amount_bdt <= advance_cap_bdt)` |
| Ready-to-ship basis for the cap | `listing.ready_to_ship`, snapshotted per line into `order_item.ready_to_ship_at_order` |
| Escrow path to 100% | `app_order.is_escrow`, settable only for an admin-configured approved provider |
| Delivery clock | `is_same_city`, `advance_paid_at`, `delivery_deadline_at` as columns, set in the same transaction as the advance payment |
| Restricted categories | `category.is_restricted`, `category.requires_dgda_licence` |
| Data retention / producibility | Append-only `order_status_event`; Orders and Transactions never hard-deleted |

Two supporting rules:

1. **Snapshot the basis, not just the outcome.** `ready_to_ship_at_order` records the state the cap was computed from. Without it, a merchant flipping the flag later makes past orders unexplainable.
2. **Reject, don't clamp.** An out-of-cap advance amount is rejected with an error, never silently reduced — a silent clamp hides a merchant misconfiguring `ready_to_ship`.

## Consequences

**Good:**

- The rule holds regardless of caller: mobile app, admin panel, script, or a stale client version
- An auditor can be shown a constraint and a column, not a code walkthrough
- Compliance regression tests assert against the database, so a breaking change fails CI ([testing strategy](../workflow/testing-strategy.md))
- The record survives merchant-side changes after the fact

**Bad, accepted:**

- Regulatory change means a migration, not a config edit. Given this framework has moved roughly every two years, that cost is real — and still cheaper than an unenforceable rule.
- Some duplication: the cap is computed in the API *and* guarded by a CHECK constraint. Deliberate. The constraint is the last line of defence, not the primary mechanism.
- Denormalised booleans (`is_same_city`, `all_items_ready_to_ship`) can drift from their sources if written carelessly. They are set once at order creation and never recomputed — they are evidence of what was decided then, not a live derivation.

## Alternatives rejected

**UI-only enforcement.** Fails for any non-app caller and leaves no auditable record. This is the failure mode the decision exists to prevent.

**Application-layer only, no DB constraints.** Better, but one buggy code path writes bad data permanently. The CHECK constraint costs nothing and makes the invariant unbreakable.

**A separate compliance-rules engine.** Over-engineered at Phase 1 scale for two quantitative rules. Worth revisiting if Phase 3 healthcare adds a genuinely complex, frequently-changing rule set.
