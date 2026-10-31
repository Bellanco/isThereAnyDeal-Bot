import {
  D1Storage, type D1Database, type DetailClaim, type OAuthRefreshClaim, type PartClaim, type PollClaim,
} from '../src/d1-storage';
import type { OAuthTokens } from '../src/oauth';

interface Env {
  DB: D1Database;
}

const TEST_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const WRONG_TEST_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const BASELINE_FAILURE_ID = '00000000-0000-4000-8000-000000000003';
let storagePromise: Promise<D1Storage> | undefined;

function storage(env: Env): Promise<D1Storage> {
  storagePromise ??= D1Storage.create(env.DB, TEST_KEY, 'test-key-v1');
  return storagePromise;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('test_input');
  return value as Record<string, unknown>;
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== '/__d1-test') return response({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return response({ error: 'method' }, 405);
    try {
      const input = await body(request);
      const action = input.action;
      if (typeof action !== 'string') return response({ error: 'input' }, 400);
      if (action === 'health') return response({ ready: true });

      const db = env.DB;
      const store = await storage(env);
      switch (action) {
        case 'baseline':
          return response({ result: await store.initializeBaseline(input.ids as string[], input.now as number) });
        case 'baselineComplete':
          return response({ complete: await store.baselineComplete() });
        case 'knownNotifications': {
          const rows = await db.prepare(
            'SELECT notification_id, source FROM known_notifications ORDER BY notification_id',
          ).all<{ notification_id: string; source: string }>();
          if (rows.success !== true || !rows.results) return response({ error: 'test_operation_failed' }, 500);
          return response({ notifications: rows.results });
        }
        case 'discover':
          return response({ pending: await store.discover(input.ids as string[], input.now as number) });
        case 'pendingDetails':
          return response({ ids: await store.pendingDetailIds() });
        case 'savePlan':
          await store.saveNotificationPlan(
            input.id as string,
            input.detail as Parameters<D1Storage['saveNotificationPlan']>[1],
            input.parts as string[],
          );
          return response({ saved: true });
        case 'detailWork':
          return response({ ids: await store.detailWork(input.now as number, input.limit as number) });
        case 'claimDetail':
          return response(await store.claimDetail(input.id as string, input.owner as string, input.now as number));
        case 'recordDetailFailure':
          return response({
            outcome: await store.recordDetailFailure(
              input.claim as DetailClaim, input.now as number,
              input.options as Parameters<D1Storage['recordDetailFailure']>[2],
            ),
          });
        case 'releaseDetail':
          return response({ released: await store.releaseDetail(input.claim as DetailClaim, input.now as number) });
        case 'saveClaimedPlan':
          return response({
            saved: await store.saveClaimedNotificationPlan(
              input.claim as DetailClaim,
              input.detail as Parameters<D1Storage['saveClaimedNotificationPlan']>[1],
              input.parts as string[], input.now as number,
            ),
          });
        case 'plan':
          return response({ plan: await store.notificationPlan(input.id as string) });
        case 'parts':
          return response({ parts: await store.notificationParts(input.id as string) });
        case 'claimPart':
          return response(await store.claimPart(input.id as string, input.index as number, input.owner as string, input.now as number));
        case 'confirmPart':
          return response({ confirmed: await store.confirmPart(input.claim as PartClaim, input.receipt as string, input.now as number) });
        case 'releasePart':
          return response({ released: await store.releasePart(input.claim as PartClaim, input.now as number) });
        case 'initOAuth':
          return response({ result: await store.initializeOAuthTokens(input.tokens as OAuthTokens) });
        case 'initOAuthWrongKey': {
          const wrongKeyStore = await D1Storage.create(db, WRONG_TEST_KEY, 'test-key-v1');
          return response({ result: await wrongKeyStore.initializeOAuthTokens(input.tokens as OAuthTokens) });
        }
        case 'claimOAuth':
          return response(await store.claimOAuthRefresh(input.owner as string, input.now as number));
        case 'commitOAuth':
          return response({
            committed: await store.commitOAuthRefresh(
              input.claim as OAuthRefreshClaim, input.tokens as OAuthTokens, input.now as number,
            ),
          });
        case 'releaseOAuth':
          return response({
            released: await store.releaseOAuthRefresh(input.claim as OAuthRefreshClaim, input.now as number),
          });
        case 'claimPoll':
          return response(await store.claimPoll(input.owner as string, input.now as number));
        case 'renewPoll':
          return response({ claim: await store.renewPoll(input.claim as PollClaim, input.now as number) });
        case 'completePoll':
          return response({
            completed: await store.completePoll(input.claim as PollClaim, input.now as number, {
              nextPollAt: input.nextPollAt as number, outcome: input.outcome as string,
            }),
          });
        case 'oauthVersion':
          return response({ version: await store.oauthSessionVersion() });
        case 'replaceOAuth':
          return response({
            replaced: await store.replaceOAuthTokensAfterReauthorization(
              input.expectedVersion as number, input.tokens as OAuthTokens,
            ),
          });
        case 'invalidKey': {
          await D1Storage.create(db, 'invalid-test-key', 'test-key-v1');
          return response({ accepted: true });
        }
        case 'wrongKey': {
          await D1Storage.create(db, WRONG_TEST_KEY, 'test-key-v1').then(store =>
            store.claimOAuthRefresh('wrong-key-test', input.now as number));
          return response({ accepted: true });
        }
        case 'rawOAuth': {
          const row = await db.prepare(
            'SELECT envelope_version, key_version, session_version, nonce, ciphertext, refresh_owner, refresh_claim_version, refresh_expires_at FROM oauth_credentials WHERE credential_id = 1',
          ).first();
          return response({ row });
        }
        case 'tamperOAuth': {
          const column = input.column;
          if (column === 'ciphertext') {
            await db.prepare('UPDATE oauth_credentials SET ciphertext = ? WHERE credential_id = 1')
              .bind(input.value as string).run();
          } else if (column === 'key_version') {
            await db.prepare('UPDATE oauth_credentials SET key_version = ? WHERE credential_id = 1')
              .bind(input.value as string).run();
          } else {
            return response({ error: 'input' }, 400);
          }
          return response({ changed: true });
        }
        case 'failBaselineOnId': {
          if (input.id !== BASELINE_FAILURE_ID) return response({ error: 'input' }, 400);
          await db.prepare(
            `CREATE TRIGGER fail_baseline_test BEFORE INSERT ON known_notifications
             WHEN NEW.notification_id = '${BASELINE_FAILURE_ID}'
             BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`,
          ).run();
          return response({ installed: true });
        }
        case 'clearBaselineFailure':
          await db.prepare('DROP TRIGGER IF EXISTS fail_baseline_test').run();
          return response({ cleared: true });
        case 'failPlanAtPart': {
          if (input.index !== 1) return response({ error: 'input' }, 400);
          await db.prepare(
            `CREATE TRIGGER fail_part_test BEFORE INSERT ON delivery_parts
             WHEN NEW.part_index = 1
             BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`,
          ).run();
          return response({ installed: true });
        }
        case 'clearPlanFailure':
          await db.prepare('DROP TRIGGER IF EXISTS fail_part_test').run();
          return response({ cleared: true });
        default:
          return response({ error: 'unknown_action' }, 400);
      }
    } catch (error) {
      // Test-only route intentionally returns no driver details or request data.
      const status = error instanceof Error && error.name === 'StorageError' ? 409 : 500;
      return response({ error: 'test_operation_failed' }, status);
    }
  },
};
