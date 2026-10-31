import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { obtainOAuthTokens } from '../scripts/oauth-provision.mjs';

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

describe('OAuth provisioning loopback adapter', () => {
  it('uses one-time PKCE state/callback and mocked token exchange without external requests', async () => {
    const port = await unusedLoopbackPort();
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'itad-oauth-loopback-test-'));
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const config = {
      vars: { OAUTH_CLIENT_ID: 'public-client', OAUTH_REDIRECT_URI: redirectUri },
    };
    let launchUrl;
    const transport = async request => {
      expect(request.url).toBe('https://isthereanydeal.com/oauth/token/');
      const form = new URLSearchParams(await request.text());
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('client_id')).toBe('public-client');
      expect(form.get('redirect_uri')).toBe(redirectUri);
      expect(form.get('code')).toBe('fixture-code');
      expect(form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return Response.json({
        access_token: 'fixture-access-never-exported',
        refresh_token: 'fixture-refresh-never-exported',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'notifications',
      });
    };
    try {
      const resultPromise = obtainOAuthTokens(
        config, new URL(redirectUri), tempRoot, 'public-client',
        { transport, launchBrowser: async value => { launchUrl = value; }, timeoutMs: 15_000 },
      );
      resultPromise.catch(() => {});
      const deadline = Date.now() + 10_000;
      while (!launchUrl && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      expect(launchUrl).toBe(`http://127.0.0.1:${port}/oauth-admin-launch`);

      const launch = await fetch(launchUrl, { redirect: 'manual' });
      expect(launch.status).toBe(302);
      const authorization = new URL(launch.headers.get('location'));
      expect(authorization.origin + authorization.pathname)
        .toBe('https://isthereanydeal.com/oauth/authorize/');
      expect(authorization.searchParams.get('response_type')).toBe('code');
      expect(authorization.searchParams.get('client_id')).toBe('public-client');
      expect(authorization.searchParams.get('scope')).toBe('notifications');
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      const state = authorization.searchParams.get('state');
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const wrongState = await fetch(`${redirectUri}?state=wrong&code=fixture-code`);
      expect(wrongState.status).toBe(400);
      const callback = await fetch(`${redirectUri}?state=${encodeURIComponent(state)}&code=fixture-code`, {
        redirect: 'manual',
      });
      expect(callback.status).toBe(303);
      expect(callback.headers.get('location')).toBe(redirectUri);
      const cleanPage = await fetch(redirectUri);
      expect(cleanPage.status).toBe(200);
      expect(await cleanPage.text()).not.toMatch(/fixture-(access|refresh|code)/);

      const tokens = await resultPromise;
      expect(tokens).toEqual({
        accessToken: 'fixture-access-never-exported',
        refreshToken: 'fixture-refresh-never-exported',
        expiresAt: expect.any(Number),
        scope: 'notifications',
      });
      tokens.accessToken = '';
      tokens.refreshToken = '';
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
