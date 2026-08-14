# Compliance Matrix

**Informational — not legal advice.** Bangladesh's digital commerce and cyber law landscape has changed more than once in recent years. Verify current requirements with local counsel before launch. This document exists so that compliance lives in the schema and the code path, not in a footnote.

Each row maps a rule to the **specific field or code path that enforces it**, so a reviewer can check enforcement rather than take it on trust.

## Digital Commerce Operation Guidelines 2021 (Ministry of Commerce)

| # | Rule | Enforced by | Where | Status |
|---|---|---|---|---|
| C1 | Advance payment capped at **10%** of product price… | `app_order.advance_cap_bdt`, computed server-side; `CHECK (advance_amount_bdt <= advance_cap_bdt)` | [`phase-1-schema.sql`](../data-model/phase-1-schema.sql) | Schema done, API pending |
| C2 | …unless item is **"ready to ship"** (deliverable ≤72h), which permits higher advance | `listing.ready_to_ship`, snapshotted per line as `order_item.ready_to_ship_at_order` | same | Schema done |
| C3 | …or payment runs through a **Bangladesh Bank–approved escrow service**, permitting 100% advance | `app_order.is_escrow` | same | Schema done; escrow provider selection needs legal sign-off |
| C4 | Delivery within **5 days same city, 10 days different city**, from advance payment | `app_order.is_same_city`, `advance_paid_at`, `delivery_deadline_at` | same | Schema done |
| C5 | Delivery timeline must be **buyer-visible** | Order tracking screen surfaces `delivery_deadline_at` as a countdown, in Bangla | [accessibility baseline](../ux/accessibility-baseline.md) | UX spec'd |
| C6 | Refund/return/delivery terms displayed **in Bangla**, clearly, on listing/checkout | Terms rendered from `bn` locale bundle; checkout blocks if the merchant's terms lack a `bn` translation | [i18n conventions](../localization/i18n-conventions.md) | Rule defined |
| C7 | Prohibited: **MLM / network marketing** | No referral-commission-tree structures anywhere in the product. Architectural prohibition, not a config flag. | — | Enforced by design |
| C8 | Prohibited: **lottery / gambling** | `category.is_restricted` blocks listing creation | schema | Schema done |
| C9 | **Medicine/healthcare** products require DGDA licensing | `category.requires_dgda_licence`; gates Phase 3 pharmacy/health features | schema | Deferred to Phase 3, flag off |
| C10 | Business data **retained for a minimum period**, producible to government on request | Append-only `order_status_event`; Orders and Transactions are never hard-deleted | schema | Schema done; retention period needs counsel confirmation |

### The advance-payment rule, as code

```
advance_cap = (is_escrow OR all_items_ready_to_ship)
                ? total_bdt
                : floor(total_bdt * 0.10)
```

Implemented in [`api/src/order/domain/advance-cap.ts`](../../api/src/order/domain/advance-cap.ts), applied in [`order.service.ts`](../../api/src/order/order.service.ts).

Computed at order creation from server-side data only. A client-supplied advance amount is validated against it and rejected on breach — never clamped silently, because a silent clamp hides a merchant misconfiguring `ready_to_ship`.

Four implementation decisions, all of which need counsel confirmation:

| Decision | What we do | The alternative |
|---|---|---|
| **Mixed cart** | One non-ready item caps the **whole order** at 10% | Per-line caps summed, allowing 100% on the ready items |
| **Basis** | 10% of the order **total including delivery fee** | 10% of goods subtotal only, which permits a larger advance |
| **Rounding** | `floor` — always **down** | `round`, which could authorise a fraction above the ceiling |
| **Escrow** | Only for an **admin-configured** approved provider; defaults off | Per-merchant self-declaration |

Each is the more restrictive reading. If counsel disagrees on any of them, the change is confined to `computeAdvanceCap` and its callers.

## Bangladesh Bank

| # | Rule | Our position |
|---|---|---|
| B1 | Digital wallets, stored value, and alternative payment mechanisms need Bangladesh Bank approval | **We do not build a wallet.** Payments integrate via a licensed aggregator (SSLCommerz / ShurjoPay) or direct bKash/Nagad merchant APIs. See [ADR-0004](../adr/0004-payments-via-licensed-aggregator.md). |
| B2 | Escrow must be a Bangladesh Bank–approved service for the 100%-advance path | `is_escrow` may only be set for an approved provider configured at the admin level, never per-merchant self-declaration. Provider choice needs legal sign-off before launch. |

Any proposal that stores customer balance inside our system — including "credits", "points redeemable for value", or a merchant float — triggers B1 and must be flagged for legal review before design, not after.

## Identity and vehicle verification

| # | Rule | Enforced by | Phase |
|---|---|---|---|
| K1 | **NID-based KYC** for Merchant onboarding | `role.kyc_status`, `app_user.nid_verification_status`; merchants cannot publish listings until `verified` | 1 |
| K2 | NID KYC for Rider onboarding | same fields, rider role | 2 |
| K3 | **BRTA verification** of driving licence / vehicle registration where the vehicle type requires it | `role.profile` BRTA refs, verified before dispatch eligibility | 2 |

KYC document blobs live in object storage with restricted access, never in the public media bucket, and never inline in the database.

## Cyber law

Bangladesh's framework has moved: Digital Security Act (2018) → Cyber Security Act (2023) → **Cyber Security Ordinance (2025)**, the current framework as of this writing. It governs content moderation, data-offense liability, and platform obligations for user-generated content.

Relevance is mostly **Phase 3–4** (Community Hub, notice board, marketplace reviews). This space has moved roughly every two years — **re-verify current status before building any moderation or takedown workflow**. Do not implement moderation tooling against the 2025 ordinance from memory; check it at build time.

Phase 1 exposure is limited but non-zero: merchant-authored listing text and (if enabled) customer reviews are user-generated content. Minimum Phase 1 posture — a report path and an admin takedown capability in the Central Admin Panel.

## Tax

| # | Rule | Our position |
|---|---|---|
| T1 | VAT per **National Board of Revenue (NBR)** requirements | The tax engine integrates NBR rules; a generic percentage-tax placeholder is not acceptable even as a stub. If Phase 1 ships before NBR integration, tax must be explicitly out of scope and visible as such, not silently approximated. |

## Review triggers

Re-read this matrix and re-verify with counsel when any of these happen:

- A new payment method, escrow provider, or anything holding customer value
- Any user-generated content surface (reviews, community posts, chat)
- Healthcare, pharmacy, or licensed-professional listings (Phase 3)
- Phase transition — each phase widens regulatory surface
- Annually at minimum; this landscape has moved roughly every two years
