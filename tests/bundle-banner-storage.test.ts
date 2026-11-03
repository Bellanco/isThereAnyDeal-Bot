import { describe, expect, it } from 'vitest';
import spec from '../itad-openapi.json';
import { D1Storage } from '../src/d1-storage';
import { formatBundle } from '../src/bundles';
import type { BundleNotice } from '../src/domain';
import { parseBundles } from '../src/validation';
import { stripImages } from '../src/rich';
import { TelegramClient } from '../src/telegram';
import { createTestDatabase } from './sqlite-d1';

describe('bundle banner persistence and delivery, offline', () => {
  it.each([false, true])('roundtrips real plan storage, old assets-free plan=%s', old => {
    return (async () => {
      const db = createTestDatabase();
      try {
        const storage = await D1Storage.create(db, btoa(String.fromCharCode(...new Uint8Array(32).fill(7))), 'test');
        const bundle = parseBundles(spec.components.examples['resp.bundles.v1.success'].value)[0]!.bundle!;
        if (old) bundle.tiers.forEach(t => t.games.forEach(g => { delete g.banner; }));
        const notice: BundleNotice = { bundle, waitlist: [bundle.tiers[0]!.games[1]!.id], collection: [] };
        const parts = formatBundle(notice);
        const key = `bundle:${bundle.id}`;
        expect(await storage.saveBundlePlan(key, notice, parts, 1000)).toBe(true);
        // Recreate storage against the same in-memory database (restart, not real D1).
        const restarted = await D1Storage.create(db, btoa(String.fromCharCode(...new Uint8Array(32).fill(7))), 'test');
        const plan = await restarted.notificationPlan(key);
        expect(plan).toEqual({ detail: notice, parts });
        expect(formatBundle(plan!.detail as unknown as BundleNotice)).toEqual(parts);
        expect((await restarted.notificationParts(key)).map(p => p.text)).toEqual(parts);
        expect(await restarted.saveBundlePlan(key, notice, ['<p>replacement</p>'], 2000)).toBe(false);
        expect(await restarted.notificationPlan(key)).toEqual(plan);
        expect(parts.join('').includes('<img')).toBe(!old);
      } finally {
        db.raw.close();
      }
    })();
  });

  it('uses real 400 fallback for a bundle, preserving every text/link/part and removing the image', async () => {
    const bundle = parseBundles(spec.components.examples['resp.bundles.v1.success'].value)[0]!.bundle!;
    const notice: BundleNotice = { bundle, waitlist: [bundle.tiers[0]!.games[1]!.id], collection: [] };
    const parts = formatBundle(notice);
    const requests: string[] = [];
    const client = new TelegramClient(async request => {
      requests.push((await request.json() as { rich_message: { html: string } }).rich_message.html);
      if (requests.length === 1) return Response.json({ ok: false, error_code: 400 }, { status: 400 });
      return Response.json({ ok: true, result: { message_id: 1, chat: { id: 123456, type: 'private' } } });
    }, `12345:${'fictitious_bundle_test_'.repeat(2)}`, 123456);
    await client.sendRich(parts[0]!);
    const old = structuredClone(notice);
    old.bundle.tiers.forEach(t => t.games.forEach(g => { delete g.banner; }));
    expect(requests).toEqual([parts[0], stripImages(parts[0]!)]);
    expect(requests[1]).toBe(formatBundle(old)[0]);
    expect(requests[1]).not.toMatch(/<img|Imagen de juego/);
  });
});
