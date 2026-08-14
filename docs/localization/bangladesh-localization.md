# Bangladesh Localization

Master prompt §5. These are structural requirements, not settings.

## Geography and the address model

The address model follows Bangladesh's actual administrative hierarchy:

```
Division → District (Zila) → Upazila/Thana → Union/Ward → Village/Mohalla → address line
```

A generic "city / state / zip" model cannot represent a BD address and must not be substituted. This hierarchy is stored on `location` — see the [canonical data model](../data-model/canonical-model.md).

### Discovery: GPS with a mandatory manual fallback

GPS radius search (1–10 km, PostGIS `ST_DWithin`) is the **primary** discovery mechanic. It is **always** paired with manual address entry, because:

- GPS accuracy is unreliable in dense low-rise urban areas
- It is effectively non-existent for many indoor merchants
- Users may deliberately shop for an area they are not currently standing in

The manual path walks the hierarchy above. A discovery implementation that requires a GPS fix is incomplete, not merely degraded.

### Same-city determination

`app_order.is_same_city` is derived by comparing merchant and delivery `district`, and it drives the regulated delivery clock (5 vs 10 days). Getting the hierarchy right is therefore a compliance concern, not just a UX one.

## Language

**Bangla-first, English-secondary.** Not "English with a Bangla translation available."

All user-facing legal and policy text — refund, delivery, complaint terms — **must** be available in Bangla. This is a requirement under the Digital Commerce Operation Guidelines 2021, not a UX nicety. See the [compliance matrix](../compliance/compliance-matrix.md), row C6.

Voice search must handle Bangla with the code-switching people actually use:

> "bike mechanic amar area te"

That is one query, not a failure case. Latin-script Bangla, mixed English nouns, and phonetic spellings all need to resolve. Mechanics in [i18n conventions](i18n-conventions.md).

## Currency

**BDT (৳) only for Phase 1.**

No multi-currency infrastructure until there is an actual expansion phase. It brings a tax engine, FX handling, and additional compliance for zero present value. Prices are `NUMERIC(12,2)` in BDT; there is no `currency` column, deliberately — adding one later is a smaller cost than carrying unused multi-currency logic now.

## Connectivity reality

Every core flow — browse, order, track — degrades gracefully on 3G and survives load-shedding-induced app kills.

| Requirement | Implementation |
|---|---|
| Last-viewed catalog and order state available offline | Local cache, written on every successful fetch |
| Actions survive a mid-action network drop | "Place order" and similar are **queued** locally and retried, never failed silently |
| App killed mid-session | Cart and action queue persist to disk, resume on next launch |
| Metered data | Aggressive image compression at upload time; never ship an unprocessed original to a client |

Silent failure is the specific thing to avoid. A user who does not know whether their order was placed will place it twice, or abandon the platform.

## Payment reality

**Cash-on-Delivery is a first-class payment method**, not a legacy option to deprecate. Digital wallet adoption is high, but COD still covers a meaningful share of BD e-commerce.

This means:

- `cod` is a full member of the `payment_method` enum, with a complete Transaction lifecycle
- COD-to-digital reconciliation is a designed flow, not an afterthought — this is part of why `transaction` is a separate table from `app_order`
- Phase 1 payment methods: **bKash, Nagad, COD**. Rocket and Upay are modelled as first-class in the longer term
- No custom stored-value wallet — see [ADR-0004](../adr/0004-payments-via-licensed-aggregator.md) and Bangladesh Bank oversight in the compliance matrix

## Trust

Bangladesh's e-commerce sector has had well-publicised fraud scandals. Trust in a new platform has to be earned, which has concrete product consequences:

- Order state must always be truthful and visible, including bad news
- The regulated delivery deadline is shown to the buyer as a commitment, not hidden as an internal SLA
- Refund and complaint terms are reachable **before** payment, in Bangla, in plain language
