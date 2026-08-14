-- Sobkichu — Phase 1 canonical schema (PostgreSQL 15+ / PostGIS 3+)
-- Scope: Customer + Merchant modes, hyperlocal e-commerce + service booking.
-- Phase 2+ columns are present ONLY where their later absence would force a
-- breaking migration of live order data (e.g. Order.rider_role_id).
--
-- Compliance anchors are marked [DCOG-2021] (Digital Commerce Operation
-- Guidelines 2021). See docs/compliance/compliance-matrix.md.
-- This schema encodes those rules; it is not legal advice and needs counsel
-- review before launch.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE role_type AS ENUM (
    'customer',
    'merchant',
    'rider',          -- Phase 2, flag-gated at API
    'professional'    -- Phase 3, flag-gated at API
);

CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');

CREATE TYPE language_code AS ENUM ('bn', 'en');

CREATE TYPE listing_type AS ENUM ('product', 'service_slot');

CREATE TYPE order_status AS ENUM (
    'created',
    'awaiting_payment',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'in_transit',       -- Phase 2 rider flows; reachable via merchant self-delivery in Phase 1
    'delivered',
    'cancelled',
    'refund_requested',
    'refunded'
);

CREATE TYPE payment_method AS ENUM ('bkash', 'nagad', 'cod', 'escrow');

CREATE TYPE settlement_status AS ENUM ('pending', 'authorized', 'settled', 'failed', 'refunded');

-- ---------------------------------------------------------------------------
-- Location — BD administrative hierarchy (Section 5). Never a city/state/zip.
-- ---------------------------------------------------------------------------

