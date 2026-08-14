# Glossary

## Bangladesh context

| Term | Meaning |
|---|---|
| **BDT (৳)** | Bangladeshi Taka. The only currency in Phase 1. |
| **bKash** | Largest mobile financial service (MFS) in Bangladesh. Phase 1 payment method. |
| **Nagad** | MFS operated under Bangladesh Post Office. Phase 1 payment method. |
| **Rocket / Upay** | Other MFS providers. Modelled as first-class longer term, not Phase 1. |
| **MFS** | Mobile Financial Service — the regulated category bKash/Nagad belong to. |
| **COD** | Cash on Delivery. A first-class payment method here, not a legacy fallback. |
| **NID** | National ID. Basis of KYC for Merchant (Phase 1) and Rider (Phase 2) onboarding. |
| **Division / District (Zila) / Upazila / Thana / Union / Ward / Mohalla** | Bangladesh's administrative hierarchy, top to bottom. The address model follows this, not city/state/zip. |
| **Digital Khata** | Digital ledger/accounts-book for merchants. Phase 2. The reason `transaction` is a separate table. |
| **Load-shedding** | Scheduled/unscheduled power cuts. Why the app must survive being killed mid-session. |
| **Banglish** | Bangla written in Latin script. Must work in search input. |

## Regulators and frameworks

| Term | Meaning |
|---|---|
| **DCOG 2021** | Digital Commerce Operation Guidelines 2021, Ministry of Commerce. Core e-commerce compliance framework — advance-payment cap, delivery clock, Bangla terms, prohibited categories, data retention. |
| **Bangladesh Bank** | Central bank. Approval needed for any wallet, stored value, or alternative payment mechanism — and for escrow services. |
| **BRTA** | Bangladesh Road Transport Authority. Rider licence/vehicle verification, Phase 2. |
| **DGDA** | Directorate General of Drug Administration. Licensing for medicine/healthcare products, relevant from Phase 3. |
| **NBR** | National Board of Revenue. VAT requirements the tax engine must integrate with. |
| **Cyber Security Ordinance 2025** | Current cyber law framework (DSA 2018 → CSA 2023 → CSO 2025). Governs content moderation and platform obligations for user-generated content. Re-verify before building moderation workflows. |

## Project terms

| Term | Meaning |
|---|---|
| **Advance cap** | Maximum permitted up-front payment: 10% of total, or 100% if all items are ready-to-ship or the escrow path is used. Stored as `advance_cap_bdt`. |
| **Ready-to-ship** | Deliverable within 72 hours. Per-listing flag that unlocks a higher advance. |
| **Delivery clock** | Regulated deadline — 5 days same city, 10 days different city, from advance payment. Stored as `delivery_deadline_at`, buyer-visible. |
| **Canonical data model** | The six core entities: User, Role, Listing, Order, Transaction, Location. Extended, never duplicated. |
| **Role switching** | One User identity holding multiple Role assignments; the UI switches between them. Not multiple accounts. |
| **Ship dark** | Building a later-phase feature behind a feature flag so it can ship disabled. |
| **Low-end profile** | The 2–4GB RAM Android target. Distinct from the Redmi Turbo 4 Pro QA device. |
| **Test device ≠ target device** | The rule that a Redmi Turbo 4 Pro pass is a functional sanity check, never a performance sign-off. |
| **Action queue** | Local queue holding user actions (e.g. place order) when the network drops, retried on reconnect, always visible to the user. |

## Stack

| Term | Meaning |
|---|---|
| **PostGIS** | PostgreSQL geo extension. Powers the 1–10 km radius search via `ST_DWithin`. |
| **FTS** | Full-text search. Phase 1 uses Postgres FTS; no external search engine until Phase 2+ justifies it. |
| **FCM** | Firebase Cloud Messaging. Push — always paired with SMS for critical events. |
| **Aggregator** | Licensed payment intermediary (SSLCommerz, ShurjoPay). We integrate one rather than building a wallet. |
| **Devcontainer** | Repo-defined dev environment so Codespaces spins up Flutter + Node + Postgres/PostGIS + Redis with no local setup. |
