-- OFFLINE REVIEW-ONLY SQLite schema prototype. Never apply automatically to production.
-- These are separate v13 tables; do not rename or drop existing v6 tables.
CREATE TABLE IF NOT EXISTS qmr_broadcast_jobs_v13 (
 id INTEGER PRIMARY KEY,
 content TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','sending','cancelled','done')),
 owner_token TEXT,
 lease_until_ms INTEGER NOT NULL DEFAULT 0,
 fence INTEGER NOT NULL DEFAULT 0,
 created_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS qmr_broadcast_delivery_v13 (
 broadcast_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending'
   CHECK(state IN ('pending','attempting','sent','unknown','blocked')),
 attempts INTEGER NOT NULL DEFAULT 0,
 attempted_ms INTEGER,
 resolved_ms INTEGER,
 retry_after_ms INTEGER,
 -- Intentionally no foreign keys: Telegram Serverless SDK does not guarantee them.
 PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX IF NOT EXISTS qmr_broadcast_delivery_pending_v13
 ON qmr_broadcast_delivery_v13(broadcast_id, state, user_id);
-- Lease acquisition MUST be an atomic CAS and subsequent writes MUST fence stale owners:
-- UPDATE qmr_broadcast_jobs_v13
-- SET owner_token=:token, lease_until_ms=:until, fence=fence+1
-- WHERE id=:id AND state='sending'
--   AND (owner_token IS NULL OR lease_until_ms<=:now);
-- Every delivery transition must verify owner_token AND fence AND lease_until_ms>now.
-- When 'attempting' is orphaned by a crash, retain it for manual 'unknown'
-- reconciliation; NEVER automatically set it back to 'pending'.