CREATE TABLE location (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division        TEXT NOT NULL,
    district        TEXT NOT NULL,            -- Zila
    upazila_thana   TEXT NOT NULL,
    union_ward      TEXT,
    village_mohalla TEXT,
    address_line    TEXT,
    postcode        TEXT,
    geo             geography(Point, 4326),   -- nullable: manual address fallback is first-class
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX location_geo_gix ON location USING GIST (geo);
CREATE INDEX location_admin_idx ON location (division, district, upazila_thana);

-- ---------------------------------------------------------------------------
-- User — one identity, phone-primary (email is not the BD default)
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_e164              TEXT NOT NULL UNIQUE,
    display_name            TEXT,
    nid_verification_status verification_status NOT NULL DEFAULT 'unverified',
    language_preference     language_code NOT NULL DEFAULT 'bn',
    default_location_id     UUID REFERENCES location(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_saved_location (
    user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES location(id),
    label       TEXT,                          -- translation key or user-entered
    PRIMARY KEY (user_id, location_id)
);

-- ---------------------------------------------------------------------------
-- Role — role-specific profile, keyed to one identity
-- ---------------------------------------------------------------------------

CREATE TABLE role (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    type        role_type NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    profile     JSONB NOT NULL DEFAULT '{}',   -- merchant: business info; rider: vehicle + BRTA ref
    kyc_status  verification_status NOT NULL DEFAULT 'unverified',
    pickup_location_id UUID REFERENCES location(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, type)
);

-- ---------------------------------------------------------------------------
-- Listing — sellable/bookable unit, owned by a Role, priced in BDT
-- ---------------------------------------------------------------------------

CREATE TABLE category (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT NOT NULL UNIQUE,
    name_key     TEXT NOT NULL,                -- i18n key, never a hardcoded label
    -- [DCOG-2021] prohibited categories: MLM, lottery/gambling,
    -- medicine/healthcare without DGDA licensing (relevant from Phase 3).
    is_restricted        BOOLEAN NOT NULL DEFAULT FALSE,
    requires_dgda_licence BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE listing (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_role_id UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    type          listing_type NOT NULL,
    category_id   UUID NOT NULL REFERENCES category(id),
    title_bn      TEXT NOT NULL,
    title_en      TEXT,
    description_bn TEXT,
    description_en TEXT,
    price_bdt     NUMERIC(12,2) NOT NULL CHECK (price_bdt >= 0),

    -- [DCOG-2021] drives the advance-payment cap: TRUE means deliverable
    -- within 72 hours, which permits >10% advance.
    ready_to_ship BOOLEAN NOT NULL DEFAULT FALSE,

    stock_qty     INTEGER,                     -- NULL for service slots
    location_id   UUID NOT NULL REFERENCES location(id),
    geo           geography(Point, 4326),      -- denormalised for radius search
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    search_tsv    tsvector,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listing_geo_gix ON listing USING GIST (geo);
CREATE INDEX listing_search_gin ON listing USING GIN (search_tsv);
CREATE INDEX listing_owner_idx ON listing (owner_role_id) WHERE is_active;

-- Postgres full-text is the Phase 1 search engine (Section 3). No external
-- search service until Phase 2+ justifies the ops overhead.
CREATE FUNCTION listing_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('simple', coalesce(NEW.title_bn, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.title_en, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.description_bn, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(NEW.description_en, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER listing_tsv_trg BEFORE INSERT OR UPDATE ON listing
    FOR EACH ROW EXECUTE FUNCTION listing_tsv_update();

-- ---------------------------------------------------------------------------
-- Order — the compliance-bearing entity
-- ---------------------------------------------------------------------------

CREATE TABLE app_order (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_user_id    UUID NOT NULL REFERENCES app_user(id),
    merchant_role_id    UUID NOT NULL REFERENCES role(id),
    rider_role_id       UUID REFERENCES role(id),      -- Phase 2, nullable by design
    delivery_location_id UUID NOT NULL REFERENCES location(id),

    status              order_status NOT NULL DEFAULT 'created',
    payment_method      payment_method NOT NULL,

    subtotal_bdt        NUMERIC(12,2) NOT NULL CHECK (subtotal_bdt >= 0),
    delivery_fee_bdt    NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_bdt           NUMERIC(12,2) NOT NULL CHECK (total_bdt >= 0),

    -- [DCOG-2021] advance payment: capped at 10% of price unless every line
    -- item is ready_to_ship (<=72h) or payment runs through a Bangladesh
    -- Bank-approved escrow service, in which case 100% is allowed.
    advance_amount_bdt  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (advance_amount_bdt >= 0),
    advance_cap_bdt     NUMERIC(12,2) NOT NULL,   -- computed server-side at creation
    is_escrow           BOOLEAN NOT NULL DEFAULT FALSE,
    all_items_ready_to_ship BOOLEAN NOT NULL,

    -- [DCOG-2021] delivery clock: 5 days same city, 10 days different city,
    -- measured from advance payment. Buyer-visible.
    is_same_city        BOOLEAN NOT NULL,
    advance_paid_at     TIMESTAMPTZ,
    delivery_deadline_at TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT advance_within_cap CHECK (advance_amount_bdt <= advance_cap_bdt),
    CONSTRAINT deadline_requires_payment_time CHECK (
        delivery_deadline_at IS NULL OR advance_paid_at IS NOT NULL
    )
);

CREATE INDEX order_customer_idx ON app_order (customer_user_id, created_at DESC);
CREATE INDEX order_merchant_idx ON app_order (merchant_role_id, status);
CREATE INDEX order_deadline_idx ON app_order (delivery_deadline_at)
    WHERE status NOT IN ('delivered', 'cancelled', 'refunded');

CREATE TABLE order_item (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES app_order(id) ON DELETE CASCADE,
    listing_id    UUID NOT NULL REFERENCES listing(id),
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_bdt NUMERIC(12,2) NOT NULL,      -- price snapshot at order time
    ready_to_ship_at_order BOOLEAN NOT NULL     -- snapshot; evidence for the cap applied
);

-- Status timeline as append-only events: business data must be retained and
-- producible to government entities on request [DCOG-2021].
CREATE TABLE order_status_event (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES app_order(id) ON DELETE CASCADE,
    from_status order_status,
    to_status   order_status NOT NULL,
    actor_role_id UUID REFERENCES role(id),
    note_key    TEXT,                            -- i18n key, not free English text
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_event_idx ON order_status_event (order_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Transaction — separate from Order so Digital Khata (Phase 2) can reference
-- it independently, and so COD-to-digital reconciliation has a home.
-- ---------------------------------------------------------------------------

CREATE TABLE transaction (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          UUID NOT NULL REFERENCES app_order(id),
    method            payment_method NOT NULL,
    amount_bdt        NUMERIC(12,2) NOT NULL CHECK (amount_bdt >= 0),
    status            settlement_status NOT NULL DEFAULT 'pending',
    aggregator        TEXT,                      -- sslcommerz | shurjopay | bkash | nagad
    aggregator_ref    TEXT,
    is_advance        BOOLEAN NOT NULL DEFAULT FALSE,
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at        TIMESTAMPTZ,
    UNIQUE (aggregator, aggregator_ref)          -- webhook idempotency
);

CREATE INDEX transaction_order_idx ON transaction (order_id);

-- ---------------------------------------------------------------------------
-- Notes for implementers
-- ---------------------------------------------------------------------------
-- 1. advance_cap_bdt is computed by the API at order creation:
--       is_escrow OR all_items_ready_to_ship  ->  total_bdt
--       otherwise                             ->  round(total_bdt * 0.10, 2)
--    The CHECK constraint is the last line of defence, not the only one.
-- 2. delivery_deadline_at is set in the same DB transaction that records the
--    advance Transaction: advance_paid_at + (5 or 10 days per is_same_city).
-- 3. Order status and Transaction status changes must occur inside one DB
--    transaction. They may never desync (Section 8).
-- 4. All user-facing text stored here is either Bangla/English content pairs
--    or i18n keys. Never store a hardcoded English UI string.
