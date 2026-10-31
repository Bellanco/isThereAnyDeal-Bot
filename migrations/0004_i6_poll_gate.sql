-- I6: durable gate for official ITAD queries (OAuth refresh, list and details),
-- due every five minutes, separate from the one-minute delivery tick.
-- Same CAS pattern as other leases: owner, claim_version and a 120 s expiry.
-- Additive only: migrations 0001-0003 are not modified; baseline, known IDs,
-- pending details, plans, parts, receipts and OAuth envelope are untouched.

CREATE TABLE IF NOT EXISTS poll_gate (
  gate_key TEXT PRIMARY KEY CHECK (gate_key = 'itad_poll'),
  next_poll_at INTEGER NOT NULL CHECK (next_poll_at >= 0),
  owner TEXT,
  claim_version INTEGER NOT NULL DEFAULT 0 CHECK (claim_version >= 0),
  lease_expires_at INTEGER CHECK (lease_expires_at IS NULL OR lease_expires_at >= 0),
  last_started_at INTEGER CHECK (last_started_at IS NULL OR last_started_at >= 0),
  last_completed_at INTEGER CHECK (last_completed_at IS NULL OR last_completed_at >= 0),
  last_outcome TEXT
);

-- Seeded as due: the first tick after migrating polls once. A missing row is a
-- storage error (fail closed), never interpreted as "due" or "not due".
INSERT OR IGNORE INTO poll_gate(gate_key, next_poll_at, claim_version) VALUES('itad_poll', 0, 0);