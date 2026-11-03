import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {
  BANNER, SECOND_BANNER, BUNDLE_GAME_BANNER, CONFIRMATION, buildExamples, compilePreviewRuntime, deliverExamples,
  parseArguments, readHidden, runPreview,
} from '../scripts/telegram-preview.mjs';

const TOKEN = `12345:${'fictitious_preview_only_'.repeat(2)}`;
const CHAT = '123456';
let runtime;
let temp;
beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), 'itad-preview-test-'));
  runtime = await compilePreviewRuntime(temp);
}, 30_000);
afterAll(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); })));
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function delivery(extra = {}) {
  return {
    token: TOKEN, chatId: CHAT, confirm: async () => CONFIRMATION,
    transport: vi.fn(async () => Response.json({
      ok: true, result: { message_id: 1, chat: { id: Number(CHAT), type: 'private' } },
    })),
    write: vi.fn(), sleep: vi.fn(async () => {}), ...extra,
  };
}

describe('Telegram preview, compiled real formatters and client', () => {
  it.each([[], ['--live', '--dry-run'], ['--dry-run', '--dry-run'],
    ['--live', '--token', TOKEN], ['--live', '--chat-id', CHAT], ['--live', '--config', 'private'],
    ['--dry-run', '--no-banner', '--no-banner'], ['--live', '--token=private']].map(args => ({ args })))(
    'rejects absent/conflicting modes, duplicates and secret options %j', ({ args }) => {
      expect(() => parseArguments(args)).toThrow('arguments');
    });

  it('accepts only the explicit modes and optional no-banner flag', () => {
    expect(parseArguments(['--dry-run'])).toEqual({ live: false, noBanner: false });
    expect(parseArguments(['--no-banner', '--live'])).toEqual({ live: true, noBanner: true });
  });

  it('builds three fictional single-part HTML messages without I/O', () => {
    const examples = buildExamples(runtime);
    expect(examples).toHaveLength(3);
    expect(examples).toEqual(buildExamples(runtime));
    expect(examples[0]).toContain(BANNER.replaceAll('&', '&amp;'));
    expect(examples[0]).toContain('<p>Mínimo histórico:');
    expect(examples[0]).not.toContain('Precio anterior:');
    expect(examples[1]).toContain(SECOND_BANNER);
    for (const label of ['Faro Games', 'Cometa Store', 'Cupón:', '<footer>Hasta ', 'Mínimo histórico']) {
      expect(examples[1]).toContain(label);
    }
    for (const label of ['Nivel 1', 'Nivel 2', 'Nivel 3', '<footer>Hasta ',
      'En tu lista de deseos', 'En tu Colección', 'Silent Astrolabe']) expect(examples[2]).toContain(label);
    expect(examples[2]).not.toContain('Ejemplo inventado:');
    expect(examples[2]).not.toContain('Nota de ITAD:');
    expect(examples[2]).toContain('https://isthereanydeal.com/game/preview-nebula-drifters/');
    expect(examples[2]).toContain('ref=ficticio&amp;tier=all');
    for (const html of examples) {
      expect(Buffer.byteLength(html)).toBeLessThan(32768);
      expect(html.isWellFormed()).toBe(true);
      expect(html).not.toContain(TOKEN);
      expect(html).not.toMatch(/ITAD · (Waitlist|Bundle)|Aviso ITAD|Bundle ITAD|Leído en ITAD|<footer>parte \d+\/\d+<\/footer>/);
      expect(html).not.toContain('018d937f-0000-7000-8000-');
      expect(html).not.toContain('unix='); // Visible dates are fixed Madrid text, not reader-localized tags.
      expect(html).not.toMatch(/<details|<summary|<table|<small|<tg-time|style="(?!primary"|success")/);
      const rows = [...html.matchAll(/<tg-button-row>(.*?)<\/tg-button-row>/g)];
      expect(rows.length).toBeGreaterThan(0);
      for (const [, row] of rows) {
        expect(row.match(/<tg-button /g)).toHaveLength(1);
        if (row.includes('>Comprar')) expect(row).toContain('style="success"');
        else expect(row).toContain('style="primary"');
      }
    }
    for (const html of examples.slice(0, 2)) {
      expect(html).not.toMatch(/Precios del juego|Precios de esta tienda|Precio habitual|Mínimo en tienda|Mínimo de esta tienda|Precio anterior|DRM:|Plataformas:|Oferta publicada/);
      expect(html).not.toContain('<p><b>Órbita Digital</b></p>');
      expect(html).toContain('<p>Mínimo histórico: 4,99\u00a0€</p>');
      expect(html).not.toContain('<mark>Mínimo histórico');
      expect(html).not.toMatch(/Tienda:|DLC|Paquete|Contenido para adultos|Waitlist/);
    }
    expect(examples[0].match(/Mínimo histórico/g)).toHaveLength(1);
    expect(examples[1].match(/Mínimo histórico/g)).toHaveLength(1);
    expect(examples[2]).toContain('<mark>En tu lista de deseos</mark>');
    expect(examples[0]).not.toMatch(/Caduca:|Hasta/);
    expect(examples[1]).toContain('<footer>Hasta el 8 de noviembre</footer>');
    expect(examples[1]).not.toContain('Velvet Moon Afterdark');
    expect(examples[2].startsWith(`<img src="${BUNDLE_GAME_BANNER}"/><h3>Constellation Cabinet — Bundle ficticio</h3>`)).toBe(true);
    expect(examples[2]).not.toContain('Imagen de juego:');
    expect(examples[2]).not.toContain('990001');
    expect(examples[2]).not.toContain('publicado');
    expect(examples[2]).toContain('<footer>Hasta el 15 de noviembre</footer>');
    expect(examples[2].match(/<footer>Hasta el \d{1,2} de [a-z]+<\/footer>/g)).toHaveLength(1); // Only expiry.
    expect(buildExamples(runtime, { noBanner: true }).join('')).not.toContain('<img');
  });

  it.each([false, true])('example 2 is exactly one game with two shops, noBanner=%s', noBanner => {
    const inputs = [];
    const recording = {
      ...runtime,
      parseWaitlistNotification: value => {
        inputs.push(structuredClone(value));
        return runtime.parseWaitlistNotification(value);
      },
    };
    const html = buildExamples(recording, { noBanner })[1];
    expect(inputs[1].games).toHaveLength(1);
    expect(inputs[1].games[0].title).toBe('Clockwork Reef');
    expect(inputs[1].games[0].deals.map(deal => deal.shop.name)).toEqual(['Faro Games', 'Cometa Store']);
    expect(html).toBe(
      (noBanner ? '' : `<img src="${SECOND_BANNER}"/>`) +
      '<h3>Clockwork Reef</h3><h4>7,99\u00a0€ · <mark>-60%</mark></h4>' +
      '<p>Mínimo histórico: 4,99\u00a0€</p>' +
      '<tg-button-row><tg-button type="url" style="success" url="https://example.com/preview/store-2?ref=ficticio&amp;offer=1">Comprar en Faro Games</tg-button></tg-button-row>' +
      '<tg-button-row><tg-button type="url" style="primary" url="https://isthereanydeal.com/game/preview-clockwork-reef/">Ver en ITAD</tg-button></tg-button-row>' +
      '<hr/><h4>6,99\u00a0€ · <mark>-65%</mark></h4><p>Cupón: <code>REEF-FICTICIO</code></p>' +
      '<footer>Hasta el 8 de noviembre</footer>' +
      '<tg-button-row><tg-button type="url" style="success" url="https://example.com/preview/store-3?ref=ficticio&amp;offer=1">Comprar en Cometa Store</tg-button></tg-button-row>',
    );
    const bundle = buildExamples(runtime)[2];
    expect(bundle).toContain('>Comprar en Atlas Bundles</tg-button>');
    expect(bundle).not.toMatch(/Comprar bundle|<p><b>Atlas Bundles|<code>En tu Colección/);
    expect(buildExamples(runtime, { noBanner }).map(html => ({
      bytes: runtime.utf8Length(html), blocks: runtime.countBlocks(html), images: runtime.countImages(html),
    }))).toEqual(noBanner ? [
      { bytes: 428, blocks: 7, images: 0 },
      { bytes: 717, blocks: 13, images: 0 },
      { bytes: 1139, blocks: 22, images: 0 },
    ] : [
      { bytes: 508, blocks: 8, images: 1 },
      { bytes: 796, blocks: 14, images: 1 },
      { bytes: 1204, blocks: 23, images: 1 },
    ]);
  });

  it('dry-run never asks for credentials, fetches, or loads cloud config and cleans its own temporary', async () => {
    const read = vi.fn();
    const remove = vi.fn();
    const write = vi.fn();
    await runPreview(['--dry-run'], {
      compile: async () => runtime, makeTemp: async () => 'own-preview-temp', remove, read, write,
    });
    expect(read).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledExactlyOnceWith('own-preview-temp', expect.objectContaining({ recursive: true }));
  });

  it('requires a TTY before creating temporary data in live mode', async () => {
    const makeTemp = vi.fn();
    await expect(runPreview(['--live'], { terminal: () => false, makeTemp })).rejects.toThrow('terminal');
    expect(makeTemp).not.toHaveBeenCalled();
  });

  it.each([{ token: 'bad' }, { chatId: '-1' }, { chatId: '4503599627370497' }])(
    'validates credentials before confirmation or transport %j', async extra => {
      const deps = delivery(extra);
      deps.confirm = vi.fn();
      await expect(deliverExamples(runtime, buildExamples(runtime), deps)).rejects.toThrow('configuration');
      expect(deps.confirm).not.toHaveBeenCalled();
      expect(deps.transport).not.toHaveBeenCalled();
    });

  it('cancellation sends nothing', async () => {
    const deps = delivery({ confirm: async () => 'yes' });
    await expect(deliverExamples(runtime, buildExamples(runtime), deps)).rejects.toThrow('cancelled');
    expect(deps.transport).not.toHaveBeenCalled();
  });

  it('uses sendRichMessage, the configured destination, confirmations and two one-second waits', async () => {
    const examples = buildExamples(runtime);
    const deps = delivery();
    expect(await deliverExamples(runtime, examples, deps)).toBe(3);
    for (const [index, [request]] of deps.transport.mock.calls.entries()) {
      expect(new URL(request.url).pathname.endsWith('/sendRichMessage')).toBe(true);
      expect(await request.json()).toEqual({
        chat_id: Number(CHAT), rich_message: { html: examples[index], skip_entity_detection: true },
      });
    }
    expect(deps.sleep.mock.calls).toEqual([[1000], [1000]]);
    expect(deps.write).toHaveBeenLastCalledWith('telegram_preview_confirmed:3/3');
  });

  it.each(['network', 'http500', 'http403', 'rate-limit', 'invalid-receipt', 'wrong-chat'])(
    'stops at first %s error, reports partial confirmations, never prints external data or retries', async mode => {
      let calls = 0;
      const deps = delivery({ transport: vi.fn(async () => {
        if (++calls === 1) return Response.json({
          ok: true, result: { message_id: 1, chat: { id: Number(CHAT), type: 'private' } },
        });
        if (mode === 'network') throw new Error(`private ${TOKEN} https://private.invalid/`);
        if (mode === 'invalid-receipt') return new Response(`private ${TOKEN}`);
        if (mode === 'wrong-chat') return Response.json({
          ok: true, result: { message_id: 2, chat: { id: 1, type: 'private' } },
        });
        const status = mode === 'rate-limit' ? 429 : mode === 'http403' ? 403 : 500;
        return Response.json({ ok: false, description: TOKEN, parameters: { retry_after: 9 } }, { status });
      }) });
      await expect(deliverExamples(runtime, buildExamples(runtime), deps)).rejects.toThrow('delivery_stopped');
      expect(deps.transport).toHaveBeenCalledTimes(2);
      const logs = deps.write.mock.calls.flat().join('\n');
      expect(logs).toContain('confirmados=1/3');
      expect(logs).toContain('duplicar');
      expect(logs).not.toContain(TOKEN);
      expect(logs).not.toContain('https://');
      if (mode === 'rate-limit') expect(logs).toContain('9 s');
    });

  it('retains the real nonambiguous 400 fallback without images; persistent 400 stops', async () => {
    const examples = buildExamples(runtime);
    const deps = delivery({ transport: vi.fn(async () => Response.json({ ok: false }, { status: 400 })) });
    await expect(deliverExamples(runtime, examples, deps)).rejects.toThrow('delivery_stopped');
    expect(deps.transport).toHaveBeenCalledTimes(2);
    expect((await deps.transport.mock.calls[0][0].json()).rich_message.html).toContain('<img');
    expect((await deps.transport.mock.calls[1][0].json()).rich_message.html).not.toContain('<img');
    expect(deps.write.mock.calls.flat().join('')).toContain('confirmados=0/3');
  });

  it.each([1, 3])('confirms all three messages after a successful image-only fallback at call %s', async failureAt => {
    let calls = 0;
    const deps = delivery({ transport: vi.fn(async () => {
      if (++calls === failureAt) return Response.json({ ok: false }, { status: 400 });
      return Response.json({
        ok: true, result: { message_id: calls, chat: { id: Number(CHAT), type: 'private' } },
      });
    }) });
    expect(await deliverExamples(runtime, buildExamples(runtime), deps)).toBe(3);
    expect(deps.transport).toHaveBeenCalledTimes(4);
    expect(deps.sleep.mock.calls).toEqual([[1000], [1000]]);
    const retried = (await deps.transport.mock.calls[failureAt][0].json()).rich_message.html;
    expect(retried).toBe(buildExamples(runtime, { noBanner: true })[failureAt === 1 ? 0 : 2]);
  });

  it('never retries 400 without an image', async () => {
    const deps = delivery({ transport: vi.fn(async () => Response.json({ ok: false }, { status: 400 })) });
    await expect(deliverExamples(runtime, buildExamples(runtime, { noBanner: true }), deps)).rejects.toThrow('delivery_stopped');
    expect(deps.transport).toHaveBeenCalledTimes(1);
  });

  it('runs live with simulated transport and hidden credential/confirmation inputs only', async () => {
    const deps = delivery();
    const read = vi.fn().mockResolvedValueOnce(TOKEN).mockResolvedValueOnce(CHAT).mockResolvedValueOnce(CONFIRMATION);
    const remove = vi.fn();
    await runPreview(['--live', '--no-banner'], {
      ...deps, terminal: () => true, read, compile: async () => runtime,
      makeTemp: async () => 'own-preview-temp', remove,
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(deps.transport).toHaveBeenCalledTimes(3);
    expect(deps.write.mock.calls.flat().join('')).not.toContain(TOKEN);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('cleans after compile failure; reports cleanup failure explicitly without external exceptions', async () => {
    const remove = vi.fn();
    await expect(runPreview(['--dry-run'], {
      makeTemp: async () => 'own-preview-temp',
      compile: async () => { throw new Error(TOKEN); }, remove,
    })).rejects.toThrow('telegram_preview_failed:operation');
    expect(remove).toHaveBeenCalledTimes(1);
    const write = vi.fn();
    await expect(runPreview(['--dry-run'], {
      makeTemp: async () => 'own-preview-temp', compile: async () => runtime, write,
      remove: async () => { throw new Error(TOKEN); },
    })).rejects.toThrow('temp_cleanup_incomplete');
    expect(write.mock.calls.flat().join('')).not.toContain(TOKEN);
  });

  it('cleans its temporary after a live delivery error and does not expose secrets', async () => {
    const read = vi.fn().mockResolvedValueOnce(TOKEN).mockResolvedValueOnce(CHAT).mockResolvedValueOnce(CONFIRMATION);
    const remove = vi.fn();
    const write = vi.fn();
    await expect(runPreview(['--live'], {
      terminal: () => true, read, write, compile: async () => runtime,
      makeTemp: async () => 'own-preview-temp', remove,
      transport: async () => { throw new Error(TOKEN); },
    })).rejects.toThrow('delivery_stopped');
    expect(remove).toHaveBeenCalledExactlyOnceWith('own-preview-temp', expect.objectContaining({ recursive: true }));
    expect(write.mock.calls.flat().join('')).not.toContain(TOKEN);
  });

  it.each([false, true])('hidden TTY input restores raw mode on completion/cancellation=%s', async cancel => {
    const input = Object.assign(new EventEmitter(), {
      isTTY: true, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn(),
    });
    const output = { isTTY: true, write: vi.fn() };
    const pending = readHidden('Entrada: ', input, output);
    const expectation = cancel ? expect(pending).rejects.toThrow('cancelled') : expect(pending).resolves.toBe('ac');
    input.emit('data', cancel ? `private\u0003` : 'ab\bc\r');
    await expectation;
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.listenerCount('data')).toBe(0);
    expect(output.write.mock.calls).toEqual([['Entrada: '], ['\n']]);
  });
});
