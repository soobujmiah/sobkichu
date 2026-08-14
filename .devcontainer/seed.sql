-- Sobkichu — devcontainer seed data.
-- Dhaka-area sample so discovery, radius search and the order flow have
-- something to work against immediately. Idempotent: safe to re-run.
--
-- "Design for Dhaka, generalize later" (roadmap) means the DATA is Dhaka,
-- not the model. Nothing here is hardcoded anywhere outside this file.

BEGIN;

-- ---------------------------------------------------------------------------
-- Categories. name_key is an i18n key, never a display string.
-- ---------------------------------------------------------------------------

INSERT INTO category (slug, name_key, is_restricted, requires_dgda_licence) VALUES
    ('grocery',        'category.grocery',        FALSE, FALSE),
    ('electronics',    'category.electronics',    FALSE, FALSE),
    ('home-repair',    'category.home_repair',    FALSE, FALSE),
    ('tailoring',      'category.tailoring',      FALSE, FALSE),
    ('mobile-repair',  'category.mobile_repair',  FALSE, FALSE),
    -- Restricted: DCOG 2021 prohibited categories. Present so the block path
    -- is testable, not because we intend to list them.
    ('lottery',        'category.lottery',        TRUE,  FALSE),
    ('mlm',            'category.mlm',            TRUE,  FALSE),
    -- Phase 3, gated on DGDA licensing.
    ('pharmacy',       'category.pharmacy',       FALSE, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Locations — full BD administrative hierarchy, never city/state/zip.
-- Coordinates are real Dhaka points so ST_DWithin returns sensible results.
-- ---------------------------------------------------------------------------

INSERT INTO location (id, division, district, upazila_thana, union_ward, village_mohalla, address_line, postcode, geo) VALUES
    ('11111111-1111-4111-8111-000000000001', 'Dhaka', 'Dhaka', 'Dhanmondi',   'Ward 15', 'Dhanmondi R/A',  'Road 27, House 14',   '1209',
        ST_SetSRID(ST_MakePoint(90.3742, 23.7461), 4326)::geography),
    ('11111111-1111-4111-8111-000000000002', 'Dhaka', 'Dhaka', 'Mohammadpur', 'Ward 33', 'Shyamoli',       'Ring Road, Block C',  '1207',
        ST_SetSRID(ST_MakePoint(90.3654, 23.7639), 4326)::geography),
    ('11111111-1111-4111-8111-000000000003', 'Dhaka', 'Dhaka', 'Gulshan',     'Ward 19', 'Gulshan 1',      'Road 11, House 3',    '1212',
        ST_SetSRID(ST_MakePoint(90.4152, 23.7808), 4326)::geography),
    ('11111111-1111-4111-8111-000000000004', 'Dhaka', 'Dhaka', 'Mirpur',      'Ward 6',  'Mirpur 10',      'Section 10, Block A', '1216',
        ST_SetSRID(ST_MakePoint(90.3687, 23.8069), 4326)::geography),
    -- Manual-address-only location: no GPS point. Exercises the mandatory
    -- manual fallback path (indoor merchant, unreliable GPS).
    ('11111111-1111-4111-8111-000000000005', 'Dhaka', 'Dhaka', 'Old Dhaka',   'Ward 38', 'Shakhari Bazar', 'Lane 4, 2nd floor',   '1100',
        NULL),
    -- Different district: exercises the 10-day delivery clock branch.
    ('11111111-1111-4111-8111-000000000006', 'Chattogram', 'Chattogram', 'Kotwali', 'Ward 32', 'Anderkilla', 'Station Road', '4000',
        ST_SetSRID(ST_MakePoint(91.8123, 22.3350), 4326)::geography)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Users. Phone-primary (not email). Bangla is the default language.
-- Numbers are in the reserved-for-documentation style, not live numbers.
-- ---------------------------------------------------------------------------

INSERT INTO app_user (id, phone_e164, display_name, nid_verification_status, language_preference, default_location_id) VALUES
    ('22222222-2222-4222-8222-000000000001', '+8801700000001', 'Customer (Dhanmondi)', 'unverified', 'bn',
        '11111111-1111-4111-8111-000000000001'),
    ('22222222-2222-4222-8222-000000000002', '+8801700000002', 'Merchant (Shyamoli)',  'verified',   'bn',
        '11111111-1111-4111-8111-000000000002'),
    ('22222222-2222-4222-8222-000000000003', '+8801700000003', 'Merchant (Gulshan)',   'verified',   'en',
        '11111111-1111-4111-8111-000000000003'),
    -- Merchant mid-KYC: must NOT be able to publish listings (compliance K1).
    ('22222222-2222-4222-8222-000000000004', '+8801700000004', 'Merchant (pending KYC)', 'pending',  'bn',
        '11111111-1111-4111-8111-000000000004'),
    -- One human, two roles. Proves role switching is not two accounts.
    ('22222222-2222-4222-8222-000000000005', '+8801700000005', 'Customer + Merchant',  'verified',   'bn',
        '11111111-1111-4111-8111-000000000005')
ON CONFLICT (phone_e164) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Roles. Note user ...0005 holds both customer and merchant.
-- ---------------------------------------------------------------------------

INSERT INTO role (id, user_id, type, profile, kyc_status, pickup_location_id) VALUES
    ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 'customer', '{}', 'unverified', NULL),
    ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000002', 'merchant',
        '{"business_name":"Shyamoli Kacha Bazar","trade_licence_ref":"TL-DHK-2024-0012"}', 'verified',
        '11111111-1111-4111-8111-000000000002'),
    ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000003', 'merchant',
        '{"business_name":"Gulshan Electronics","trade_licence_ref":"TL-DHK-2024-0044"}', 'verified',
        '11111111-1111-4111-8111-000000000003'),
    ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-000000000004', 'merchant',
        '{"business_name":"Mirpur Mobile Care","trade_licence_ref":"TL-DHK-2025-0101"}', 'pending',
        '11111111-1111-4111-8111-000000000004'),
    ('33333333-3333-4333-8333-000000000005', '22222222-2222-4222-8222-000000000005', 'customer', '{}', 'verified', NULL),
    ('33333333-3333-4333-8333-000000000006', '22222222-2222-4222-8222-000000000005', 'merchant',
        '{"business_name":"Shakhari Bazar Tailors","trade_licence_ref":"TL-DHK-2023-0777"}', 'verified',
        '11111111-1111-4111-8111-000000000005')
