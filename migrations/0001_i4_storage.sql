CREATE TABLE IF NOT EXISTS bridge_state (
  state_key TEXT PRIMARY KEY CHECK (state_key = 'baseline'),
  complete INTEGER NOT NULL CHECK (complete = 1),
  run_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS known_notifications (
  notification_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('baseline', 'new')),
  first_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_work (
  notification_id TEXT PRIMARY KEY REFERENCES known_notifications(notification_id),
  status TEXT NOT NULL CHECK (status IN ('pending_detail', 'planned')),
  detail_json TEXT,
  parts_json TEXT,
  part_count INTEGER,
  CHECK (
    (status = 'pending_detail' AND detail_json IS NULL AND parts_json IS NULL AND part_count IS NULL)
    OR
    (status = 'planned' AND detail_json IS NOT NULL AND parts_json IS NOT NULL AND part_count > 0)
  )
);

CREATE TABLE IF NOT EXISTS delivery_parts (
  notification_id TEXT NOT NULL REFERENCES notification_work(notification_id),
  part_index INTEGER NOT NULL CHECK (part_index >= 0),
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'confirmed')),
  lease_owner TEXT,
  lease_version INTEGER NOT NULL DEFAULT 0 CHECK (lease_version >= 0),
  lease_expires_at INTEGER,
  receipt TEXT,
  PRIMARY KEY (notification_id, part_index),
  CHECK (
    (status = 'pending' AND lease_owner IS NULL AND lease_expires_at IS NULL AND receipt IS NULL)
    OR
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND receipt IS NULL)
    OR
    (status = 'confirmed' AND lease_owner IS NULL AND lease_expires_at IS NULL AND receipt IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS delivery_parts_pending
  ON delivery_parts(status, lease_expires_at, notification_id, part_index);

CREATE TABLE IF NOT EXISTS oauth_credentials (
  credential_id INTEGER PRIMARY KEY CHECK (credential_id = 1),
  envelope_version INTEGER NOT NULL CHECK (envelope_version = 1),
  key_version TEXT NOT NULL,
  session_version INTEGER NOT NULL CHECK (session_version > 0),
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  refresh_owner TEXT,
  refresh_claim_version INTEGER NOT NULL DEFAULT 0 CHECK (refresh_claim_version >= 0),
  refresh_expires_at INTEGER,
  CHECK (
    (refresh_owner IS NULL AND refresh_expires_at IS NULL)
    OR
    (refresh_owner IS NOT NULL AND refresh_expires_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS oauth_nonce_history (
  nonce TEXT PRIMARY KEY,
  credential_id INTEGER NOT NULL CHECK (credential_id = 1),
  session_version INTEGER NOT NULL CHECK (session_version > 0)
);
