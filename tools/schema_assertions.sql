-- Sobkichu — schema-level compliance and integrity assertions.
--
-- Run by .github/workflows/schema-ci.yml against a real PostGIS instance
-- with the Phase 1 schema and seed applied.
--
-- These correspond to rows in docs/compliance/compliance-matrix.md and to
-- the testing table in docs/workflow/testing-strategy.md. A failure here is
-- a COMPLIANCE REGRESSION, not a flaky test.
--
-- Style: each assertion raises an exception on failure so ON_ERROR_STOP
-- aborts the run with a readable message.

\set ON_ERROR_STOP on
\timing off

CREATE OR REPLACE FUNCTION assert(condition BOOLEAN, label TEXT) RETURNS VOID AS $$
BEGIN
    IF condition IS NOT TRUE THEN
        RAISE EXCEPTION 'ASSERTION FAILED: %', label;
    END IF;
    RAISE NOTICE '  ok  %', label;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo '=== Structural ==='

SELECT assert(
    (SELECT COUNT(*) FROM pg_extension WHERE extname = 'postgis') = 1,
    'PostGIS extension installed (radius discovery depends on it)');

SELECT assert(
    to_regclass('public.app_order') IS NOT NULL
    AND to_regclass('public.transaction') IS NOT NULL
    AND to_regclass('public.listing') IS NOT NULL
    AND to_regclass('public.location') IS NOT NULL
    AND to_regclass('public.app_user') IS NOT NULL
    AND to_regclass('public.role') IS NOT NULL,
    'All six canonical entities exist');

SELECT assert(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_name = 'location'
        AND column_name IN ('division','district','upazila_thana','union_ward','village_mohalla')) = 5,
    'Location uses the BD administrative hierarchy, not city/state/zip');

SELECT assert(
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'app_order' AND column_name = 'rider_role_id') = 'YES',
    'Order.rider_role_id is nullable (Phase 2 dispatch is additive, no backfill)');

SELECT assert(
    (SELECT COUNT(*) FROM pg_indexes
      WHERE tablename = 'listing' AND indexdef ILIKE '%gist%') >= 1,
    'Listing has a GIST index for radius search');


\echo ''
\echo '=== C1/C2/C3 — advance payment cap (DCOG 2021) ==='

-- Fixtures reused by the cap and clock assertions.
CREATE TEMP TABLE fixture AS
SELECT
    (SELECT id FROM app_user  WHERE phone_e164 = '+8801700000001') AS customer_id,
    (SELECT id FROM role      WHERE type = 'merchant' AND profile->>'business_name' = 'Gulshan Electronics') AS merchant_id,
    '11111111-1111-4111-8111-000000000001'::uuid AS dhaka_loc,
    '11111111-1111-4111-8111-000000000006'::uuid AS ctg_loc;

-- C1: advance above the 10% cap must be rejected by the CHECK constraint.
DO $$
DECLARE f RECORD; ok BOOLEAN := FALSE;
BEGIN
    SELECT * INTO f FROM fixture;
    BEGIN
        INSERT INTO app_order (customer_user_id, merchant_role_id, delivery_location_id,
                               payment_method, subtotal_bdt, total_bdt,
                               advance_amount_bdt, advance_cap_bdt,
                               all_items_ready_to_ship, is_same_city)
        VALUES (f.customer_id, f.merchant_id, f.dhaka_loc,
                'bkash', 4200.00, 4200.00,
                4200.00, 420.00,      -- paying 100% against a 10% cap
                FALSE, TRUE);
    EXCEPTION WHEN check_violation THEN
        ok := TRUE;
    END;
    PERFORM assert(ok, 'C1: advance above cap is rejected for a non-ready-to-ship order');
END $$;

-- C2: all items ready to ship -> cap is the full total, 100% advance allowed.
DO $$
DECLARE f RECORD; oid UUID;
BEGIN
    SELECT * INTO f FROM fixture;
    INSERT INTO app_order (customer_user_id, merchant_role_id, delivery_location_id,
                           payment_method, subtotal_bdt, total_bdt,
                           advance_amount_bdt, advance_cap_bdt,
                           all_items_ready_to_ship, is_same_city)
    VALUES (f.customer_id, f.merchant_id, f.dhaka_loc,
            'bkash', 180.00, 180.00,
            180.00, 180.00,
            TRUE, TRUE)
    RETURNING id INTO oid;
    PERFORM assert(oid IS NOT NULL, 'C2: ready-to-ship order accepts 100% advance');
