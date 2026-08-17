# Roadmap

Master prompt §2. **Do not build or design against the full feature set in one pass.** Unless a task explicitly names a later phase, Phase 1 is the active scope.

Anything beyond Phase 1 that gets built early ships **behind a feature flag**, consistent with the Central Admin Panel model, so it can ship dark.

## Phase 1 — MVP (active)

**Build status:** this list is the definition of done, not a progress tracker — items stay unchecked until the full user-facing feature ships, not when a backend piece lands. For what is actually built right now, see [`CURRENT_STATE.md`](../CURRENT_STATE.md).

**Scope:** Customer mode + Merchant mode. Hyperlocal e-commerce + service booking only. bKash/Nagad + COD. Single city launch — design for Dhaka, generalize later.

**Rationale:** proves the core discovery → order → fulfillment loop before anything else.

Definition of done:

- [ ] Customer: GPS radius discovery (1–10 km) **with** manual address fallback down the BD hierarchy
- [ ] Customer: browse offline from cache, build a cart offline, queue "place order" through a network drop
- [ ] Customer: checkout with bKash/Nagad/COD; advance cap enforced server-side; refund/delivery terms shown in Bangla before payment
- [ ] Customer: order tracking with a buyer-visible delivery deadline
- [ ] Merchant: NID KYC before publishing; listing creation with `ready_to_ship`; order management
- [ ] Both: SMS alongside push for OTP, confirmation, and status changes
- [ ] Admin: Central Admin Panel with feature flags and a content takedown path
- [ ] All compliance regression tests green ([testing strategy](workflow/testing-strategy.md))
- [ ] Accessibility checklist passed for **every** role, not just Customer
- [ ] Low-end device pass completed separately from the Redmi QA pass
- [ ] Bangla present for every legal key; no hardcoded strings in either language

Explicitly **not** in Phase 1: rider dispatch, Digital Khata depth, professional/rental modes, healthcare, community features, multi-city, multi-currency, custom wallet.

## Phase 2 — Provider/Rider mode

**Scope:** delivery + on-demand technicians. Digital Khata / POS depth for merchants.

**Rationale:** requires Phase 1's order volume to be worth dispatching against.

Seams already in place: `role_type.rider`, nullable `app_order.rider_role_id`, `transaction` separated from `app_order` so the ledger can reference it independently, `dispatch` and `ledger` module boundaries.

New compliance surface: BRTA licence/vehicle verification, rider NID KYC.

## Phase 3 — Professional / Skilled Worker / Rental

**Scope:** professional and rental modes, healthcare booking, consultant booking.

**Rationale:** higher trust and compliance bar — health data, licensed professionals — so it needs the Phase 1–2 trust foundation.

New compliance surface: DGDA licensing for medicine/healthcare (`category.requires_dgda_licence` is already there), professional credential verification, health data handling.

Extends `Listing` and `Order`. Does **not** create parallel `Booking2` or `Job` tables ([extension rules](data-model/extension-rules.md)).

## Phase 4 — Community Hub

**Scope:** artisans, emergency hub, notice board, recycling exchange, crowdfunding.

**Rationale:** network-effect features that need an existing user base to be useful at all.

New compliance surface: this is where user-generated content becomes central, bringing Cyber Security Ordinance 2025 obligations for moderation, takedown, and data-offense liability. **Re-verify the current framework before building any of it** — this space has moved roughly every two years. Crowdfunding additionally raises Bangladesh Bank questions about holding funds ([ADR-0004](adr/0004-payments-via-licensed-aggregator.md)).

## Phase gating rules

1. A later-phase feature built early is flag-gated and off by default
2. Each phase transition triggers a compliance matrix re-review — every phase widens regulatory surface
3. Later phases extend the canonical model; they do not fork it
4. "Design for Dhaka, generalize later" means the address hierarchy and geo model are already general — only the launch footprint is single-city. No Dhaka-specific hardcoding.
