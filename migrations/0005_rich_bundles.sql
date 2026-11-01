-- Rich messages and bundle notices.
-- Additive only: migrations 0001-0004 are not modified; baseline, known IDs,
-- pending details, plans, parts, receipts, the poll gate and the OAuth envelope
-- are untouched. Apply it before deploying the Worker that writes `format`.

-- How a stored part is sent. Existing parts, and any inserted without a format,
-- stay plain text.
ALTER TABLE delivery_parts ADD COLUMN format TEXT NOT NULL DEFAULT 'text'
  CHECK (format IN ('text', 'rich_html'));

-- Hourly bundle check, separate from the five-minute notification poll. A missing
-- row means the bundle baseline is not complete: nothing is notified before it is.
-- `next_check_at` is advanced when a check starts, so a run that dies never makes
-- the same bundles fail over and over inside the same hour.
CREATE TABLE IF NOT EXISTS bundle_state (
  state_key TEXT PRIMARY KEY CHECK (state_key = 'bundles'),
  baseline_run_id TEXT NOT NULL,
  next_check_at INTEGER NOT NULL CHECK (next_check_at >= 0)
);