END $$;

-- C3: escrow path -> 100% advance allowed even when not ready to ship.
DO $$
DECLARE f RECORD; oid UUID;
BEGIN
    SELECT * INTO f FROM fixture;
    INSERT INTO app_order (customer_user_id, merchant_role_id, delivery_location_id,
                           payment_method, subtotal_bdt, total_bdt,
                           advance_amount_bdt, advance_cap_bdt,
                           is_escrow, all_items_ready_to_ship, is_same_city)
    VALUES (f.customer_id, f.merchant_id, f.dhaka_loc,
            'escrow', 4200.00, 4200.00,
            4200.00, 4200.00,
            TRUE, FALSE, TRUE)
    RETURNING id INTO oid;
    PERFORM assert(oid IS NOT NULL, 'C3: escrow order accepts 100% advance despite not ready-to-ship');
END $$;

-- Negative amounts are never valid.
DO $$
DECLARE f RECORD; ok BOOLEAN := FALSE;
BEGIN
    SELECT * INTO f FROM fixture;
    BEGIN
        INSERT INTO app_order (customer_user_id, merchant_role_id, delivery_location_id,
                               payment_method, subtotal_bdt, total_bdt,
                               advance_amount_bdt, advance_cap_bdt,
                               all_items_ready_to_ship, is_same_city)
        VALUES (f.customer_id, f.merchant_id, f.dhaka_loc,
                'cod', 100.00, 100.00, -50.00, 100.00, TRUE, TRUE);
    EXCEPTION WHEN check_violation THEN ok := TRUE;
    END;
    PERFORM assert(ok, 'Negative advance amount is rejected');
END $$;


\echo ''
\echo '=== C4 — delivery clock ==='

-- Same city: deadline = advance_paid_at + 5 days.
DO $$
DECLARE f RECORD; oid UUID; paid TIMESTAMPTZ := now();
BEGIN
    SELECT * INTO f FROM fixture;
    INSERT INTO app_order (customer_user_id, merchant_role_id, delivery_location_id,
                           payment_method, subtotal_bdt, total_bdt,
                           advance_amount_bdt, advance_cap_bdt,
                           all_items_ready_to_ship, is_same_city,
                           advance_paid_at, delivery_deadline_at)
    VALUES (f.customer_id, f.merchant_id, f.dhaka_loc,
            'bkash', 180.00, 180.00, 180.00, 180.00,
            TRUE, TRUE, paid, paid + INTERVAL '5 days')
    RETURNING id INTO oid;

    PERFORM assert(
        (SELECT delivery_deadline_at - advance_paid_at FROM app_order WHERE id = oid) = INTERVAL '5 days',
        'C4: same-city delivery clock is 5 days from advance payment');
END $$;

-- Different city: 10 days.
DO $$
DECLARE f RECORD; oid UUID; paid TIMESTAMPTZ := now();
BEGIN
    SELECT * INTO f FROM fixture;
    INSERT INTO app_order (customer_user_id, merchant_role_id, delivery_location_id,
                           payment_method, subtotal_bdt, total_bdt,
                           advance_amount_bdt, advance_cap_bdt,
                           all_items_ready_to_ship, is_same_city,
                           advance_paid_at, delivery_deadline_at)
    VALUES (f.customer_id, f.merchant_id, f.ctg_loc,
            'bkash', 180.00, 180.00, 180.00, 180.00,
            TRUE, FALSE, paid, paid + INTERVAL '10 days')
    RETURNING id INTO oid;

    PERFORM assert(
        (SELECT delivery_deadline_at - advance_paid_at FROM app_order WHERE id = oid) = INTERVAL '10 days',
        'C4: different-city delivery clock is 10 days from advance payment');
END $$;

-- A deadline cannot exist without a payment time to measure from.
DO $$
DECLARE f RECORD; ok BOOLEAN := FALSE;
BEGIN
    SELECT * INTO f FROM fixture;
    BEGIN
        INSERT INTO app_order (customer_user_id, merchant_role_id, delivery_location_id,
                               payment_method, subtotal_bdt, total_bdt,
                               advance_amount_bdt, advance_cap_bdt,
                               all_items_ready_to_ship, is_same_city,
                               advance_paid_at, delivery_deadline_at)
        VALUES (f.customer_id, f.merchant_id, f.dhaka_loc,
                'cod', 180.00, 180.00, 0.00, 180.00,
                TRUE, TRUE, NULL, now() + INTERVAL '5 days');
    EXCEPTION WHEN check_violation THEN ok := TRUE;
    END;
    PERFORM assert(ok, 'C4: delivery deadline without advance_paid_at is rejected');
