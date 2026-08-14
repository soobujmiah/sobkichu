-- Migration 001 — notification outbox
--
-- Compliance rows touched: none directly, but this table is how the
-- MANDATORY SMS requirement (master prompt Section 8) is guaranteed rather
-- than hoped for. Order confirmations, OTPs and critical status changes go
-- via SMS as well as push; SMS is not a retry-on-push-failure mechanism.
--
-- WHY AN OUTBOX RATHER THAN SENDING INLINE
--
-- A settlement writes the transaction, the order status and the delivery
-- clock in one transaction (Section 8). If notification dispatch happened
-- inside that transaction:
--   - a slow SMS gateway would hold a write transaction open, and
--   - a gateway failure would roll back a payment that genuinely settled.
-- Sending after the commit instead risks the opposite: the process dies
-- between commit and send, and a buyer is never told their order was
-- confirmed.
--
-- The outbox resolves both. The intent to notify is written INSIDE the same
-- transaction as the state change, so it commits atomically with it. A
-- separate dispatcher reads pending rows and calls the gateways. Delivery
-- becomes at-least-once instead of maybe-once, which is the correct
-- trade-off for a channel a user relies on to know their money moved.
--
-- Forward-only and idempotent: CI applies every migration on every run, so
-- a second application must be a no-op rather than an error. CREATE TYPE has
-- no IF NOT EXISTS, hence the guards.

DO $$
BEGIN
    CREATE TYPE notification_channel AS ENUM ('push', 'sms');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'abandoned');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notification_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who to reach. Denormalised at write time: a phone number change must
    -- not retarget a notification already queued, and the dispatcher must
    -- not need to join back into identity.
    user_id         UUID NOT NULL REFERENCES app_user(id),
    phone_e164      TEXT NOT NULL,
    language        language_code NOT NULL,

    channel         notification_channel NOT NULL,

    -- i18n key plus its parameters. NEVER rendered English or Bangla text:
    -- the message is composed at dispatch time in the recipient's language
    -- (docs/localization/i18n-conventions.md).
    template_key    TEXT NOT NULL,
    params          JSONB NOT NULL DEFAULT '{}',

    -- Optional link back to what triggered this.
    order_id        UUID REFERENCES app_order(id),

    status          notification_status NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,

    -- Idempotency. A settlement webhook may be delivered twice; the
    -- application ignores the replay, but this is the backstop that stops a
    -- duplicate SMS reaching a user even if it did not.
    dedupe_key      TEXT NOT NULL,

    CONSTRAINT notification_dedupe_unique UNIQUE (dedupe_key)
);

-- The dispatcher's hot path: oldest pending rows first.
CREATE INDEX IF NOT EXISTS notification_pending_idx
    ON notification_outbox (created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS notification_order_idx
    ON notification_outbox (order_id);
