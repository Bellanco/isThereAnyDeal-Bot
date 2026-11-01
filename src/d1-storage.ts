import type { BundleNotice, WaitlistNotification } from './domain';
import { BUNDLE_KEY, isNoticeKey } from './validation';
import type { OAuthTokens } from './oauth';

export const LEASE_MS = 120_000;
const CATEGORY = /^[a-z0-9_]{1,64}$/;
export type FlagKey = 'oauth_reauth' | 'delivery_halt';
const FLAG_KEYS: readonly FlagKey[] = ['oauth_reauth', 'delivery_halt'];
const ENVELOPE_VERSION = 1;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const KEY_VERSION = /^[A-Za-z0-9._-]{1,32}$/;

export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export class StorageError extends Error {
  constructor(public readonly kind: 'configuration' | 'input' | 'database' | 'crypto' | 'state') {
    super(kind);
    this.name = 'StorageError';
  }
}

interface WorkRow {
  notification_id: string;
  status: 'pending_detail' | 'planned';
  detail_json: string | null;
  parts_json: string | null;
  part_count: number | null;
}

interface PartRow {
  notification_id: string;
  part_index: number;
  text: string;
  status: 'pending' | 'leased' | 'confirmed';
  lease_owner: string | null;
  lease_version: number;
  lease_expires_at: number | null;
  receipt: string | null;
  attempts: number;
  next_attempt_at: number;
  blocked_category: string | null;
  last_category: string | null;
}

interface CredentialRow {
  envelope_version: number;
  key_version: string;
  session_version: number;
  nonce: string;
  ciphertext: string;
  refresh_owner: string | null;
  refresh_claim_version: number;
  refresh_expires_at: number | null;
}

export interface PartClaim {
  notificationId: string;
  partIndex: number;
  owner: string;
  version: number;
  expiresAt: number;
}

export type PartReservation =
  | { status: 'claimed'; claim: PartClaim }
  | { status: 'busy' | 'confirmed' | 'not_found' | 'blocked' | 'waiting' };

/** How a stored part is sent to Telegram: sendMessage (text) or sendRichMessage (rich_html). */
export type PartFormat = 'text' | 'rich_html';

/** Head of the global ordered queue: planned notices in plan order, parts in index order. */
export interface DeliveryCandidate {
  notificationId: string;
  partIndex: number;
  partCount: number;
  text: string;
  format: PartFormat;
  status: 'pending' | 'leased';
  leaseExpiresAt: number | null;
  nextAttemptAt: number;
  attempts: number;
}

export type DeferOutcome = 'deferred' | 'blocked' | 'stale';

/** Durable single-owner reservation of one detail query (I6), CAS like PartClaim. */
export interface DetailClaim {
  notificationId: string;
  owner: string;
  version: number;
  expiresAt: number;
}

export type DetailReservation =
  | { status: 'claimed'; claim: DetailClaim }
  | { status: 'busy' | 'waiting' | 'blocked' | 'planned' | 'not_found' };

/**
 * Durable single-owner reservation of the ITAD poll (I6, migration 0004): OAuth
 * refresh, list and details only run under a valid claim of a due gate.
 */
export interface PollClaim {
  owner: string;
  version: number;
  expiresAt: number;
  startedAt: number;
}

export type PollReservation =
  | { status: 'claimed'; claim: PollClaim }
  | { status: 'not_due'; nextPollAt: number }
  | { status: 'busy' };

const POLL_CLAIM_GUARD = `gate_key = 'itad_poll' AND owner = ? AND claim_version = ?
  AND lease_expires_at = ? AND lease_expires_at > ?`;

/** Guard shared by every mutation of a claimed detail: owner, version and unexpired lease. */
const DETAIL_CLAIM_GUARD = `notification_id = ? AND status = 'pending_detail' AND detail_owner = ?
  AND detail_claim_version = ? AND detail_lease_expires_at = ? AND detail_lease_expires_at > ?`;

export interface QueueStatus {
  pendingDetails: number;
  blockedDetails: number;
  pendingParts: number;
  leasedParts: number;
  blockedParts: number;
  confirmedParts: number;
  oldestOpenFirstSeenAt: number | null;
  nextSendAllowedAt: number | null;
  /** Durable poll gate (I6); null only if the gate row is missing. */
  nextPollAt: number | null;
  lastPollOutcome: string | null;
  flags: Partial<Record<FlagKey, string>>;
}

export interface OAuthOperatorStatus {
  sessionVersion: number | null;
  flags: Partial<Record<FlagKey, string>>;
}

export interface BlockedPartOperatorStatus {
  status: 'pending' | 'leased' | 'confirmed';
  blockedCategory: string | null;
}

export interface OAuthRefreshClaim {
  owner: string;
  version: number;
  expiresAt: number;
  sessionVersion: number;
  tokens: OAuthTokens;
}

export type OAuthReservation =
  | { status: 'claimed'; claim: OAuthRefreshClaim }
  | { status: 'busy' | 'not_found' };

function assertD1<T>(result: D1Result<T>): D1Result<T> {
  if (!result || result.success !== true) throw new StorageError('database');
  return result;
}

/** Notice key: an official notification UUID (lower-cased) or a `bundle:<id>` key. */
function requireId(value: string): string {
  if (!isNoticeKey(value)) throw new StorageError('input');
  return value.toLowerCase();
}

function requireBundleKey(value: string): string {
  if (typeof value !== 'string' || !BUNDLE_KEY.test(value)) throw new StorageError('input');
  return value;
}

function requireText(value: string, maximum = 512): string {
  if (typeof value !== 'string' || !value || value.length > maximum || !value.isWellFormed() ||
      /[\u0000-\u001f\u007f]/.test(value)) throw new StorageError('input');
  return value;
}

function requireCategory(value: string): string {
  if (typeof value !== 'string' || !CATEGORY.test(value)) throw new StorageError('input');
  return value;
}

function requireFlag(value: FlagKey): FlagKey {
  if (!FLAG_KEYS.includes(value)) throw new StorageError('input');
  return value;
}

function requireTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new StorageError('input');
  return value;
}

function cryptoView(bytes: Uint8Array): BufferSource {
  // Uint8Array view (not DataView): Node's AES-GCM decrypt rejects DataView; workerd accepts both.
  return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength) as BufferSource;
}

function decodeKey(value: string): Uint8Array {
  if (typeof value !== 'string' || !B64.test(value) || value.length % 4 !== 0) {
    throw new StorageError('configuration');
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  } catch {
    throw new StorageError('configuration');
  }
  if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)) !== value) {
    throw new StorageError('configuration');
  }
  return bytes;
}

function encodeUrl(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeUrl(value: string): Uint8Array {
  if (!B64URL.test(value)) throw new StorageError('crypto');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  try {
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    throw new StorageError('crypto');
  }
}

function validateTokens(value: OAuthTokens): OAuthTokens {
  if (!value || typeof value !== 'object' ||
      typeof value.accessToken !== 'string' || !value.accessToken || !value.accessToken.isWellFormed() ||
      /[\u0000-\u0020\u007f]/.test(value.accessToken) ||
      !(value.refreshToken === null || (typeof value.refreshToken === 'string' &&
        !!value.refreshToken && value.refreshToken.isWellFormed() && !/[\u0000-\u0020\u007f]/.test(value.refreshToken))) ||
      !(value.expiresAt === null || Number.isSafeInteger(value.expiresAt)) ||
      typeof value.scope !== 'string' ||
      !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(value.scope) ||
      !value.scope.split(' ').includes('notifications')) {
    throw new StorageError('input');
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt,
    scope: value.scope,
  };
}

function changes(result: D1Result): number {
  assertD1(result);
  const count = result.meta?.changes;
  if (!Number.isSafeInteger(count) || count! < 0) throw new StorageError('database');
  return count!;
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new StorageError('database');
  }
}

