# Extension Rules

**Extend the canonical model. Don't reinvent it per feature.** Master prompt §7 and §10.4.

The specific failure this prevents: Phase 2+ features creating parallel `Booking2`, `Job`, or `DeliveryOrder` tables that duplicate `Order`'s shape without reason. Once that happens, every cross-cutting concern — the delivery clock, payment reconciliation, the retention obligation, order history — has to be implemented twice, and the second implementation is always the one that drifts.

## The decision procedure

Before creating a table, in order:

1. **Does an existing entity already model this?** A rider delivery is an Order with a `rider_role_id`. A service booking is an Order whose items are `service_slot` Listings. A rental is a Listing with a time dimension. Most "new" entities are existing ones with a field.
2. **Can it be a field or an enum value?** Adding `role_type.professional` or `listing_type.rental_asset` is almost always right versus a new table.
3. **Can it be a satellite table keyed to a canonical entity?** Role-specific data hangs off `role.profile`; order-specific extras hang off a table with an `order_id` FK. The canonical entity stays the spine.
4. **Only then, a new entity** — and it needs an ADR explaining why the model above could not absorb it.

## Worked examples

### Phase 2: rider delivery

**Wrong:** a `delivery` table with customer, merchant, addresses, status, payment method — that is `Order` with different column names.

**Right:** `app_order.rider_role_id` (already nullable, already present), plus a `dispatch_assignment` satellite table for dispatch-specific state (offered_at, accepted_at, route) keyed by `order_id`. Order remains the single source of order truth.

### Phase 2: Digital Khata (merchant ledger)

**Wrong:** a `ledger_entry` table that re-records payment amounts.

**Right:** the ledger *references* `transaction` rows. This is precisely why Transaction is separate from Order in the canonical model. A ledger view is a query, plus a small table for merchant-entered non-platform entries (cash sales made off-app).

### Phase 3: healthcare booking

**Wrong:** an `appointment` table with patient, provider, time, price, status.

**Right:** `listing_type.service_slot` with a time dimension, ordered through `app_order`. Health-specific data — which is sensitive and has its own retention rules — goes in a satellite table with restricted access, keyed by `order_id`. Sensitivity is an access-control problem, not a reason to fork Order.

### Phase 4: community post

**Right, and genuinely new:** a community post is not a sellable unit and has no buyer, no payment, and no delivery. It gets its own entity — and an ADR, because it also introduces the user-generated-content moderation surface.

This is what a legitimate new entity looks like: it shares almost nothing with Order except having an author.

## Rules for extension fields

1. **Nullable for later phases.** A Phase 2 column added to a Phase 1 table must be nullable, so no backfill of live order data is needed. `rider_role_id` is the template.
2. **Reserve enum values early.** Adding `rider` to `role_type` in the Phase 1 schema costs nothing and avoids a later type migration. Gate it at the API instead.
3. **Snapshot, don't reference, anything used for a compliance decision.** `order_item.ready_to_ship_at_order` records the basis of the advance cap. A live FK to `listing.ready_to_ship` would let a merchant retroactively change what a past order was allowed to do. See [ADR-0005](../adr/0005-compliance-in-schema.md).
4. **Prices are always BDT `NUMERIC(12,2)`.** No `currency` column until an actual expansion phase.
5. **User-facing text is an i18n key or a `_bn`/`_en` pair.** Never a bare English string ([i18n conventions](../localization/i18n-conventions.md)).
6. **New status values extend the existing enums.** A parallel status column on a satellite table that shadows `order_status` is the same bug as a parallel table.

## Migration conventions

- One migration per PR, forward-only, reversible where practical
- Never rewrite a shipped migration; add a new one
- Migrations touching `app_order` or `transaction` state each name the compliance rows they affect
- Data backfills are separate migrations from schema changes, so a slow backfill cannot block a deploy
