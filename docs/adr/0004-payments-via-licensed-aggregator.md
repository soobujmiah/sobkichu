# ADR-0004: Payments via a licensed aggregator, no custom wallet

**Status:** Accepted
**Date:** 2026-08-14

## Context

The product needs bKash, Nagad, and Cash-on-Delivery in Phase 1. A stored-value wallet is the obvious-looking product move — it improves repeat-purchase friction, enables refunds as credit, and captures float.

It is also a regulated activity. **Any digital wallet, stored-value, or alternative payment mechanism needs Bangladesh Bank approval** (master prompt §9). Bangladesh's e-commerce sector has had well-publicised fraud scandals, several involving platforms holding customer money.

Separately, the Digital Commerce Operation Guidelines 2021 make escrow a *permission-granting* mechanism: payment through a **Bangladesh Bank–approved escrow service** is what allows 100% advance payment instead of the 10% cap.

## Decision

Integrate payments through a **licensed local payment aggregator** — SSLCommerz, ShurjoPay, or direct bKash/Nagad merchant APIs. Sobkichu never holds customer funds.

Concretely:

- No stored-value wallet, no platform balance, no credits redeemable for value, no merchant float held by us
- Refunds go back through the original payment rail, not into an internal balance
- `is_escrow` may only be set for an admin-configured, Bangladesh Bank–approved provider — never merchant self-declaration
- COD is a first-class method with a full Transaction lifecycle, not a degraded path
- Any future proposal that holds customer value goes to legal review **before** design

## Consequences

**Good:**

- Removes an entire licensing exposure from the critical path. Phase 1 can launch without a Bangladesh Bank approval process gating it.
- Aggregators absorb PCI-adjacent concerns and MFS integration maintenance
- Trust posture is defensible: "we never hold your money" is a real answer in a market that has been burned

**Bad, accepted:**

- Aggregator fees on every transaction, and a dependency on their uptime for the checkout path
- No float, and no wallet-driven retention mechanic
- Refunds are slower than an internal-credit refund would be — this must be communicated honestly in Bangla at checkout, not buried
- Reconciliation depends on aggregator webhooks, so idempotency (`UNIQUE (aggregator, aggregator_ref)`) and replay handling are our problem

**Escalation trigger:** any feature request phrased as "let users keep a balance", "store credit", "points worth taka", or "hold merchant payouts" is a Bangladesh Bank question first and a product question second. Flag it for legal review; do not design it and ask afterwards.

## Alternatives rejected

**Custom stored-value wallet.** Requires Bangladesh Bank approval, adds AML/KYC obligations well beyond merchant NID verification, and puts us in the category of platform that has generated the market's trust problem. Not viable for Phase 1 and questionable later.

**Direct MFS integration only, no aggregator.** Fewer fees, but every provider is a separate integration and a separate settlement reconciliation. Kept as a Phase 2+ optimisation once volume justifies it — the module boundary makes the swap contained.

**COD only.** Simplest and lowest regulatory surface, but ignores high digital wallet adoption and forecloses the escrow path that unlocks 100% advance for ready-to-ship items.
