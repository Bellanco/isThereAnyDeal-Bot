import {
  InputError, type Bundle, type BundleEntry, type BundleNotice, type NotificationSummary, type WaitlistGame,
  type WaitlistNotification,
} from './domain';
import { formatBundle } from './bundles';
import {
  StorageError, type D1Storage, type DetailClaim, type OAuthRefreshClaim, type PartClaim, type PollClaim,
} from './d1-storage';
import { ServiceError } from './itad-http';
import { formatNotification, type BannerMap } from './notifications';
import type { OAuthTokens } from './oauth';
import { TelegramError, type TelegramReceipt } from './telegram';
import { bundleKey } from './validation';

/**
 * PROVISIONAL limits, not an approved production capacity (pending I6 measurement).
 * They bound work per invocation; they never drop games, deals, parts or notices:
 * everything not processed stays durable in D1 for the next run.
 */
export interface BridgeLimits {
  maxDetailsPerRun: number;
  maxSendsPerRun: number;
  /** Global minimum spacing for the single private chat. */
  sendIntervalMs: number;
  /** Short in-run wait for the next slot; anything longer ends the run. */
  maxInlineWaitMs: number;
  maxTransientAttempts: number;
  transientBackoffMs: number;
  maxDetailAttempts: number;
  detailBackoffMs: number;
  /** Refresh ahead of expiry so transient refresh failures can be retried by later runs. */
  refreshMarginMs: number;
  /**
   * Nominal spacing of official ITAD queries (OAuth refresh, list, details) in
   * `runTick`, enforced by the durable poll gate. Delivery ticks run more often.
   */
  pollIntervalMs: number;
  /** Spacing of the bundle checks and the shorter delay before retrying a failed or unfinished one. */
  bundleIntervalMs: number;
  bundleRetryMs: number;
  /** Bundles per ITAD page (1-50) and pages read to record the first listing without notifying it. */
  bundlePageSize: number;
  bundleBaselinePages: number;
  /** Bundles with Waitlist games planned per check; the rest wait for the next check. */
  maxBundlesPerRun: number;
}

export const PROVISIONAL_LIMITS: Readonly<BridgeLimits> = Object.freeze({
  maxDetailsPerRun: 3,
  maxSendsPerRun: 3,
  sendIntervalMs: 1_000,
  maxInlineWaitMs: 1_500,
  maxTransientAttempts: 5,
  transientBackoffMs: 30_000,
  maxDetailAttempts: 5,
  detailBackoffMs: 60_000,
  refreshMarginMs: 24 * 60 * 60_000,
  pollIntervalMs: 5 * 60_000,
  bundleIntervalMs: 60 * 60_000,
  bundleRetryMs: 10 * 60_000,
  bundlePageSize: 50,
  bundleBaselinePages: 10,
  maxBundlesPerRun: 3,
});

/** Renew the 120 s poll lease before an external ITAD/OAuth call when less than this remains. */
const POLL_RENEW_BELOW_MS = 60_000;

type BridgeStorage = Pick<D1Storage,
  | 'flags' | 'setFlag' | 'currentOAuth' | 'claimOAuthRefresh' | 'commitOAuthRefresh' | 'releaseOAuthRefresh'
  | 'baselineComplete' | 'initializeBaseline' | 'discover' | 'detailWork' | 'claimDetail'
  | 'recordDetailFailure' | 'releaseDetail' | 'saveClaimedNotificationPlan' | 'nextDeliveryPart' | 'reserveSendSlot' | 'deferSends' | 'claimPart'
  | 'confirmPart' | 'releasePart' | 'deferPart' | 'blockPart' | 'queueStatus'
  | 'claimPoll' | 'renewPoll' | 'completePoll' | 'releasePoll'
  | 'bundleBaselineComplete' | 'initializeBundleBaseline' | 'claimBundleCheck' | 'scheduleBundleCheck'
  | 'unknownBundleKeys' | 'recordBundlesSeen' | 'saveBundlePlan'>;

