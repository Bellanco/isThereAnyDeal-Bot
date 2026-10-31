-- I5: delivery attempts/blocking, notice order, durable chat throttle and visible flags.
-- Additive only: existing baseline, IDs, plans, parts and receipts are preserved.

ALTER TABLE notification_work ADD COLUMN planned_seq INTEGER;
ALTER TABLE notification_work ADD COLUMN detail_attempts INTEGER NOT NULL DEFAULT 0 CHECK (detail_attempts >= 0);
ALTER TABLE notification_work ADD COLUMN detail_next_at INTEGER NOT NULL DEFAULT 0 CHECK (detail_next_at >= 0);
ALTER TABLE notification_work ADD COLUMN detail_blocked TEXT;
ALTER TABLE notification_work ADD COLUMN detail_last_category TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notification_work_planned_seq
  ON notification_work(planned_seq) WHERE planned_seq IS NOT NULL;

ALTER TABLE delivery_parts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0);
ALTER TABLE delivery_parts ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0 CHECK (next_attempt_at >= 0);
ALTER TABLE delivery_parts ADD COLUMN blocked_category TEXT;
ALTER TABLE delivery_parts ADD COLUMN blocked_at INTEGER;
ALTER TABLE delivery_parts ADD COLUMN last_category TEXT;

-- Single fixed destination: one global durable slot shared by overlapping cron runs.
CREATE TABLE IF NOT EXISTS chat_throttle (
  chat_key TEXT PRIMARY KEY CHECK (chat_key = 'telegram'),
  next_allowed_at INTEGER NOT NULL CHECK (next_allowed_at >= 0)
);

-- Operator-visible conditions; categories only, never bodies, URLs or tokens.
CREATE TABLE IF NOT EXISTS bridge_flags (
  flag_key TEXT PRIMARY KEY CHECK (flag_key IN ('oauth_reauth', 'delivery_halt')),
  category TEXT NOT NULL,
  set_at INTEGER NOT NULL CHECK (set_at >= 0)
);
