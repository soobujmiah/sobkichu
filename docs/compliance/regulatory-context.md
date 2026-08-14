# Regulatory Context

**Informational — not legal advice.** Nobody on this project is a lawyer, and Bangladesh's digital commerce and cyber law landscape has changed more than once in the last few years. **Verify current requirements with local counsel before launch.**

This document is the narrative background. The enforcement mapping — which field or code path implements which rule — is in the [compliance matrix](compliance-matrix.md).

## Digital Commerce Operation Guidelines 2021

Issued by the Ministry of Commerce; the core e-commerce compliance framework. It came after a period of well-publicised platform failures in which customers paid in advance and never received goods, which explains its shape: most of it constrains **when a platform may take money and how long it has to deliver**.

Architectural implications:

**Advance payment.** Capped at 10% of product price, unless the item is "ready to ship" (deliverable within 72 hours), or unless payment runs through a Bangladesh Bank–approved escrow service — in which case 100% advance is allowed. This directly shapes the Order/Transaction/payment-timing model: the system must know **per listing** whether stock is ready to ship, and gate the advance percentage accordingly.

**Delivery timelines.** Regulated: 5 days within the same city, 10 days for a different city, measured from advance payment. The Order model needs a delivery-clock field tied to these limits, with buyer-visible tracking.

**Bangla terms.** Refund, return, and delivery terms must be displayed in Bangla, clearly, on the listing and checkout flow. This is why Bangla-first is structural rather than a UX preference.

**Prohibited categories.** No MLM or network-marketing structures. No lottery or gambling. No medicine or healthcare products without DGDA (Directorate General of Drug Administration) licensing — which becomes relevant when Phase 3 adds healthcare booking and pharmacy features.

**Data retention.** Business data must be retained for a minimum period and be producible to government entities on request. This is why order status is an append-only event timeline rather than an overwritten column, and why Orders and Transactions are never hard-deleted.

## Bangladesh Bank

Any digital wallet, stored-value, or alternative payment mechanism needs Bangladesh Bank approval. This is the reason the locked stack specifies integration via a licensed aggregator or MFS provider rather than building a custom wallet — see [ADR-0004](../adr/0004-payments-via-licensed-aggregator.md).

It cuts both ways: Bangladesh Bank approval is also what makes the escrow path viable, since only an approved escrow service unlocks the 100% advance allowance above.

## NID-based KYC

Expect to integrate National ID verification for Merchant and Rider onboarding — for trust and fraud prevention, and likely required for payment-related roles. Merchant KYC is Phase 1; rider KYC arrives with Phase 2.

## BRTA verification

Rider mode (Phase 2) should verify driving licence and vehicle registration against BRTA where the vehicle type requires it.

## Cyber law

The framework has moved: **Digital Security Act (2018) → Cyber Security Act (2023) → Cyber Security Ordinance (2025)**, the current framework as of this writing. It governs content moderation, data-offense liability, and platform obligations for user-generated content — relevant to the Community Hub, notice board, and marketplace review features in Phases 3–4.

**This space has moved roughly every two years.** Check the current status before building moderation or takedown workflows around it. Do not implement against the 2025 ordinance from memory or from this document; re-verify at build time.

## VAT / NBR

The local tax engine should integrate with National Board of Revenue VAT requirements rather than using a generic percentage-tax placeholder.

## Why none of this blocks Phase 1

The Order and Transaction model is designed with the escrow/advance-payment and delivery-clock rules **already in mind**, so Phase 1 does not need a breaking schema change later. Compliance was treated as a schema input rather than a later retrofit — which is the whole point of [ADR-0005](../adr/0005-compliance-in-schema.md).

What does still need action before launch: counsel review of the escrow provider choice, confirmation of the data retention period, and NBR VAT integration scope.