export class D1Storage {
  #db: D1Database;
  #key: CryptoKey;
  #keyVersion: string;

  private constructor(db: D1Database, key: CryptoKey, keyVersion: string) {
    this.#db = db;
    this.#key = key;
    this.#keyVersion = keyVersion;
  }

  /** Validates/imports the external Workers secret before any database operation. */
  static async create(db: D1Database, base64Key: string, keyVersion: string): Promise<D1Storage> {
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function' ||
        typeof keyVersion !== 'string' || !KEY_VERSION.test(keyVersion)) {
      throw new StorageError('configuration');
    }
    const raw = decodeKey(base64Key);
    try {
      const key = await crypto.subtle.importKey('raw', cryptoView(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      raw.fill(0);
      return new D1Storage(db, key, keyVersion);
    } catch {
      raw.fill(0);
      throw new StorageError('configuration');
    }
  }

  /** Read-only operator metadata without needing the AES key. */
  static async readOAuthOperatorStatus(db: D1Database): Promise<OAuthOperatorStatus> {
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
      throw new StorageError('configuration');
    }
    const row = await db.prepare(
      'SELECT session_version FROM oauth_credentials WHERE credential_id = 1',
    ).first<{ session_version: number }>();
    if (row && (!Number.isSafeInteger(row.session_version) || row.session_version < 1)) {
      throw new StorageError('database');
    }
    const result: Partial<Record<FlagKey, string>> = {};
    const rows = assertD1(await db.prepare(
      'SELECT flag_key, category FROM bridge_flags ORDER BY flag_key',
    ).all<{ flag_key: FlagKey; category: string }>()).results;
    if (!rows) throw new StorageError('database');
    for (const flag of rows) {
      if (!FLAG_KEYS.includes(flag.flag_key)) throw new StorageError('database');
      result[flag.flag_key] = requireCategory(flag.category);
    }
    return { sessionVersion: row?.session_version ?? null, flags: result };
  }