export interface BridgeDependencies {
  storage: BridgeStorage;
  itad: {
    list(accessToken: string): Promise<NotificationSummary[]>;
    waitlist(id: string, accessToken: string): Promise<WaitlistNotification>;
    /** Waitlist games (OAuth `wait_read`): banners for notices and the bundle cross-check. */
    waitlistGames?(accessToken: string): Promise<WaitlistGame[]>;
    /** Collection game ids (OAuth `coll_read`): optional "in your Collection" marks. */
    collectionGameIds?(accessToken: string): Promise<string[]>;
  };
  /** Public bundle feed (application API key). Absent: bundle notices are off. */
  bundles?: { list(offset: number, limit: number): Promise<BundleEntry[]> };
  oauth: { refresh(previous: OAuthTokens): Promise<OAuthTokens> };
  telegram: {
    send(text: string): Promise<TelegramReceipt>;
    sendRich(html: string): Promise<TelegramReceipt>;
  };
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Unique per invocation; used as lease owner, never logged. */
  owner: string;
  limits?: Partial<BridgeLimits>;
}

export type PollOutcome =
  | 'listed' | 'baseline_initialized' | 'baseline_already_initialized' | 'reauth_required'
  | 'authorization_missing' | 'refresh_busy' | 'failed'
  /** runTick only: durable gate not due, held by another invocation, or unreadable. */
  | 'not_due' | 'poll_busy' | 'gate_unavailable';

/** `bypassed`: runCycle (standalone). `skipped`: flags unreadable or reauthorization pending. */
export type PollGateState = 'bypassed' | 'skipped' | 'claimed' | 'not_due' | 'busy' | 'unavailable';

export type DeliveryStop =
  | 'idle' | 'batch_limit' | 'waiting_retry' | 'rate_limited' | 'throttled' | 'busy'
  | 'delivery_halt' | 'flags_unavailable' | 'error';

/**
 * off: no bundle feed configured. idle: configured but not evaluated in this invocation.
 * not_due: its own hourly gate is not due. scope_missing: the OAuth grant lacks `wait_read`.
 */
export type BundleState =
  | 'off' | 'idle' | 'not_due' | 'baseline_initialized' | 'baseline_already_initialized'
  | 'checked' | 'scope_missing' | 'failed';

/** Sanitized: counts and fixed categories only. */
export interface CycleSummary {
  ok: boolean;
  poll: PollOutcome;
  pollGate: PollGateState;
  /** Seconds until the durable gate is due again (from D1); null if unknown. */
  nextPollInSeconds: number | null;
  /** External calls attempted in this invocation (sanitized counters). */
  calls: {
    oauthRefresh: number; itadList: number; itadDetail: number; telegramSend: number;
    itadWaitlistGames: number; itadCollection: number; itadBundles: number;
  };
  listed: number;
  baselineRecorded: number;
  pendingDetailInList: number;
  oauthRefreshed: boolean;
  detailsPlanned: number;
  detailsDeferred: number;
  detailsBlocked: number;
  bundles: { state: BundleState; listed: number; baselineRecorded: number; seen: number; planned: number; invalid: number };
  sent: number;
  deferred: number;
  blocked: number;
  deliveryStop: DeliveryStop;
  errors: string[];
  /** Optional enrichment that failed (banners, Collection marks): never blocks a notice. */
  warnings: string[];
  queue: {
    pendingDetails: number; blockedDetails: number; pendingParts: number; leasedParts: number;
    blockedParts: number; confirmedParts: number; oldestOpenAgeSeconds: number | null; flags: string[];
  } | null;
}

const REAUTH_CODES = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_scope']);

/** The durable poll lease expired or was taken over: stop calling ITAD in this invocation. */
class PollLeaseLost extends Error {
  constructor() {
    super('poll_lease_lost');
    this.name = 'PollLeaseLost';
  }
}

function errorCategory(error: unknown): string {
  if (error instanceof PollLeaseLost) return 'poll_lease_lost';
  if (error instanceof StorageError) return `storage_${error.kind}`;
  if (error instanceof ServiceError) {
    return error.oauthCode ? `${error.category}_${error.oauthCode}` : error.category;
  }
  if (error instanceof TelegramError) return `${error.category}_${error.reason}`;
  if (error instanceof InputError) return 'format_rejected';
  return 'unexpected';
}

type BundleFeed = NonNullable<BridgeDependencies['bundles']>;

/** Category of a failed bundle step; the HTTP status tells a rejected application key from an outage. */
function bundleCategory(error: unknown): string {
  if (error instanceof PollLeaseLost) return 'poll_lease_lost';
  if (error instanceof ServiceError && error.category === 'http' && error.status !== undefined) {
    return `bundles_http_${error.status}`;
  }
  return `bundles_${errorCategory(error)}`;
}

