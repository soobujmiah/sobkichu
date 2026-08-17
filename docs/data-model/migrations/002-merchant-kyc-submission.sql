-- Migration 002 — merchant KYC submission
--
-- Compliance row touched: K1 (docs/compliance/compliance-matrix.md) --
-- "NID-based KYC for Merchant onboarding... merchants cannot publish
-- listings until verified".
--
-- `role.kyc_status` and `app_user.nid_verification_status` already existed
-- (phase-1-schema.sql) and are what CatalogService/OrderService actually
-- gate on -- this migration does not touch that gate. What was missing was
-- anywhere to WRITE to them: a place to record the NID number itself, and
-- an audit trail of what was submitted and when.
--
-- WHY A SEPARATE TABLE RATHER THAN role.profile JSONB
--
-- role.profile already holds merchant business info, but a KYC submission
-- is an append-only EVENT (a resubmission after rejection must not destroy
-- the record of the earlier attempt -- same reasoning as order_status_event
-- being append-only, backend-modules.md's audit cross-cutting concern), not
-- current-state data a JSONB blob overwrite is appropriate for.
--
-- Document CONTENT is never here. Per the compliance matrix: "KYC document
-- blobs live in object storage with restricted access... and never inline
-- in the database." This table stores reference URLs into that storage,
-- not the files themselves.
--
-- Forward-only and idempotent, same convention as migration 001.

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS nid_number TEXT;

CREATE TABLE IF NOT EXISTS kyc_submission (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id        UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,

    -- References into object storage, never blob content (compliance
    -- matrix row K1 note). Upload/storage wiring is separate, not-yet-built
    -- work -- see CURRENT_STATE.md.
    document_urls  TEXT[] NOT NULL,

    submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest-submission-first, per role -- the read pattern for a reviewer or
-- for "has this role already been submitted".
CREATE INDEX IF NOT EXISTS kyc_submission_role_idx
    ON kyc_submission (role_id, submitted_at DESC);