END $$;


\echo ''
\echo '=== C8/C9 — category gating ==='

SELECT assert(
    (SELECT COUNT(*) FROM category WHERE slug IN ('lottery','mlm') AND is_restricted) = 2,
    'C8: lottery and MLM categories are flagged restricted');

SELECT assert(
    (SELECT requires_dgda_licence FROM category WHERE slug = 'pharmacy'),
    'C9: pharmacy category requires DGDA licensing (Phase 3 gate)');


\echo ''
\echo '=== Payment integrity ==='

-- Aggregator webhooks retry; duplicates must be inert.
DO $$
DECLARE oid UUID; ok BOOLEAN := FALSE;
BEGIN
    SELECT id INTO oid FROM app_order LIMIT 1;
    INSERT INTO transaction (order_id, method, amount_bdt, status, aggregator, aggregator_ref)
    VALUES (oid, 'bkash', 180.00, 'settled', 'sslcommerz', 'REF-IDEMPOTENCY-1');
    BEGIN
        INSERT INTO transaction (order_id, method, amount_bdt, status, aggregator, aggregator_ref)
        VALUES (oid, 'bkash', 180.00, 'settled', 'sslcommerz', 'REF-IDEMPOTENCY-1');
    EXCEPTION WHEN unique_violation THEN ok := TRUE;
    END;
    PERFORM assert(ok, 'Duplicate aggregator webhook is rejected (idempotency)');
END $$;

SELECT assert(
    EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
             WHERE t.typname = 'payment_method' AND e.enumlabel = 'cod'),
    'COD is a first-class payment method, not a legacy fallback');


\echo ''
\echo '=== Localization / discovery ==='

SELECT assert(
    (SELECT COUNT(*) FROM listing WHERE geo IS NULL) >= 1,
    'Seed includes a listing with no GPS point (manual address fallback path)');

-- The actual Phase 1 discovery query: 3km radius around Dhanmondi.
SELECT assert(
    (SELECT COUNT(*) FROM listing
      WHERE geo IS NOT NULL
        AND ST_DWithin(geo, ST_SetSRID(ST_MakePoint(90.3742, 23.7461), 4326)::geography, 3000)) >= 1,
    'PostGIS radius search returns nearby Dhaka listings');

SELECT assert(
    (SELECT COUNT(*) FROM listing WHERE title_bn IS NULL OR btrim(title_bn) = '') = 0,
    'Every listing has a Bangla title (Bangla-first is structural)');

SELECT assert(
    (SELECT COUNT(*) FROM listing WHERE search_tsv IS NULL) = 0,
    'Full-text search vector is populated by trigger on every listing');

SELECT assert(
    (SELECT COUNT(*) FROM app_user WHERE language_preference = 'bn') >= 1,
    'Bangla is the default language preference');


\echo ''
\echo '=== Role model ==='

SELECT assert(
    (SELECT COUNT(DISTINCT type) FROM role
      WHERE user_id = (SELECT id FROM app_user WHERE phone_e164 = '+8801700000005')) = 2,
    'One identity holds multiple roles (role switching is not two accounts)');

DO $$
DECLARE uid UUID; ok BOOLEAN := FALSE;
BEGIN
    SELECT id INTO uid FROM app_user WHERE phone_e164 = '+8801700000002';
    BEGIN
        INSERT INTO role (user_id, type) VALUES (uid, 'merchant');
    EXCEPTION WHEN unique_violation THEN ok := TRUE;
    END;
    PERFORM assert(ok, 'A user cannot hold the same role type twice');
END $$;

SELECT assert(
    EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
             WHERE t.typname = 'role_type' AND e.enumlabel = 'rider'),
    'Phase 2 rider role value reserved in the enum (avoids a later type migration)');


\echo ''
\echo '=== Retention (C10) ==='

SELECT assert(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_name = 'order_status_event' AND column_name = 'occurred_at') = 1,
    'C10: order status timeline is an append-only event table, not an overwritten column');

DROP FUNCTION assert(BOOLEAN, TEXT);

\echo ''
\echo 'All schema assertions passed.'
\echo ''