/** Distinct game ids (lower case) across every tier of a bundle. */
function bundleGameIds(bundle: Bundle): string[] {
  return [...new Set(bundle.tiers.flatMap(tier => tier.games.map(game => game.id.toLowerCase())))];
}

/**
 * Standalone cycle (tests/one-shot tooling): always polls when flags allow, without
 * the durable poll gate. NOT used by the scheduled composition; see `runTick`.
 */
export function runCycle(deps: BridgeDependencies): Promise<CycleSummary> {
  return execute(deps, false);
}

/**
 * Scheduled tick (every minute in the local cron configuration). Official ITAD
 * queries (OAuth read/refresh, list, details) run only after claiming the durable
 * poll gate when it is due (every `pollIntervalMs`, one owner across instances).
 * Delivery of already persisted parts runs on every tick.
 */
export function runTick(deps: BridgeDependencies): Promise<CycleSummary> {
  return execute(deps, true);
}

async function execute(deps: BridgeDependencies, gated: boolean): Promise<CycleSummary> {
  const limits: BridgeLimits = { ...PROVISIONAL_LIMITS, ...deps.limits };
  const { storage, now } = deps;
  const summary: CycleSummary = {
    ok: false, poll: 'failed', pollGate: gated ? 'skipped' : 'bypassed', nextPollInSeconds: null,
    calls: {
      oauthRefresh: 0, itadList: 0, itadDetail: 0, telegramSend: 0,
      itadWaitlistGames: 0, itadCollection: 0, itadBundles: 0,
    },
    listed: 0, baselineRecorded: 0, pendingDetailInList: 0, oauthRefreshed: false,
    detailsPlanned: 0, detailsDeferred: 0, detailsBlocked: 0,
    bundles: { state: deps.bundles ? 'idle' : 'off', listed: 0, baselineRecorded: 0, seen: 0, planned: 0, invalid: 0 },
    sent: 0, deferred: 0, blocked: 0,
    deliveryStop: 'idle', errors: [], warnings: [], queue: null,
  };
  const fail = (category: string) => {
    if (!summary.errors.includes(category)) summary.errors.push(category);
  };
  const warn = (category: string) => {
    if (!summary.warnings.includes(category)) summary.warnings.push(category);
  };
  /** OAuth scope of the access token this invocation uses (set by `refresh`). */
  let grantedScope = '';
  const hasScope = (scope: string) => grantedScope.split(' ').includes(scope);
  /** Waitlist games, requested at most once per invocation (banners and bundle cross-check). */
  let waitlistRequest: Promise<WaitlistGame[]> | undefined;
  let gate: PollClaim | null = null;
  /** Latest ITAD/OAuth 429 retry time seen by this poll; never shortened by the gate. */
  let itadRetryAt: number | null = null;
  const noteRateLimit = (error: unknown) => {
    if (error instanceof ServiceError && error.category === 'rate_limit') {
      const until = now() + (error.retryAfterSeconds ?? 60) * 1000;
      itadRetryAt = Math.max(itadRetryAt ?? 0, until);
    }
  };
  /** Before each external ITAD/OAuth call in runTick: still owner, lease renewed if short. */
  const ensurePollLease = async () => {
    if (!gated) return;
    if (gate === null) throw new PollLeaseLost();
    if (gate.expiresAt - now() > POLL_RENEW_BELOW_MS) return;
    const renewed = await storage.renewPoll(gate, now());
    if (renewed === null) throw new PollLeaseLost();
    gate = renewed;
  };
  const flag = async (key: 'oauth_reauth' | 'delivery_halt', category: string) => {
    try {
      await storage.setFlag(key, category, now());
    } catch (error) {
      fail(`flag_not_persisted_${errorCategory(error)}`);
    }
  };

  // Fail closed: unknown flags (read failure) are never treated as "no flags".
  // A persisted delivery_halt or oauth_reauth may exist, so this run neither polls
  // nor sends; pending work stays durable in D1 for a later run.
  let flags: Awaited<ReturnType<BridgeStorage['flags']>> | null = null;
  try {
    flags = await storage.flags();
  } catch (error) {
    fail('flags_unavailable');
    fail(errorCategory(error));
  }

  // --- OAuth access (never cached between invocations) ---
  const refresh = async (force: boolean): Promise<string | null> => {
    const current = await storage.currentOAuth();
    if (!current) {
      summary.poll = 'authorization_missing';
      fail('authorization_missing');
      return null;
    }
    const tokens = current.tokens;
    grantedScope = tokens.scope;
    const at = now();
    const usable = tokens.expiresAt === null || tokens.expiresAt > at;
    const expiring = tokens.expiresAt !== null && tokens.expiresAt - at <= limits.refreshMarginMs;
    if (!force && !expiring) return tokens.accessToken;
    if (tokens.refreshToken === null) {
      if (!force && usable) return tokens.accessToken;
      await flag('oauth_reauth', 'refresh_unavailable');
      summary.poll = 'reauth_required';
      fail('oauth_refresh_unavailable');
      return null;
    }
    await ensurePollLease();
    const reservation = await storage.claimOAuthRefresh(deps.owner, now());
    if (reservation.status !== 'claimed') {
      if (reservation.status === 'not_found') {
        summary.poll = 'authorization_missing';
        fail('authorization_missing');
        return null;
      }
      // Another invocation is refreshing; never wait under its lease.
      if (!force && usable) return tokens.accessToken;
      summary.poll = 'refresh_busy';
      return null;
    }
    const claim: OAuthRefreshClaim = reservation.claim;
    if (claim.sessionVersion !== current.sessionVersion) {
      // Rotated by another invocation between read and claim: use the newer stored set.
      await storage.releaseOAuthRefresh(claim, now());
      grantedScope = claim.tokens.scope;
      return claim.tokens.accessToken;
    }
    let next: OAuthTokens;
    try {
      summary.calls.oauthRefresh++;
      next = await deps.oauth.refresh(claim.tokens);
    } catch (error) {
      noteRateLimit(error);
      try {
        await storage.releaseOAuthRefresh(claim, now());
      } catch (releaseError) {
        fail(errorCategory(releaseError));
      }
      if (error instanceof ServiceError && error.category === 'oauth' && error.oauthCode &&
          REAUTH_CODES.has(error.oauthCode)) {
        await flag('oauth_reauth', `oauth_${error.oauthCode}`);
        summary.poll = 'reauth_required';
      }
      // A lost response may already have rotated the token at ITAD: the next refresh
      // then gets invalid_grant and raises the visible reauth flag above.
      fail(`oauth_refresh_${errorCategory(error)}`);
      if (!force && usable && summary.poll !== 'reauth_required') return tokens.accessToken;
      return null;
    }
    summary.oauthRefreshed = true;
    grantedScope = next.scope;
    let committed = false;
    try {
      committed = await storage.commitOAuthRefresh(claim, next, now());
    } catch (error) {
      fail(errorCategory(error));
    }
    if (!committed) {
      // ITAD rotated the refresh token but the durable copy was not updated.
      fail('oauth_refresh_not_persisted');
      await flag('oauth_reauth', 'refresh_not_persisted');
    }
    return next.accessToken;
  };

  // --- Poll gate (runTick): only one due poll across instances; nothing external otherwise ---
  let pollAllowed = false;
  if (flags !== null && flags.oauth_reauth !== undefined) {
    summary.poll = 'reauth_required';
  } else if (flags !== null && summary.errors.length === 0) {
    pollAllowed = true;
  }
  if (pollAllowed && gated) {
    try {
      const reservation = await storage.claimPoll(deps.owner, now());
      if (reservation.status === 'claimed') {
        gate = reservation.claim;
        summary.pollGate = 'claimed';
      } else {
        pollAllowed = false;
        summary.poll = reservation.status === 'not_due' ? 'not_due' : 'poll_busy';
        summary.pollGate = reservation.status;
      }
    } catch (error) {
      // Unknown gate state is never treated as "due" nor reported as success.
      pollAllowed = false;
      summary.poll = 'gate_unavailable';
      summary.pollGate = 'unavailable';
      fail('poll_gate_unavailable');
      fail(errorCategory(error));
    }
  }

  // --- Poll: list, baseline once, durable discovery ---
  let accessToken: string | null = null;
  if (pollAllowed) {
    try {
      accessToken = await refresh(false);
      let list: NotificationSummary[] | null = null;
      if (accessToken !== null) {
        try {
          await ensurePollLease();
          summary.calls.itadList++;
          list = await deps.itad.list(accessToken);
        } catch (error) {
          if (!(error instanceof ServiceError && error.category === 'http' && error.status === 401)) throw error;
          accessToken = await refresh(true);
          if (accessToken !== null) {
            try {
              await ensurePollLease();
              summary.calls.itadList++;
              list = await deps.itad.list(accessToken);
            } catch (retryError) {
              if (retryError instanceof ServiceError && retryError.category === 'http' && retryError.status === 401) {
                await flag('oauth_reauth', 'access_rejected');
                summary.poll = 'reauth_required';
                accessToken = null;
              }
              throw retryError;
            }
          }
        }
      }
      if (list !== null) {
        summary.listed = list.length;
        if (!await storage.baselineComplete()) {
          const result = await storage.initializeBaseline(list.map(item => item.id), now());
          summary.poll = result === 'initialized' ? 'baseline_initialized' : 'baseline_already_initialized';
          if (result === 'initialized') summary.baselineRecorded = list.length;
        } else {
          summary.poll = 'listed';
        }
        if (summary.poll !== 'baseline_initialized') {
          // Oldest first so detail work and plan order follow ITAD's notice order.
          const ordered = [...list].sort((a, b) =>
            Date.parse(a.timestamp) - Date.parse(b.timestamp) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          summary.pendingDetailInList = (await storage.discover(ordered.map(item => item.id), now())).length;
        }
      }
    } catch (error) {
      if (summary.poll !== 'reauth_required') summary.poll = 'failed';
      accessToken = null;
      noteRateLimit(error);
      fail(error instanceof PollLeaseLost ? 'poll_lease_lost' : `itad_${errorCategory(error)}`);
    }
  }

  // --- Details: bounded, durable, never baseline; one durable owner per query ---
  if (accessToken !== null) {
    try {
      const ids = await storage.detailWork(now(), limits.maxDetailsPerRun);
      const banners = ids.length > 0 ? await loadBanners(accessToken) : undefined;
      for (const id of ids) {
        // Still the poll owner before claiming/querying (no dangling detail claim if lost).
        await ensurePollLease();
        // Overlapping runs: only the CAS owner queries; others skip without consuming an attempt.
        const reservation = await storage.claimDetail(id, deps.owner, now());
        if (reservation.status !== 'claimed') continue;
        const claim: DetailClaim = reservation.claim;
        try {
          summary.calls.itadDetail++;
          const detail = await deps.itad.waitlist(id, accessToken);
          const parts = formatNotification(detail, banners ? { banners } : {});
          if (await storage.saveClaimedNotificationPlan(claim, detail, parts, now(), 'rich_html')) summary.detailsPlanned++;
          else fail('detail_lease_lost');
        } catch (error) {
          if (error instanceof StorageError) throw error;
          const category = `detail_${errorCategory(error)}`;
          fail(category);
          const at = now();
          if (error instanceof ServiceError && error.category === 'rate_limit') {
            noteRateLimit(error);
            const wait = (error.retryAfterSeconds ?? 60) * 1000;
            const outcome = await storage.recordDetailFailure(claim, at, {
              category: 'rate_limit', nextAt: at + wait, countAttempt: false, permanent: false,
              maxAttempts: limits.maxDetailAttempts,
            });
            if (outcome === 'stale') fail('detail_lease_lost');
            else summary.detailsDeferred++;
            break;
          }
          if (error instanceof ServiceError && error.category === 'http' && error.status === 401) {
            if (!await storage.releaseDetail(claim, now())) fail('detail_lease_lost');
            break;
          }
          const permanent = error instanceof InputError;
          const outcome = await storage.recordDetailFailure(claim, at, {
            category: permanent ? 'format_rejected' : errorCategory(error),
            nextAt: at + limits.detailBackoffMs, countAttempt: true, permanent,
            maxAttempts: limits.maxDetailAttempts,
          });
          if (outcome === 'stale') fail('detail_lease_lost');
          else if (outcome === 'blocked') summary.detailsBlocked++;
          else summary.detailsDeferred++;
        }
      }
    } catch (error) {
      fail(errorCategory(error));
    }
  }

  // --- Bundles: own hourly gate and Waitlist cross-check; the first listing is never notified ---
  if (accessToken !== null && deps.bundles !== undefined) {
    try {
      await checkBundles(accessToken, deps.bundles);
    } catch (error) {
      summary.bundles.state = 'failed';
      noteRateLimit(error);
      fail(bundleCategory(error));
    }
  }

  // --- Close the poll gate before delivery: next due slot, never shortening a 429 ---
  if (gate !== null) {
    const claim: PollClaim = gate;
    try {
      let done: boolean;
      if (summary.poll === 'refresh_busy') {
        // Another refresh lease is active: retry on a later tick, without waiting a full interval.
        done = await storage.releasePoll(claim, now(), 'refresh_busy');
      } else {
        let nextPollAt = claim.startedAt + Math.max(1, limits.pollIntervalMs);
        if (itadRetryAt !== null) nextPollAt = Math.max(nextPollAt, itadRetryAt);
        done = await storage.completePoll(claim, now(), { nextPollAt, outcome: summary.poll });
      }
      // Stale owner: the gate keeps the newer owner's state (no reschedule by this invocation).
      if (!done) fail('poll_lease_lost');
    } catch (error) {
      fail('poll_gate_not_persisted');
      fail(errorCategory(error));
    }
  }

  // --- Delivery: global order, one notice at a time, durable throttle ---
  if (flags === null) {
    summary.deliveryStop = 'flags_unavailable';
  } else if (flags.delivery_halt !== undefined) {
    summary.deliveryStop = 'delivery_halt';
  } else {
    try {
      summary.deliveryStop = await deliver();
    } catch (error) {
      summary.deliveryStop = 'error';
      fail(errorCategory(error));
    }
  }

  async function deliver(): Promise<DeliveryStop> {
    for (let attempts = 0; attempts < limits.maxSendsPerRun; attempts++) {
      const head = await storage.nextDeliveryPart();
      if (!head) return 'idle';
      const at = now();
      // Head-of-line: never skip ahead of an unfinished part (keeps part/notice order).
      if (head.status === 'leased' && head.leaseExpiresAt !== null && head.leaseExpiresAt > at) return 'busy';
      if (head.nextAttemptAt > at) return 'waiting_retry';
      let slot = await storage.reserveSendSlot(at, limits.sendIntervalMs);
      if (slot.status === 'wait') {
        const wait = slot.until - now();
        // Longer than the normal spacing only after a persisted retry_after: no long sleep under lease.
        if (wait > limits.maxInlineWaitMs) return 'rate_limited';
        if (wait > 0) await deps.sleep(wait);
        slot = await storage.reserveSendSlot(now(), limits.sendIntervalMs);
        if (slot.status === 'wait') return 'throttled';
      }
      const reservation = await storage.claimPart(head.notificationId, head.partIndex, deps.owner, now());
      if (reservation.status !== 'claimed') return 'busy';
      const claim: PartClaim = reservation.claim;
      let receipt: TelegramReceipt;
      try {
        summary.calls.telegramSend++;
        receipt = head.format === 'rich_html'
          ? await deps.telegram.sendRich(head.text) : await deps.telegram.send(head.text);
      } catch (raw) {
        const error = raw instanceof TelegramError ? raw : new TelegramError('transient', 'network');
        fail(`telegram_${error.category}_${error.reason}`);
        const failedAt = now();
        switch (error.category) {
          case 'rate_limit': {
            const until = failedAt + (error.retryAfterSeconds ?? 0) * 1000;
            await storage.deferSends(until);
            const outcome = await storage.deferPart(claim, failedAt, {
              category: 'rate_limit', nextAttemptAt: until, countAttempt: false,
              maxAttempts: limits.maxTransientAttempts,
            });
            if (outcome === 'stale') fail('lease_lost');
            summary.deferred++;
            return 'rate_limited';
          }
          case 'transient': {
            const outcome = await storage.deferPart(claim, failedAt, {
              category: `transient_${error.reason}`,
              nextAttemptAt: failedAt + limits.transientBackoffMs * (head.attempts + 1),
              countAttempt: true, maxAttempts: limits.maxTransientAttempts,
            });
            if (outcome === 'stale') fail('lease_lost');
            if (outcome === 'blocked') {
              summary.blocked++;
              continue;
            }
            summary.deferred++;
            return 'waiting_retry';
          }
          case 'destination': {
            // Configuration problem for every message: keep the part pending, halt all delivery.
            if (!await storage.releasePart(claim, now())) fail('lease_lost');
            await flag('delivery_halt', `telegram_${error.reason}`);
            return 'delivery_halt';
          }
          case 'unverified': {
            if (await storage.blockPart(claim, now(), `unverified_${error.reason}`)) summary.blocked++;
            else fail('lease_lost');
            if (error.reason === 'chat_mismatch' || error.reason === 'not_private') {
              await flag('delivery_halt', `telegram_${error.reason}`);
              return 'delivery_halt';
            }
            continue;
          }
          default: {
            if (await storage.blockPart(claim, now(), `telegram_${error.reason}`)) summary.blocked++;
            else fail('lease_lost');
            continue;
          }
        }
      }
      // A stale owner (lease expired/replaced) cannot confirm: CAS returns false.
      const confirmed = await storage.confirmPart(claim, `telegram_message_id:${receipt.messageId}`, now());
      if (!confirmed) {
        fail('receipt_not_persisted');
        return 'error';
      }
      summary.sent++;
    }
    return 'batch_limit';
  }

  /** Waitlist games, requested at most once per invocation (banners and bundle cross-check). */
  function waitlistGames(token: string): Promise<WaitlistGame[]> {
    if (deps.itad.waitlistGames === undefined) throw new ServiceError('configuration');
    if (waitlistRequest === undefined) {
      summary.calls.itadWaitlistGames++;
      waitlistRequest = deps.itad.waitlistGames(token);
    }
    return waitlistRequest;
  }

  /** Banners are decoration only: a failure costs the images, never the notice. */
  async function loadBanners(token: string): Promise<BannerMap | undefined> {
    if (deps.itad.waitlistGames === undefined || !hasScope('wait_read')) return undefined;
    await ensurePollLease();
    try {
      const games = await waitlistGames(token);
      return new Map(games.flatMap(game => game.banner === null ? [] : [[game.id, game.banner] as const]));
    } catch (error) {
      noteRateLimit(error);
      warn(`banners_${errorCategory(error)}`);
      return undefined;
    }
  }

  /** Collection marks are best effort: without `coll_read` or on failure the notice has no marks. */
  async function loadCollection(token: string): Promise<ReadonlySet<string>> {
    if (deps.itad.collectionGameIds === undefined || !hasScope('coll_read')) return new Set();
    await ensurePollLease();
    try {
      summary.calls.itadCollection++;
      return new Set((await deps.itad.collectionGameIds(token)).map(id => id.toLowerCase()));
    } catch (error) {
      noteRateLimit(error);
      warn(`collection_${errorCategory(error)}`);
      return new Set();
    }
  }

  async function checkBundles(token: string, feed: BundleFeed): Promise<void> {
    if (!hasScope('wait_read')) {
      summary.bundles.state = 'scope_missing';
      fail('bundles_scope_missing');
      return;
    }
    if (!await storage.bundleBaselineComplete()) {
      await recordBundleBaseline(feed);
      return;
    }
    // The claim already moves the next check forward: a run that dies costs one retry
    // interval instead of repeating the same check on every tick.
    if (!await storage.claimBundleCheck(now(), limits.bundleRetryMs)) {
      summary.bundles.state = 'not_due';
      return;
    }
    let nextCheckAt = now() + limits.bundleRetryMs;
    try {
      if (await scanBundles(token, feed)) nextCheckAt = now() + limits.bundleIntervalMs;
    } catch (error) {
      summary.bundles.state = 'failed';
      noteRateLimit(error);
      fail(bundleCategory(error));
    }
    if (itadRetryAt !== null) nextCheckAt = Math.max(nextCheckAt, itadRetryAt);
    try {
      await storage.scheduleBundleCheck(nextCheckAt);
    } catch (error) {
      fail('bundles_schedule_not_persisted');
      fail(errorCategory(error));
    }
  }

  /** First listing: every active bundle becomes known without a message. */
  async function recordBundleBaseline(feed: BundleFeed): Promise<void> {
    const keys: string[] = [];
    for (let page = 0; ; page++) {
      if (page >= limits.bundleBaselinePages) {
        // Never mark a partial listing as complete: the older bundles would later look new.
        summary.bundles.state = 'failed';
        fail('bundles_baseline_too_large');
        return;
      }
      await ensurePollLease();
      summary.calls.itadBundles++;
      const entries = await feed.list(page * limits.bundlePageSize, limits.bundlePageSize);
      keys.push(...entries.map(entry => bundleKey(entry.id)));
      if (entries.length < limits.bundlePageSize) break;
    }
    const result = await storage.initializeBundleBaseline(keys, now(), now() + limits.bundleIntervalMs);
    summary.bundles.state = result === 'initialized' ? 'baseline_initialized' : 'baseline_already_initialized';
    if (result === 'initialized') {
      summary.bundles.listed = keys.length;
      summary.bundles.baselineRecorded = keys.length;
    }
  }

  /** One check of the newest page. True when every unknown bundle was resolved. */
  async function scanBundles(token: string, feed: BundleFeed): Promise<boolean> {
    await ensurePollLease();
    summary.calls.itadBundles++;
    const entries = await feed.list(0, limits.bundlePageSize);
    summary.bundles.state = 'checked';
    summary.bundles.listed = entries.length;
    const byKey = new Map(entries.map(entry => [bundleKey(entry.id), entry] as const));
    const fresh = (await storage.unknownBundleKeys([...byKey.keys()])).map(key => byKey.get(key)!);
    // A body that failed validation stays unrecorded: it is reported every check and
    // evaluated again once it can be read, never silently dropped.
    summary.bundles.invalid = fresh.filter(entry => entry.bundle === null).length;
    if (summary.bundles.invalid > 0) fail('bundle_invalid');
    // Oldest first, so notices are planned in the order ITAD published them.
    const candidates = fresh.flatMap(entry => entry.bundle === null ? [] : [entry.bundle])
      .sort((a, b) => Date.parse(a.publish) - Date.parse(b.publish) || a.id - b.id);
    if (candidates.length === 0) return true;

    await ensurePollLease();
    const waitlist = new Set((await waitlistGames(token)).map(game => game.id.toLowerCase()));
    const matches = new Map<number, string[]>();
    const unmatched: string[] = [];
    for (const bundle of candidates) {
      const ids = bundleGameIds(bundle).filter(id => waitlist.has(id));
      if (ids.length > 0) matches.set(bundle.id, ids);
      else unmatched.push(bundleKey(bundle.id));
    }
    if (unmatched.length > 0) {
      await storage.recordBundlesSeen(unmatched, now());
      summary.bundles.seen = unmatched.length;
    }

    let collection: ReadonlySet<string> | undefined;
    for (const bundle of candidates) {
      const inWaitlist = matches.get(bundle.id);
      if (inWaitlist === undefined) continue;
      if (summary.bundles.planned >= limits.maxBundlesPerRun) return false;
      collection ??= await loadCollection(token);
      const owned = collection;
      const notice: BundleNotice = {
        bundle, waitlist: inWaitlist, collection: bundleGameIds(bundle).filter(id => owned.has(id)),
      };
      let parts: string[];
      try {
        parts = formatBundle(notice);
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        fail('bundle_format_rejected');
        continue;
      }
      if (await storage.saveBundlePlan(bundleKey(bundle.id), notice, parts, now())) summary.bundles.planned++;
    }
    return true;
  }

  try {
    const queue = await storage.queueStatus();
    summary.queue = {
      pendingDetails: queue.pendingDetails, blockedDetails: queue.blockedDetails,
      pendingParts: queue.pendingParts, leasedParts: queue.leasedParts,
      blockedParts: queue.blockedParts, confirmedParts: queue.confirmedParts,
      oldestOpenAgeSeconds: queue.oldestOpenFirstSeenAt === null
        ? null : Math.max(0, Math.floor((now() - queue.oldestOpenFirstSeenAt) / 1000)),
      flags: Object.entries(queue.flags).map(([key, category]) => `${key}:${category}`),
    };
    summary.nextPollInSeconds = queue.nextPollAt === null
      ? null : Math.max(0, Math.ceil((queue.nextPollAt - now()) / 1000));
    for (const entry of summary.queue.flags) fail(`flag_${entry.split(':')[0]}`);
    if (queue.blockedParts > 0 || queue.blockedDetails > 0) fail('blocked_work_present');
  } catch (error) {
    fail(errorCategory(error));
  }
  summary.ok = summary.errors.length === 0;
  return summary;
}