  /** Read one row's state/category only; message text and receipt are never selected. */
  static async readBlockedPartOperatorStatus(
    db: D1Database, id: string, index: number,
  ): Promise<BlockedPartOperatorStatus | null> {
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
      throw new StorageError('configuration');
    }
    const notificationId = requireId(id);
    if (!Number.isSafeInteger(index) || index < 0) throw new StorageError('input');
    const row = await db.prepare(
      `SELECT status, blocked_category FROM delivery_parts
       WHERE notification_id = ? AND part_index = ?`,
    ).bind(notificationId, index).first<{ status: BlockedPartOperatorStatus['status']; blocked_category: string | null }>();
    if (!row) return null;
    if (!['pending', 'leased', 'confirmed'].includes(row.status) ||
        !(row.blocked_category === null || CATEGORY.test(row.blocked_category))) throw new StorageError('database');
    return { status: row.status, blockedCategory: row.blocked_category };
  }

  /** Confirm one inspected ambiguous send without constructing a cipher context. */
  static async confirmUnverifiedPartManually(
    db: D1Database, id: string, index: number, now: number, operatorConfirmed: boolean,
  ): Promise<boolean> {
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
      throw new StorageError('configuration');
    }
    const notificationId = requireId(id);
    requireTime(now);
    if (!Number.isSafeInteger(index) || index < 0 || operatorConfirmed !== true) {
      throw new StorageError('input');
    }
    const result = await db.prepare(
      `UPDATE delivery_parts SET status = 'confirmed', receipt = ?, blocked_category = NULL, blocked_at = NULL
       WHERE notification_id = ? AND part_index = ? AND status = 'pending'
         AND blocked_category IN ('unverified_json', 'unverified_shape', 'unverified_message_id')`,
    ).bind(`operator_manual:${now}`, notificationId, index).run();
    return changes(result) === 1;
  }

  /** Requeue one ambiguous send only after explicit duplicate-risk acknowledgement. */
  static async retryUnverifiedPartManually(
    db: D1Database, id: string, index: number, now: number, duplicateRiskAcknowledged: boolean,
  ): Promise<boolean> {
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
      throw new StorageError('configuration');
    }
    const notificationId = requireId(id);
    requireTime(now);
    if (!Number.isSafeInteger(index) || index < 0 || duplicateRiskAcknowledged !== true) {
      throw new StorageError('input');
    }
    const result = await db.prepare(
      `UPDATE delivery_parts SET blocked_category = NULL, blocked_at = NULL, next_attempt_at = ?
       WHERE notification_id = ? AND part_index = ? AND status = 'pending'
         AND blocked_category IN ('unverified_json', 'unverified_shape', 'unverified_message_id')`,
    ).bind(now, notificationId, index).run();
    return changes(result) === 1;
  }

  async baselineComplete(): Promise<boolean> {
    const row = await this.#db.prepare(
      "SELECT 1 AS complete FROM bridge_state WHERE state_key = 'baseline' AND complete = 1",
    ).first<{ complete: number }>();
    return row !== null;
  }

  /** One D1 batch atomically inserts every baseline ID and its one-time marker. */
  async initializeBaseline(ids: readonly string[], now: number): Promise<'initialized' | 'already-initialized'> {
    requireTime(now);
    const normalized = [...new Set(ids.map(requireId))];
    const runId = encodeUrl(crypto.getRandomValues(new Uint8Array(16)));
    const statements = [
      this.#db.prepare(
        "INSERT OR IGNORE INTO bridge_state(state_key, complete, run_id) VALUES('baseline', 1, ?)",
      ).bind(runId),
      this.#db.prepare(
        `INSERT OR IGNORE INTO known_notifications(notification_id, source, first_seen_at)
         SELECT value, 'baseline', ? FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM bridge_state WHERE state_key = 'baseline' AND run_id = ?)`,
      ).bind(now, JSON.stringify(normalized), runId),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    result.forEach(assertD1);
    const markerChanges = changes(result[0]!);
    if (markerChanges === 1) return 'initialized';
    if (markerChanges === 0 && await this.baselineComplete()) return 'already-initialized';
    throw new StorageError('database');
  }

  /** Newly seen IDs remain durable until their detail and complete message plan are saved. */
  async discover(ids: readonly string[], now: number): Promise<string[]> {
    requireTime(now);
    const normalized = [...new Set(ids.map(requireId))];
    if (!await this.baselineComplete()) throw new StorageError('state');
    if (!normalized.length) return [];
    const encoded = JSON.stringify(normalized);
    const statements = [
      this.#db.prepare(
        `INSERT OR IGNORE INTO known_notifications(notification_id, source, first_seen_at)
         SELECT value, 'new', ? FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM bridge_state WHERE state_key = 'baseline' AND complete = 1)`,
      ).bind(now, encoded),
      // Insertion (rowid) order follows the caller's order, used for detail work order.
      this.#db.prepare(
        `INSERT OR IGNORE INTO notification_work(notification_id, status)
         SELECT known.notification_id, 'pending_detail'
         FROM known_notifications AS known JOIN json_each(?) AS incoming
           ON known.notification_id = incoming.value
         WHERE known.source = 'new' ORDER BY incoming.key`,
      ).bind(encoded),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    result.forEach(assertD1);
    const rows = assertD1(await this.#db.prepare(
      `SELECT work.notification_id FROM notification_work AS work
       JOIN json_each(?) AS incoming ON work.notification_id = incoming.value
       WHERE work.status = 'pending_detail' ORDER BY work.notification_id`,
    ).bind(encoded).all<{ notification_id: string }>()).results;
    if (!rows) throw new StorageError('database');
    return rows.map(row => row.notification_id);
  }

  async pendingDetailIds(): Promise<string[]> {
    const rows = assertD1(await this.#db.prepare(
      "SELECT notification_id FROM notification_work WHERE status = 'pending_detail' ORDER BY notification_id",
    ).all<{ notification_id: string }>()).results;
    if (!rows) throw new StorageError('database');
    return rows.map(row => row.notification_id);
  }

  /** False until the first bundle listing was recorded (migration 0005 `bundle_state`). */
  async bundleBaselineComplete(): Promise<boolean> {
    const row = await this.#db.prepare(
      "SELECT 1 AS complete FROM bundle_state WHERE state_key = 'bundles'",
    ).first<{ complete: number }>();
    return row !== null;
  }

  /**
   * One D1 batch atomically records every listed bundle as already known (never
   * notified) together with the one-time marker, like `initializeBaseline`.
   */
  async initializeBundleBaseline(
    keys: readonly string[], now: number, nextCheckAt: number,
  ): Promise<'initialized' | 'already-initialized'> {
    requireTime(now);
    requireTime(nextCheckAt);
    const normalized = [...new Set(keys.map(requireBundleKey))];
    const runId = encodeUrl(crypto.getRandomValues(new Uint8Array(16)));
    const statements = [
      this.#db.prepare(
        "INSERT OR IGNORE INTO bundle_state(state_key, baseline_run_id, next_check_at) VALUES('bundles', ?, ?)",
      ).bind(runId, nextCheckAt),
      this.#db.prepare(
        `INSERT OR IGNORE INTO known_notifications(notification_id, source, first_seen_at)
         SELECT value, 'baseline', ? FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM bundle_state WHERE state_key = 'bundles' AND baseline_run_id = ?)`,
      ).bind(now, JSON.stringify(normalized), runId),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    result.forEach(assertD1);
    const markerChanges = changes(result[0]!);
    if (markerChanges === 1) return 'initialized';
    if (markerChanges === 0 && await this.bundleBaselineComplete()) return 'already-initialized';
    throw new StorageError('database');
  }

  /**
   * CAS that claims the hourly bundle check by moving `next_check_at` forward at once:
   * a run that dies costs one skipped interval instead of repeating the same work
   * every minute. False if it is not due (or the baseline is not complete).
   */
  async claimBundleCheck(now: number, claimMs: number): Promise<boolean> {
    requireTime(now);
    if (!Number.isSafeInteger(claimMs) || claimMs < 1 || !Number.isSafeInteger(now + claimMs)) {
      throw new StorageError('input');
    }
    const row = await this.#db.prepare(
      `UPDATE bundle_state SET next_check_at = ?
       WHERE state_key = 'bundles' AND next_check_at <= ? RETURNING next_check_at`,
    ).bind(now + claimMs, now).first<{ next_check_at: number }>();
    return row !== null;
  }

  /** Schedules the next bundle check after a finished one (success or failure). */
  async scheduleBundleCheck(nextCheckAt: number): Promise<void> {
    requireTime(nextCheckAt);
    assertD1(await this.#db.prepare(
      "UPDATE bundle_state SET next_check_at = ? WHERE state_key = 'bundles'",
    ).bind(nextCheckAt).run());
  }

  /** Keys not recorded yet, in the order received. */
  async unknownBundleKeys(keys: readonly string[]): Promise<string[]> {
    const normalized = [...new Set(keys.map(requireBundleKey))];
    if (!normalized.length) return [];
    const rows = assertD1(await this.#db.prepare(
      `SELECT incoming.value AS notification_id FROM json_each(?) AS incoming
       WHERE NOT EXISTS (SELECT 1 FROM known_notifications AS known
                         WHERE known.notification_id = incoming.value)
       ORDER BY incoming.key`,
    ).bind(JSON.stringify(normalized)).all<{ notification_id: string }>()).results;
    if (!rows) throw new StorageError('database');
    return rows.map(row => row.notification_id);
  }

  /** Bundles with no game of the Waitlist: remembered so they are never evaluated again. */
  async recordBundlesSeen(keys: readonly string[], now: number): Promise<void> {
    requireTime(now);
    const normalized = [...new Set(keys.map(requireBundleKey))];
    if (!normalized.length) return;
    assertD1(await this.#db.prepare(
      `INSERT OR IGNORE INTO known_notifications(notification_id, source, first_seen_at)
       SELECT value, 'new', ? FROM json_each(?)`,
    ).bind(now, JSON.stringify(normalized)).run());
  }

  /**
   * Records a bundle as known and plans every part of its message in one atomic
   * batch, queued behind the notices already planned. False (nothing written) if the
   * bundle already has a plan or was recorded by the baseline. Callers pass only keys
   * `unknownBundleKeys` returned.
   */
  async saveBundlePlan(
    key: string, notice: BundleNotice, parts: readonly string[], now: number,
  ): Promise<boolean> {
    const notificationId = requireBundleKey(key);
    requireTime(now);
    if (!notice || typeof notice !== 'object' || !Array.isArray(parts) || parts.length === 0 ||
        parts.some(part => typeof part !== 'string' || !part || !part.isWellFormed())) {
      throw new StorageError('input');
    }
    const detailJson = JSON.stringify(notice);
    const partsJson = JSON.stringify(parts);
    const statements = [
      this.#db.prepare(
        `INSERT OR IGNORE INTO known_notifications(notification_id, source, first_seen_at)
         VALUES(?, 'new', ?)`,
      ).bind(notificationId, now),
      this.#db.prepare(
        `INSERT OR IGNORE INTO notification_work(
           notification_id, status, detail_json, parts_json, part_count, planned_seq)
         SELECT ?, 'planned', ?, ?, ?, (SELECT COALESCE(MAX(planned_seq), 0) + 1 FROM notification_work)
         WHERE EXISTS (SELECT 1 FROM known_notifications WHERE notification_id = ? AND source = 'new')`,
      ).bind(notificationId, detailJson, partsJson, parts.length, notificationId),
      this.#db.prepare(
        `INSERT OR IGNORE INTO delivery_parts(notification_id, part_index, text, status, format)
         SELECT ?, CAST(item.key AS INTEGER), item.value, 'pending', 'rich_html'
         FROM json_each(?) AS item
         WHERE EXISTS (SELECT 1 FROM notification_work
           WHERE notification_id = ? AND status = 'planned' AND parts_json = ?)`,
      ).bind(notificationId, partsJson, notificationId, partsJson),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    result.forEach(assertD1);
    if (changes(result[1]!) !== 1) return false;

    const saved = await this.#db.prepare(
      `SELECT notification_id, status, detail_json, parts_json, part_count
       FROM notification_work WHERE notification_id = ?`,
    ).bind(notificationId).first<WorkRow>();
    if (!saved || saved.status !== 'planned' || saved.detail_json !== detailJson ||
        saved.parts_json !== partsJson || saved.part_count !== parts.length) throw new StorageError('state');
    const storedParts = assertD1(await this.#db.prepare(
      'SELECT part_index, text, format FROM delivery_parts WHERE notification_id = ? ORDER BY part_index',
    ).bind(notificationId).all<{ part_index: number; text: string; format: PartFormat }>()).results;
    if (!storedParts || storedParts.length !== parts.length ||
        storedParts.some((part, index) =>
          part.part_index !== index || part.text !== parts[index] || part.format !== 'rich_html')) {
      throw new StorageError('database');
    }
    return true;
  }

  /**
   * Persists the official detail and every formatted part in one D1 batch.
   * Only for unreserved details (tests/operator tooling); the cron uses
   * `saveClaimedNotificationPlan`.
   */
  async saveNotificationPlan(
    id: string,
    detail: WaitlistNotification,
    parts: readonly string[],
    format: PartFormat = 'text',
  ): Promise<void> {
    await this.#savePlan(id, detail, parts, null, format);
  }

  /**
   * Same atomic plan write, guarded by the detail reservation. Returns false (no
   * change) if the claim is stale: expired, replaced or already resolved.
   */
  async saveClaimedNotificationPlan(
    claim: DetailClaim,
    detail: WaitlistNotification,
    parts: readonly string[],
    now: number,
    format: PartFormat = 'text',
  ): Promise<boolean> {
    this.#validateDetailClaim(claim, now);
    return this.#savePlan(claim.notificationId, detail, parts, { claim, now }, format);
  }

  async #savePlan(
    id: string,
    detail: WaitlistNotification,
    parts: readonly string[],
    guard: { claim: DetailClaim; now: number } | null,
    format: PartFormat,
  ): Promise<boolean> {
    const notificationId = requireId(id);
    if (!detail || typeof detail !== 'object' || requireId(detail.id) !== notificationId ||
        !Array.isArray(parts) || parts.length === 0 || (format !== 'text' && format !== 'rich_html') ||
        parts.some(part => typeof part !== 'string' || !part || !part.isWellFormed())) {
      throw new StorageError('input');
    }
    const detailJson = JSON.stringify(detail);
    const partsJson = JSON.stringify(parts);
    if (typeof detailJson !== 'string' || typeof partsJson !== 'string') throw new StorageError('input');
    const claimGuard = guard
      ? `AND ${DETAIL_CLAIM_GUARD}`
      : 'AND notification_id = ? AND detail_owner IS NULL';
    const claimValues = guard
      ? [notificationId, guard.claim.owner, guard.claim.version, guard.claim.expiresAt, guard.now]
      : [notificationId];
    const statements = [
      this.#db.prepare(
        `UPDATE notification_work SET status = 'planned', detail_json = ?, parts_json = ?, part_count = ?,
           planned_seq = (SELECT COALESCE(MAX(planned_seq), 0) + 1 FROM notification_work),
           detail_owner = NULL, detail_lease_expires_at = NULL
         WHERE notification_id = ? AND status = 'pending_detail' ${claimGuard}
           AND EXISTS (SELECT 1 FROM known_notifications
                       WHERE notification_id = ? AND source = 'new')`,
      ).bind(detailJson, partsJson, parts.length, notificationId, ...claimValues, notificationId),
      this.#db.prepare(
        `INSERT OR IGNORE INTO delivery_parts(notification_id, part_index, text, status, format)
         SELECT ?, CAST(item.key AS INTEGER), item.value, 'pending', ?
         FROM json_each(?) AS item
         WHERE EXISTS (SELECT 1 FROM notification_work
           WHERE notification_id = ? AND status = 'planned' AND parts_json = ?)`,
      ).bind(notificationId, format, partsJson, notificationId, partsJson),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    result.forEach(assertD1);
    // A stale owner never writes, verifies or reports another owner's plan as its own.
    if (guard && changes(result[0]!) !== 1) return false;

    const saved = await this.#db.prepare(
      `SELECT notification_id, status, detail_json, parts_json, part_count
       FROM notification_work WHERE notification_id = ?`,
    ).bind(notificationId).first<WorkRow>();
    if (!saved) throw new StorageError('state');
    if (saved.status !== 'planned' || saved.detail_json !== detailJson ||
        saved.parts_json !== partsJson || saved.part_count !== parts.length) throw new StorageError('state');
    const storedParts = assertD1(await this.#db.prepare(
      'SELECT part_index, text, format FROM delivery_parts WHERE notification_id = ? ORDER BY part_index',
    ).bind(notificationId).all<{ part_index: number; text: string; format: PartFormat }>()).results;
    if (!storedParts || storedParts.length !== parts.length ||
        storedParts.some((part, index) =>
          part.part_index !== index || part.text !== parts[index] || part.format !== format)) {
      throw new StorageError('database');
    }
    return true;
  }

  async notificationPlan(id: string): Promise<{ detail: WaitlistNotification; parts: string[] } | null> {
    const notificationId = requireId(id);
    const row = await this.#db.prepare(
      `SELECT detail_json, parts_json, part_count FROM notification_work
       WHERE notification_id = ? AND status = 'planned'`,
    ).bind(notificationId).first<{ detail_json: string; parts_json: string; part_count: number }>();
    if (!row) return null;
    const detail = parseJson<WaitlistNotification>(row.detail_json);
    const parts = parseJson<unknown>(row.parts_json);
    if (!Array.isArray(parts) || parts.length !== row.part_count ||
        parts.some(part => typeof part !== 'string')) throw new StorageError('database');
    return { detail, parts: parts as string[] };
  }

  async notificationParts(id: string): Promise<PartRow[]> {
    const notificationId = requireId(id);
    const rows = assertD1(await this.#db.prepare(
      `SELECT notification_id, part_index, text, status, lease_owner, lease_version,
              lease_expires_at, receipt, attempts, next_attempt_at, blocked_category, last_category
       FROM delivery_parts WHERE notification_id = ? ORDER BY part_index`,
    ).bind(notificationId).all<PartRow>()).results;
    if (!rows) throw new StorageError('database');
    return rows;
  }

  async claimPart(id: string, index: number, owner: string, now: number): Promise<PartReservation> {
    const notificationId = requireId(id);
    requireText(owner);
    requireTime(now);
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(now + LEASE_MS)) {
      throw new StorageError('input');
    }
    const row = await this.#db.prepare(
      `UPDATE delivery_parts SET status = 'leased', lease_owner = ?,
         lease_version = lease_version + 1, lease_expires_at = ?
       WHERE notification_id = ? AND part_index = ? AND status != 'confirmed'
         AND (status = 'pending' OR lease_expires_at <= ?)
         AND blocked_category IS NULL AND next_attempt_at <= ?
       RETURNING lease_version`,
    ).bind(owner, now + LEASE_MS, notificationId, index, now, now).first<{ lease_version: number }>();
    if (row) return {
      status: 'claimed',
      claim: { notificationId, partIndex: index, owner, version: row.lease_version, expiresAt: now + LEASE_MS },
    };
    const existing = await this.#db.prepare(
      `SELECT status, blocked_category, next_attempt_at FROM delivery_parts
       WHERE notification_id = ? AND part_index = ?`,
    ).bind(notificationId, index).first<Pick<PartRow, 'status' | 'blocked_category' | 'next_attempt_at'>>();
    if (!existing) return { status: 'not_found' };
    if (existing.status === 'confirmed') return { status: 'confirmed' };
    if (existing.blocked_category !== null) return { status: 'blocked' };
    if (existing.status === 'pending' && existing.next_attempt_at > now) return { status: 'waiting' };
    return { status: 'busy' };
  }

  /** First unconfirmed part of the oldest planned notice without blocked parts. */
  async nextDeliveryPart(): Promise<DeliveryCandidate | null> {
    const row = await this.#db.prepare(
      `SELECT part.notification_id, part.part_index, work.part_count, part.text, part.format, part.status,
              part.lease_expires_at, part.next_attempt_at, part.attempts
       FROM delivery_parts AS part
       JOIN notification_work AS work ON work.notification_id = part.notification_id
       WHERE work.status = 'planned' AND part.status IN ('pending', 'leased')
         AND NOT EXISTS (SELECT 1 FROM delivery_parts AS blocked
                         WHERE blocked.notification_id = part.notification_id
                           AND blocked.blocked_category IS NOT NULL)
       ORDER BY work.planned_seq, work.rowid, part.part_index
       LIMIT 1`,
    ).first<{
      notification_id: string; part_index: number; part_count: number; text: string; format: PartFormat;
      status: 'pending' | 'leased'; lease_expires_at: number | null; next_attempt_at: number; attempts: number;
    }>();
    if (!row) return null;
    if (typeof row.text !== 'string' || !Number.isSafeInteger(row.part_index) ||
        !Number.isSafeInteger(row.part_count) || !Number.isSafeInteger(row.next_attempt_at) ||
        !Number.isSafeInteger(row.attempts) || (row.status !== 'pending' && row.status !== 'leased') ||
        (row.format !== 'text' && row.format !== 'rich_html')) {
      throw new StorageError('database');
    }
    return {
      notificationId: row.notification_id, partIndex: row.part_index, partCount: row.part_count,
      text: row.text, format: row.format, status: row.status, leaseExpiresAt: row.lease_expires_at,
      nextAttemptAt: row.next_attempt_at, attempts: row.attempts,
    };
  }

  /**
   * Returns the lease to pending with a durable next attempt time. Counted failures
   * block the part once `maxAttempts` is reached; rate limits are not counted.
   */
  async deferPart(claim: PartClaim, now: number, options: {
    category: string; nextAttemptAt: number; countAttempt: boolean; maxAttempts: number;
  }): Promise<DeferOutcome> {
    this.#validatePartClaim(claim, now);
    const category = requireCategory(options.category);
    requireTime(options.nextAttemptAt);
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) throw new StorageError('input');
    const increment = options.countAttempt ? 1 : 0;
    const row = await this.#db.prepare(
      `UPDATE delivery_parts SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         attempts = attempts + ?, last_category = ?, next_attempt_at = ?,
         blocked_category = CASE WHEN attempts + ? >= ? THEN 'transient_exhausted' ELSE NULL END,
         blocked_at = CASE WHEN attempts + ? >= ? THEN ? ELSE NULL END
       WHERE notification_id = ? AND part_index = ? AND status = 'leased'
         AND lease_owner = ? AND lease_version = ? AND lease_expires_at = ? AND lease_expires_at > ?
       RETURNING blocked_category`,
    ).bind(
      increment, category, options.nextAttemptAt,
      increment, options.maxAttempts, increment, options.maxAttempts, now,
      claim.notificationId, claim.partIndex, claim.owner, claim.version, claim.expiresAt, now,
    ).first<{ blocked_category: string | null }>();
    if (!row) return 'stale';
    return row.blocked_category === null ? 'deferred' : 'blocked';
  }

  /** Permanent failure: kept visible and recoverable, never deleted or confirmed. */
  async blockPart(claim: PartClaim, now: number, category: string): Promise<boolean> {
    this.#validatePartClaim(claim, now);
    requireCategory(category);
    const result = await this.#db.prepare(
      `UPDATE delivery_parts SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         attempts = attempts + 1, last_category = ?, blocked_category = ?, blocked_at = ?
       WHERE notification_id = ? AND part_index = ? AND status = 'leased'
         AND lease_owner = ? AND lease_version = ? AND lease_expires_at = ? AND lease_expires_at > ?`,
    ).bind(
      category, category, now,
      claim.notificationId, claim.partIndex, claim.owner, claim.version, claim.expiresAt, now,
    ).run();
    return changes(result) === 1;
  }

  /** Global durable send slot for the single configured chat; CAS shared by overlapping runs. */
  async reserveSendSlot(now: number, intervalMs: number): Promise<{ status: 'reserved' } | { status: 'wait'; until: number }> {
    requireTime(now);
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || !Number.isSafeInteger(now + intervalMs)) {
      throw new StorageError('input');
    }
    const reserved = await this.#db.prepare(
      `INSERT INTO chat_throttle(chat_key, next_allowed_at) VALUES('telegram', ?)
       ON CONFLICT(chat_key) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
       WHERE chat_throttle.next_allowed_at <= ?
       RETURNING next_allowed_at`,
    ).bind(now + intervalMs, now).first<{ next_allowed_at: number }>();
    if (reserved) return { status: 'reserved' };
    const current = await this.#db.prepare(
      "SELECT next_allowed_at FROM chat_throttle WHERE chat_key = 'telegram'",
    ).first<{ next_allowed_at: number }>();
    if (!current || !Number.isSafeInteger(current.next_allowed_at)) throw new StorageError('database');
    return { status: 'wait', until: current.next_allowed_at };
  }

  /** Telegram retry_after applies to the whole chat; never shortens an existing wait. */
  async deferSends(until: number): Promise<void> {
    requireTime(until);
    assertD1(await this.#db.prepare(
      `INSERT INTO chat_throttle(chat_key, next_allowed_at) VALUES('telegram', ?)
       ON CONFLICT(chat_key) DO UPDATE SET next_allowed_at = MAX(chat_throttle.next_allowed_at, excluded.next_allowed_at)`,
    ).bind(until).run());
  }

  /** Detail work in discovery order, excluding blocked, not-yet-due or validly reserved entries. */
  async detailWork(now: number, limit: number): Promise<string[]> {
    requireTime(now);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new StorageError('input');
    const rows = assertD1(await this.#db.prepare(
      `SELECT notification_id FROM notification_work
       WHERE status = 'pending_detail' AND detail_blocked IS NULL AND detail_next_at <= ?
         AND (detail_owner IS NULL OR detail_lease_expires_at <= ?)
       ORDER BY rowid LIMIT ?`,
    ).bind(now, now, limit).all<{ notification_id: string }>()).results;
    if (!rows) throw new StorageError('database');
    return rows.map(row => row.notification_id);
  }

  /**
   * CAS reservation before querying a detail: one owner per attempt across
   * overlapping runs. Eligibility (not blocked, backoff due) is re-checked in the
   * same statement, so a run that read stale work cannot consume an attempt.
   * An expired reservation (crashed run) can be taken over after LEASE_MS.
   */
  async claimDetail(id: string, owner: string, now: number): Promise<DetailReservation> {
    const notificationId = requireId(id);
    requireText(owner);
    requireTime(now);
    if (!Number.isSafeInteger(now + LEASE_MS)) throw new StorageError('input');
    const row = await this.#db.prepare(
      `UPDATE notification_work SET detail_owner = ?, detail_claim_version = detail_claim_version + 1,
         detail_lease_expires_at = ?
       WHERE notification_id = ? AND status = 'pending_detail' AND detail_blocked IS NULL
         AND detail_next_at <= ? AND (detail_owner IS NULL OR detail_lease_expires_at <= ?)
       RETURNING detail_claim_version`,
    ).bind(owner, now + LEASE_MS, notificationId, now, now).first<{ detail_claim_version: number }>();
    if (row) {
      if (!Number.isSafeInteger(row.detail_claim_version) || row.detail_claim_version < 1) {
        throw new StorageError('database');
      }
      return {
        status: 'claimed',
        claim: { notificationId, owner, version: row.detail_claim_version, expiresAt: now + LEASE_MS },
      };
    }
    const existing = await this.#db.prepare(
      `SELECT status, detail_blocked, detail_next_at FROM notification_work WHERE notification_id = ?`,
    ).bind(notificationId).first<{ status: string; detail_blocked: string | null; detail_next_at: number }>();
    if (!existing) return { status: 'not_found' };
    if (existing.status !== 'pending_detail') return { status: 'planned' };
    if (existing.detail_blocked !== null) return { status: 'blocked' };
    if (existing.detail_next_at > now) return { status: 'waiting' };
    return { status: 'busy' };
  }

  /**
   * Records a failed query of the claimed detail and releases the reservation.
   * A stale owner (expired/replaced claim) changes nothing and gets 'stale'.
   */
  async recordDetailFailure(claim: DetailClaim, now: number, options: {
    category: string; nextAt: number; countAttempt: boolean; permanent: boolean; maxAttempts: number;
  }): Promise<DeferOutcome> {
    this.#validateDetailClaim(claim, now);
    requireTime(options.nextAt);
    const category = requireCategory(options.category);
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) throw new StorageError('input');
    const increment = options.countAttempt || options.permanent ? 1 : 0;
    const row = await this.#db.prepare(
      `UPDATE notification_work SET detail_attempts = detail_attempts + ?, detail_last_category = ?,
         detail_next_at = ?, detail_owner = NULL, detail_lease_expires_at = NULL,
         detail_blocked = CASE WHEN ? = 1 THEN ? WHEN detail_attempts + ? >= ? THEN 'detail_retries_exhausted'
                          ELSE NULL END
       WHERE ${DETAIL_CLAIM_GUARD}
       RETURNING detail_blocked`,
    ).bind(
      increment, category, options.nextAt, options.permanent ? 1 : 0, category, increment, options.maxAttempts,
      claim.notificationId, claim.owner, claim.version, claim.expiresAt, now,
    ).first<{ detail_blocked: string | null }>();
    if (!row) return 'stale';
    return row.detail_blocked === null ? 'deferred' : 'blocked';
  }

  /** Returns a claimed detail without counting an attempt; never touches another owner's claim. */
  async releaseDetail(claim: DetailClaim, now: number): Promise<boolean> {
    this.#validateDetailClaim(claim, now);
    const result = await this.#db.prepare(
      `UPDATE notification_work SET detail_owner = NULL, detail_lease_expires_at = NULL
       WHERE ${DETAIL_CLAIM_GUARD}`,
    ).bind(claim.notificationId, claim.owner, claim.version, claim.expiresAt, now).run();
    return changes(result) === 1;
  }

  /**
   * CAS claim of the durable ITAD poll gate. Succeeds only if the gate is due
   * (`next_poll_at <= now`) and not validly leased; a crashed owner is taken over
   * after LEASE_MS. A missing gate row is a storage error, never "due".
   */
  async claimPoll(owner: string, now: number): Promise<PollReservation> {
    requireText(owner);
    requireTime(now);
    if (!Number.isSafeInteger(now + LEASE_MS)) throw new StorageError('input');
    const row = await this.#db.prepare(
      `UPDATE poll_gate SET owner = ?, claim_version = claim_version + 1, lease_expires_at = ?,
         last_started_at = ?
       WHERE gate_key = 'itad_poll' AND next_poll_at <= ? AND (owner IS NULL OR lease_expires_at <= ?)
       RETURNING claim_version`,
    ).bind(owner, now + LEASE_MS, now, now, now).first<{ claim_version: number }>();
    if (row) {
      if (!Number.isSafeInteger(row.claim_version) || row.claim_version < 1) throw new StorageError('database');
      return { status: 'claimed', claim: { owner, version: row.claim_version, expiresAt: now + LEASE_MS, startedAt: now } };
    }
    const existing = await this.#db.prepare(
      "SELECT next_poll_at, owner, lease_expires_at FROM poll_gate WHERE gate_key = 'itad_poll'",
    ).first<{ next_poll_at: number; owner: string | null; lease_expires_at: number | null }>();
    if (!existing) throw new StorageError('state');
    if (!Number.isSafeInteger(existing.next_poll_at) ||
        (existing.lease_expires_at !== null && !Number.isSafeInteger(existing.lease_expires_at))) {
      throw new StorageError('database');
    }
    if (existing.owner !== null && existing.lease_expires_at !== null && existing.lease_expires_at > now) {
      return { status: 'busy' };
    }
    if (existing.next_poll_at > now) return { status: 'not_due', nextPollAt: existing.next_poll_at };
    // Lost a race with a claim that already finished: conservatively no poll this tick.
    return { status: 'busy' };
  }

  /** Extends a still-valid poll lease (CAS). Null if expired, replaced or completed. */
  async renewPoll(claim: PollClaim, now: number): Promise<PollClaim | null> {
    this.#validatePollClaim(claim, now);
    if (!Number.isSafeInteger(now + LEASE_MS)) throw new StorageError('input');
    const row = await this.#db.prepare(
      `UPDATE poll_gate SET lease_expires_at = ? WHERE ${POLL_CLAIM_GUARD} RETURNING claim_version`,
    ).bind(now + LEASE_MS, claim.owner, claim.version, claim.expiresAt, now).first<{ claim_version: number }>();
    if (!row) return null;
    return { ...claim, expiresAt: now + LEASE_MS };
  }

  /** Releases the gate and schedules the next due poll; a stale owner changes nothing. */
  async completePoll(claim: PollClaim, now: number, options: { nextPollAt: number; outcome: string }): Promise<boolean> {
    this.#validatePollClaim(claim, now);
    requireTime(options.nextPollAt);
    const outcome = requireCategory(options.outcome);
    const result = await this.#db.prepare(
      `UPDATE poll_gate SET owner = NULL, lease_expires_at = NULL, next_poll_at = ?,
         last_completed_at = ?, last_outcome = ?
       WHERE ${POLL_CLAIM_GUARD}`,
    ).bind(options.nextPollAt, now, outcome, claim.owner, claim.version, claim.expiresAt, now).run();
    return changes(result) === 1;
  }

  /** Releases the gate without moving `next_poll_at`: the next tick may poll again. */
  async releasePoll(claim: PollClaim, now: number, outcome: string): Promise<boolean> {
    this.#validatePollClaim(claim, now);
    const category = requireCategory(outcome);
    const result = await this.#db.prepare(
      `UPDATE poll_gate SET owner = NULL, lease_expires_at = NULL, last_completed_at = ?, last_outcome = ?
       WHERE ${POLL_CLAIM_GUARD}`,
    ).bind(now, category, claim.owner, claim.version, claim.expiresAt, now).run();
    return changes(result) === 1;
  }

  async flags(): Promise<Partial<Record<FlagKey, string>>> {
    const rows = assertD1(await this.#db.prepare(
      'SELECT flag_key, category FROM bridge_flags ORDER BY flag_key',
    ).all<{ flag_key: FlagKey; category: string }>()).results;
    if (!rows) throw new StorageError('database');
    const result: Partial<Record<FlagKey, string>> = {};
    for (const row of rows) {
      if (!FLAG_KEYS.includes(row.flag_key)) throw new StorageError('database');
      result[row.flag_key] = row.category;
    }
    return result;
  }

  /** Keeps the first cause until an operator clears it explicitly. */
  async setFlag(key: FlagKey, category: string, now: number): Promise<void> {
    requireFlag(key);
    requireCategory(category);
    requireTime(now);
    assertD1(await this.#db.prepare(
      'INSERT OR IGNORE INTO bridge_flags(flag_key, category, set_at) VALUES(?, ?, ?)',
    ).bind(key, category, now).run());
  }

  /** Operator action. */
  async clearFlag(key: FlagKey): Promise<boolean> {
    requireFlag(key);
    return changes(await this.#db.prepare('DELETE FROM bridge_flags WHERE flag_key = ?').bind(key).run()) === 1;
  }

  /** Operator action: blocked parts/details become due again; confirmations are untouched. */
  async requeueBlocked(now: number, id?: string): Promise<{ parts: number; details: number }> {
    requireTime(now);
    const filter = id === undefined ? null : requireId(id);
    const statements = [
      this.#db.prepare(
        `UPDATE delivery_parts SET blocked_category = NULL, blocked_at = NULL, attempts = 0, next_attempt_at = ?
         WHERE blocked_category IS NOT NULL AND status = 'pending' AND (? IS NULL OR notification_id = ?)`,
      ).bind(now, filter, filter),
      this.#db.prepare(
        `UPDATE notification_work SET detail_blocked = NULL, detail_attempts = 0, detail_next_at = ?
         WHERE detail_blocked IS NOT NULL AND status = 'pending_detail' AND (? IS NULL OR notification_id = ?)`,
      ).bind(now, filter, filter),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    return { parts: changes(result[0]!), details: changes(result[1]!) };
  }

  /**
   * Operator action after checking the chat (for example an unverified receipt).
   * Records an explicit manual receipt; never used automatically.
   */
  async confirmBlockedPartManually(
    id: string, index: number, now: number, operatorConfirmed: boolean,
  ): Promise<boolean> {
    return D1Storage.confirmUnverifiedPartManually(this.#db, id, index, now, operatorConfirmed);
  }

  /**
   * Retry one ambiguous Telegram send only after an operator explicitly accepts
   * duplicate risk. Destination mismatches are intentionally not recoverable here.
   */
  async retryUnverifiedPartManually(
    id: string, index: number, now: number, duplicateRiskAcknowledged: boolean,
  ): Promise<boolean> {
    return D1Storage.retryUnverifiedPartManually(
      this.#db, id, index, now, duplicateRiskAcknowledged,
    );
  }

  /** Sanitized counts only: no texts, IDs, URLs or credentials. */
  async queueStatus(): Promise<QueueStatus> {
    const row = await this.#db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM notification_work WHERE status = 'pending_detail' AND detail_blocked IS NULL) AS pending_details,
         (SELECT COUNT(*) FROM notification_work WHERE status = 'pending_detail' AND detail_blocked IS NOT NULL) AS blocked_details,
         (SELECT COUNT(*) FROM delivery_parts WHERE status = 'pending' AND blocked_category IS NULL) AS pending_parts,
         (SELECT COUNT(*) FROM delivery_parts WHERE status = 'leased') AS leased_parts,
         (SELECT COUNT(*) FROM delivery_parts WHERE blocked_category IS NOT NULL) AS blocked_parts,
         (SELECT COUNT(*) FROM delivery_parts WHERE status = 'confirmed') AS confirmed_parts,
         (SELECT MIN(known.first_seen_at) FROM known_notifications AS known
            JOIN notification_work AS work ON work.notification_id = known.notification_id
            WHERE work.status = 'pending_detail' OR EXISTS (
              SELECT 1 FROM delivery_parts AS part
              WHERE part.notification_id = work.notification_id AND part.status != 'confirmed')) AS oldest_open,
         (SELECT next_allowed_at FROM chat_throttle WHERE chat_key = 'telegram') AS next_send,
         (SELECT next_poll_at FROM poll_gate WHERE gate_key = 'itad_poll') AS next_poll,
         (SELECT last_outcome FROM poll_gate WHERE gate_key = 'itad_poll') AS last_poll_outcome`,
    ).first<{
      pending_details: number; blocked_details: number; pending_parts: number; leased_parts: number;
      blocked_parts: number; confirmed_parts: number; oldest_open: number | null; next_send: number | null;
      next_poll: number | null; last_poll_outcome: string | null;
    }>();
    if (!row) throw new StorageError('database');
    const counts = [
      row.pending_details, row.blocked_details, row.pending_parts, row.leased_parts,
      row.blocked_parts, row.confirmed_parts,
    ];
    if (counts.some(value => !Number.isSafeInteger(value) || value < 0)) throw new StorageError('database');
    return {
      pendingDetails: row.pending_details, blockedDetails: row.blocked_details,
      pendingParts: row.pending_parts, leasedParts: row.leased_parts,
      blockedParts: row.blocked_parts, confirmedParts: row.confirmed_parts,
      oldestOpenFirstSeenAt: row.oldest_open, nextSendAllowedAt: row.next_send,
      nextPollAt: row.next_poll, lastPollOutcome: row.last_poll_outcome,
      flags: await this.flags(),
    };
  }

  async confirmPart(claim: PartClaim, receipt: string, now: number): Promise<boolean> {
    this.#validatePartClaim(claim, now);
    requireText(receipt);
    const result = await this.#db.prepare(
      `UPDATE delivery_parts SET status = 'confirmed', lease_owner = NULL,
         lease_expires_at = NULL, receipt = ?
       WHERE notification_id = ? AND part_index = ? AND status = 'leased'
         AND lease_owner = ? AND lease_version = ? AND lease_expires_at = ? AND lease_expires_at > ?`,
    ).bind(receipt, claim.notificationId, claim.partIndex, claim.owner, claim.version, claim.expiresAt, now).run();
    return changes(result) === 1;
  }

  async releasePart(claim: PartClaim, now: number): Promise<boolean> {
    this.#validatePartClaim(claim, now);
    const result = await this.#db.prepare(
      `UPDATE delivery_parts SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL
       WHERE notification_id = ? AND part_index = ? AND status = 'leased'
         AND lease_owner = ? AND lease_version = ? AND lease_expires_at = ? AND lease_expires_at > ?`,
    ).bind(claim.notificationId, claim.partIndex, claim.owner, claim.version, claim.expiresAt, now).run();
    return changes(result) === 1;
  }

  async initializeOAuthTokens(tokens: OAuthTokens): Promise<'stored' | 'already-stored'> {
    const validated = validateTokens(tokens);
    const envelope = await this.#encrypt(validated, 1);
    const statements = [
      this.#db.prepare(
        `INSERT INTO oauth_nonce_history(nonce, credential_id, session_version)
         SELECT ?, 1, 1 WHERE NOT EXISTS (
           SELECT 1 FROM oauth_credentials WHERE credential_id = 1
         )`,
      ).bind(envelope.nonce),
      this.#db.prepare(
        `INSERT OR IGNORE INTO oauth_credentials(
          credential_id, envelope_version, key_version, session_version, nonce, ciphertext
        ) VALUES(1, ?, ?, 1, ?, ?)`,
      ).bind(ENVELOPE_VERSION, this.#keyVersion, envelope.nonce, envelope.ciphertext),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    result.forEach(assertD1);
    const count = changes(result[1]!);
    if (count === 1) return 'stored';
    if (count !== 0) throw new StorageError('database');
    const existing = await this.#db.prepare(
      'SELECT * FROM oauth_credentials WHERE credential_id = 1',
    ).first<CredentialRow>();
    if (!existing) throw new StorageError('database');
    const existingTokens = await this.#decrypt(existing);
    if (JSON.stringify(existingTokens) !== JSON.stringify(validated)) throw new StorageError('state');
    return 'already-stored';
  }

  /** Decrypted for the current invocation only; never cached across invocations. */
  async currentOAuth(): Promise<{ sessionVersion: number; tokens: OAuthTokens } | null> {
    const row = await this.#db.prepare(
      'SELECT * FROM oauth_credentials WHERE credential_id = 1',
    ).first<CredentialRow>();
    if (!row) return null;
    return { sessionVersion: row.session_version, tokens: await this.#decrypt(row) };
  }

  async oauthSessionVersion(): Promise<number | null> {
    const row = await this.#db.prepare(
      'SELECT session_version FROM oauth_credentials WHERE credential_id = 1',
    ).first<{ session_version: number }>();
    if (!row) return null;
    if (!Number.isSafeInteger(row.session_version) || row.session_version < 1) throw new StorageError('database');
    return row.session_version;
  }

  /** Explicit reauthorization replaces an unreadable/rotated session using a CAS version. */
  async replaceOAuthTokensAfterReauthorization(
    expectedSessionVersion: number,
    tokens: OAuthTokens,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(expectedSessionVersion) || expectedSessionVersion < 1 ||
        !Number.isSafeInteger(expectedSessionVersion + 1)) throw new StorageError('input');
    const validated = validateTokens(tokens);
    const nextVersion = expectedSessionVersion + 1;
    const envelope = await this.#encrypt(validated, nextVersion);
    const statements = [
      this.#db.prepare(
        `INSERT INTO oauth_nonce_history(nonce, credential_id, session_version)
         SELECT ?, 1, ? FROM oauth_credentials
         WHERE credential_id = 1 AND session_version = ?`,
      ).bind(envelope.nonce, nextVersion, expectedSessionVersion),
      this.#db.prepare(
        `UPDATE oauth_credentials SET envelope_version = ?, key_version = ?, session_version = ?,
           nonce = ?, ciphertext = ?, refresh_owner = NULL, refresh_claim_version = refresh_claim_version + 1,
           refresh_expires_at = NULL
         WHERE credential_id = 1 AND session_version = ?`,
      ).bind(
        ENVELOPE_VERSION, this.#keyVersion, nextVersion, envelope.nonce, envelope.ciphertext,
        expectedSessionVersion,
      ),
      // Successful explicit reauthorization clears the visible reauth flag atomically.
      this.#db.prepare(
        `DELETE FROM bridge_flags WHERE flag_key = 'oauth_reauth'
         AND EXISTS (SELECT 1 FROM oauth_credentials WHERE credential_id = 1 AND session_version = ? AND nonce = ?)`,
      ).bind(nextVersion, envelope.nonce),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    result.forEach(assertD1);
    return changes(result[1]!) === 1;
  }

  async claimOAuthRefresh(owner: string, now: number): Promise<OAuthReservation> {
    requireText(owner);
    requireTime(now);
    const row = await this.#db.prepare(
      'SELECT * FROM oauth_credentials WHERE credential_id = 1',
    ).first<CredentialRow>();
    if (!row) return { status: 'not_found' };
    if (row.refresh_owner !== null && row.refresh_expires_at !== null && row.refresh_expires_at > now) {
      return { status: 'busy' };
    }
    const tokens = await this.#decrypt(row);
    const expiresAt = now + LEASE_MS;
    if (!Number.isSafeInteger(expiresAt)) throw new StorageError('input');
    const claimed = await this.#db.prepare(
      `UPDATE oauth_credentials SET refresh_owner = ?, refresh_claim_version = refresh_claim_version + 1,
         refresh_expires_at = ?
       WHERE credential_id = 1 AND session_version = ?
         AND (refresh_owner IS NULL OR refresh_expires_at <= ?)
       RETURNING refresh_claim_version`,
    ).bind(owner, expiresAt, row.session_version, now).first<{ refresh_claim_version: number }>();
    if (!claimed) return { status: 'busy' };
    return {
      status: 'claimed',
      claim: {
        owner, version: claimed.refresh_claim_version, expiresAt,
        sessionVersion: row.session_version, tokens,
      },
    };
  }

  async commitOAuthRefresh(claim: OAuthRefreshClaim, tokens: OAuthTokens, now: number): Promise<boolean> {
    this.#validateOAuthClaim(claim, now);
    const validated = validateTokens(tokens);
    if (!Number.isSafeInteger(claim.sessionVersion + 1)) throw new StorageError('input');
    const envelope = await this.#encrypt(validated, claim.sessionVersion + 1);
    const guard = `credential_id = 1 AND session_version = ? AND refresh_owner = ?
      AND refresh_claim_version = ? AND refresh_expires_at = ? AND refresh_expires_at > ?`;
    const statements = [
      this.#db.prepare(
        `INSERT INTO oauth_nonce_history(nonce, credential_id, session_version)
         SELECT ?, 1, ? WHERE EXISTS (SELECT 1 FROM oauth_credentials WHERE ${guard})`,
      ).bind(
        envelope.nonce, claim.sessionVersion + 1,
        claim.sessionVersion, claim.owner, claim.version, claim.expiresAt, now,
      ),
      this.#db.prepare(
        `UPDATE oauth_credentials SET session_version = ?, key_version = ?, nonce = ?, ciphertext = ?,
           refresh_owner = NULL, refresh_expires_at = NULL
         WHERE ${guard}`,
      ).bind(
        claim.sessionVersion + 1, this.#keyVersion, envelope.nonce, envelope.ciphertext,
        claim.sessionVersion, claim.owner, claim.version, claim.expiresAt, now,
      ),
    ];
    const result = await this.#db.batch(statements);
    if (result.length !== statements.length) throw new StorageError('database');
    result.forEach(assertD1);
    return changes(result[1]!) === 1;
  }

  async releaseOAuthRefresh(claim: OAuthRefreshClaim, now: number): Promise<boolean> {
    this.#validateOAuthClaim(claim, now);
    const result = await this.#db.prepare(
      `UPDATE oauth_credentials SET refresh_owner = NULL, refresh_expires_at = NULL
       WHERE credential_id = 1 AND session_version = ? AND refresh_owner = ?
         AND refresh_claim_version = ? AND refresh_expires_at = ? AND refresh_expires_at > ?`,
    ).bind(claim.sessionVersion, claim.owner, claim.version, claim.expiresAt, now).run();
    return changes(result) === 1;
  }

  async #encrypt(tokens: OAuthTokens, sessionVersion: number): Promise<{ nonce: string; ciphertext: string }> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(`itad-oauth-envelope:${ENVELOPE_VERSION}:${this.#keyVersion}:${sessionVersion}`);
    const plaintext = new TextEncoder().encode(JSON.stringify(tokens));
    try {
      const encrypted = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: cryptoView(nonce), additionalData: cryptoView(aad) },
        this.#key, cryptoView(plaintext),
      ));
      return { nonce: encodeUrl(nonce), ciphertext: encodeUrl(encrypted) };
    } catch {
      throw new StorageError('crypto');
    } finally {
      plaintext.fill(0);
    }
  }

  async #decrypt(row: CredentialRow): Promise<OAuthTokens> {
    if (row.envelope_version !== ENVELOPE_VERSION || row.key_version !== this.#keyVersion ||
        !Number.isSafeInteger(row.session_version) || row.session_version < 1) throw new StorageError('crypto');
    const nonce = decodeUrl(row.nonce);
    if (nonce.length !== 12) throw new StorageError('crypto');
    const ciphertext = decodeUrl(row.ciphertext);
    const aad = new TextEncoder().encode(`itad-oauth-envelope:${row.envelope_version}:${row.key_version}:${row.session_version}`);
    let plaintext: Uint8Array;
    try {
      plaintext = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: cryptoView(nonce), additionalData: cryptoView(aad) },
        this.#key, cryptoView(ciphertext),
      ));
    } catch {
      throw new StorageError('crypto');
    }
    try {
      return validateTokens(parseJson<OAuthTokens>(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
    } catch {
      throw new StorageError('crypto');
    } finally {
      plaintext.fill(0);
    }
  }

  #validatePartClaim(claim: PartClaim, now: number): void {
    if (!claim || typeof claim !== 'object') throw new StorageError('input');
    requireId(claim.notificationId);
    requireText(claim.owner);
    requireTime(now);
    if (!Number.isSafeInteger(claim.partIndex) || claim.partIndex < 0 ||
        !Number.isSafeInteger(claim.version) || claim.version < 1 ||
        !Number.isSafeInteger(claim.expiresAt) || claim.expiresAt < 1) throw new StorageError('input');
  }

  #validateDetailClaim(claim: DetailClaim, now: number): void {
    if (!claim || typeof claim !== 'object') throw new StorageError('input');
    requireId(claim.notificationId);
    requireText(claim.owner);
    requireTime(now);
    if (!Number.isSafeInteger(claim.version) || claim.version < 1 ||
        !Number.isSafeInteger(claim.expiresAt) || claim.expiresAt < 1) throw new StorageError('input');
  }

  #validatePollClaim(claim: PollClaim, now: number): void {
    if (!claim || typeof claim !== 'object') throw new StorageError('input');
    requireText(claim.owner);
    requireTime(now);
    if (!Number.isSafeInteger(claim.version) || claim.version < 1 ||
        !Number.isSafeInteger(claim.expiresAt) || claim.expiresAt < 1 ||
        !Number.isSafeInteger(claim.startedAt) || claim.startedAt < 0) throw new StorageError('input');
  }

  #validateOAuthClaim(claim: OAuthRefreshClaim, now: number): void {
    if (!claim || typeof claim !== 'object') throw new StorageError('input');
    requireText(claim.owner);
    requireTime(now);
    if (!Number.isSafeInteger(claim.version) || claim.version < 1 ||
        !Number.isSafeInteger(claim.sessionVersion) || claim.sessionVersion < 1 ||
        !Number.isSafeInteger(claim.expiresAt) || claim.expiresAt < 1) throw new StorageError('input');
  }
}
