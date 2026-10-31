-- I6: durable single-owner reservation of each detail query (same CAS pattern as
-- delivery_parts leases). Additive only: earlier migrations are not modified and
-- existing baseline, pending details, attempts, plans, parts and receipts are kept.
-- Existing rows start unreserved (owner NULL, version 0).

ALTER TABLE notification_work ADD COLUMN detail_owner TEXT;
ALTER TABLE notification_work ADD COLUMN detail_claim_version INTEGER NOT NULL DEFAULT 0 CHECK (detail_claim_version >= 0);
ALTER TABLE notification_work ADD COLUMN detail_lease_expires_at INTEGER CHECK (detail_lease_expires_at IS NULL OR detail_lease_expires_at >= 0);
