import {
  createOAuthAdminHandler, validOAuthAdminEnvironment,
} from '../src/oauth-admin';
import type { D1Database } from '../src/d1-storage';

interface Env {
  APP_MODE: 'oauth-admin';
  DB: D1Database;
  OAUTH_ADMIN_CAPABILITY: string;
  OAUTH_ADMIN_EXPIRES_AT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!validOAuthAdminEnvironment(env)) {
      return Response.json({ ok: false, error: 'configuration_rejected' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    return createOAuthAdminHandler(
      env.DB,
      env.OAUTH_ADMIN_CAPABILITY,
      Date.now,
      Number(env.OAUTH_ADMIN_EXPIRES_AT),
    )(request);
  },
};