ON CONFLICT (user_id, type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Listings. Bangla title is mandatory; English is secondary.
-- ready_to_ship drives the advance-payment cap (DCOG 2021) — both values
-- are represented so the 10% and 100% paths are both testable.
-- ---------------------------------------------------------------------------

INSERT INTO listing (id, owner_role_id, type, category_id, title_bn, title_en, description_bn, description_en,
                     price_bdt, ready_to_ship, stock_qty, location_id, geo)
SELECT * FROM (VALUES
    ('44444444-4444-4444-8444-000000000001'::uuid, '33333333-3333-4333-8333-000000000002'::uuid, 'product'::listing_type,
        (SELECT id FROM category WHERE slug = 'grocery'),
        'মিনিকেট চাল ৫ কেজি', 'Miniket Rice 5kg', 'তাজা মিনিকেট চাল, ৫ কেজির বস্তা।', 'Fresh miniket rice, 5kg bag.',
        420.00, TRUE, 50, '11111111-1111-4111-8111-000000000002'::uuid,
        ST_SetSRID(ST_MakePoint(90.3654, 23.7639), 4326)::geography),

    ('44444444-4444-4444-8444-000000000002'::uuid, '33333333-3333-4333-8333-000000000002'::uuid, 'product'::listing_type,
        (SELECT id FROM category WHERE slug = 'grocery'),
        'সয়াবিন তেল ২ লিটার', 'Soybean Oil 2L', 'বোতলজাত সয়াবিন তেল।', 'Bottled soybean oil.',
        360.00, TRUE, 30, '11111111-1111-4111-8111-000000000002'::uuid,
        ST_SetSRID(ST_MakePoint(90.3654, 23.7639), 4326)::geography),

    -- NOT ready to ship: order-level advance is capped at 10%.
    ('44444444-4444-4444-8444-000000000003'::uuid, '33333333-3333-4333-8333-000000000003'::uuid, 'product'::listing_type,
        (SELECT id FROM category WHERE slug = 'electronics'),
        'সিলিং ফ্যান (অর্ডারে আনা হবে)', 'Ceiling Fan (made to order)',
        'অর্ডারের পর সরবরাহ, ৭২ ঘণ্টার বেশি সময় লাগতে পারে।', 'Supplied after order; may take longer than 72 hours.',
        4200.00, FALSE, NULL, '11111111-1111-4111-8111-000000000003'::uuid,
        ST_SetSRID(ST_MakePoint(90.4152, 23.7808), 4326)::geography),

    ('44444444-4444-4444-8444-000000000004'::uuid, '33333333-3333-4333-8333-000000000003'::uuid, 'product'::listing_type,
        (SELECT id FROM category WHERE slug = 'electronics'),
        'এলইডি বাল্ব ৯ ওয়াট', 'LED Bulb 9W', 'স্টকে আছে, দ্রুত সরবরাহ।', 'In stock, fast delivery.',
        180.00, TRUE, 200, '11111111-1111-4111-8111-000000000003'::uuid,
        ST_SetSRID(ST_MakePoint(90.4152, 23.7808), 4326)::geography),

    -- Service slot: stock_qty is NULL by design.
    ('44444444-4444-4444-8444-000000000005'::uuid, '33333333-3333-4333-8333-000000000006'::uuid, 'service_slot'::listing_type,
        (SELECT id FROM category WHERE slug = 'tailoring'),
        'পাঞ্জাবি সেলাই', 'Panjabi Tailoring', 'মাপ নিয়ে সেলাই, ৩ দিনে ডেলিভারি।', 'Measured and stitched, 3-day delivery.',
        850.00, FALSE, NULL, '11111111-1111-4111-8111-000000000005'::uuid,
        NULL),

    ('44444444-4444-4444-8444-000000000006'::uuid, '33333333-3333-4333-8333-000000000006'::uuid, 'service_slot'::listing_type,
        (SELECT id FROM category WHERE slug = 'home-repair'),
        'বৈদ্যুতিক মেরামত (ঘণ্টা প্রতি)', 'Electrical Repair (per hour)',
        'ঘরে এসে বৈদ্যুতিক সমস্যার সমাধান।', 'On-site electrical repair.',
        600.00, TRUE, NULL, '11111111-1111-4111-8111-000000000005'::uuid,
        NULL)
) AS v
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Sanity queries for a fresh container (run manually):
--
--   -- radius search, 3km around Dhanmondi
--   SELECT title_bn, ROUND((ST_Distance(geo,
--            ST_SetSRID(ST_MakePoint(90.3742, 23.7461),4326)::geography))::numeric)
--            AS metres
--     FROM listing
--    WHERE geo IS NOT NULL
--      AND ST_DWithin(geo, ST_SetSRID(ST_MakePoint(90.3742,23.7461),4326)::geography, 3000)
--    ORDER BY metres;
--
--   -- listings reachable ONLY via manual address fallback (no GPS)
--   SELECT title_en FROM listing WHERE geo IS NULL;
-- ---------------------------------------------------------------------------
