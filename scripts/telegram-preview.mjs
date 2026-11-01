import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const BANNER = 'https://placehold.co/600x280/2b3a55/ffffff/png?text=Nebula+Drifters';
export const CONFIRMATION = 'ENVIAR 3 EJEMPLOS';

export class PreviewError extends Error {
  constructor(category) {
    super(`telegram_preview_failed:${category}`);
  }
}

export function parseArguments(args) {
  const allowed = new Set(['--dry-run', '--live', '--no-banner']);
  if (args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length ||
      args.includes('--dry-run') === args.includes('--live')) throw new PreviewError('arguments');
  return { live: args.includes('--live'), noBanner: args.includes('--no-banner') };
}

/** Compile only the real formatter/validator/client graph; never load operator side effects. */
export async function compilePreviewRuntime(tempRoot) {
  const outDir = path.join(tempRoot, 'preview-runtime');
  const ok = await new Promise(resolve => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(path|systemroot|windir|temp|tmp|comspec|pathext)$/i.test(key)));
    const child = spawn(process.execPath, [
      path.join(ROOT, 'node_modules/typescript/bin/tsc'),
      '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
      '--lib', 'ES2024,DOM,WebWorker', '--strict', '--skipLibCheck', '--outDir', outDir,
      ...['notifications', 'bundles', 'validation', 'telegram'].map(name => path.join(ROOT, `src/${name}.ts`)),
    ], { cwd: ROOT, windowsHide: true, stdio: 'ignore', env });
    child.once('error', () => resolve(false));
    child.once('exit', code => resolve(code === 0));
  });
  if (!ok) throw new PreviewError('runtime_unavailable');
  await writeFile(path.join(outDir, 'package.json'), '{"type":"commonjs"}', { mode: 0o600 });
  const require = createRequire(path.join(outDir, 'package.json'));
  return Object.assign({}, ...['notifications', 'bundles', 'validation', 'telegram'].map(name =>
    require(path.join(outDir, `${name}.js`))));
}

/** Invented data in the official input shapes, validated before formatting. No I/O. */
export function buildExamples(runtime, { noBanner = false } = {}) {
  const id = n => `018d937f-0000-7000-8000-${String(n).padStart(12, '0')}`;
  const price = cents => ({ amount: cents / 100, amountInt: cents, currency: 'EUR' });
  const game = (n, title, extra = {}) => ({
    id: id(n), slug: `preview-${title.toLowerCase().replaceAll(' ', '-')}`, title,
    type: 'game', mature: false, historyLow: price(499), lastPrice: price(1999), deals: [], ...extra,
  });
  const deal = (shopId, shop, extra = {}) => ({
    shop: { id: shopId, name: shop }, price: price(499), regular: price(1999), cut: 75,
    voucher: null, storeLow: price(599), flag: 'N',
    drm: [{ id: 1000, name: 'DRM Free' }], platforms: [{ id: 1, name: 'Windows' }],
    timestamp: '2026-11-01T10:00:00Z', expiry: null,
    url: `https://example.com/preview/store-${shopId}?ref=ficticio&offer=1`, ...extra,
  });
  const notice = (n, games) => runtime.parseWaitlistNotification({
    id: id(n), timestamp: '2026-11-01T10:05:00Z', read: null, games,
  });
  const first = notice(101, [
    game(1, 'Nebula Drifters', { deals: [deal(1, 'Órbita Digital')] }),
  ]);
  const second = notice(102, [
    game(2, 'Clockwork Reef', { deals: [
      deal(2, 'Faro Games', { price: price(799), cut: 60, flag: 'S' }),
      deal(3, 'Cometa Store', { price: price(699), cut: 65, flag: null,
        voucher: 'REEF-FICTICIO', expiry: '2026-11-08T19:00:00Z' }),
    ] }),
    game(3, 'Velvet Moon Afterdark', { type: 'dlc', mature: true, historyLow: null,
      lastPrice: null, deals: [deal(4, 'Luna Digital', {
        voucher: 'LUNA-FICTICIO', expiry: '2026-11-09T19:00:00Z',
      })] }),
  ]);
  const bundleGame = (n, title) => {
    const { historyLow, lastPrice, deals, ...entry } = game(n, title);
    return entry;
  };
  const entry = runtime.parseBundles([{
    id: 990001, title: 'Constellation Cabinet — Bundle ficticio', page: { name: 'Atlas Bundles' },
    url: 'https://example.com/preview/bundle?ref=ficticio&tier=all',
    details: 'https://example.com/preview/bundle-details',
    note: null,
    isMature: false, publish: '2026-11-01T09:00:00Z', expiry: '2026-11-15T19:00:00Z',
    tiers: [
      { price: price(399), addon: false, games: [bundleGame(1, 'Nebula Drifters'), bundleGame(4, 'Paper Satellites')] },
      { price: price(799), addon: false, games: [bundleGame(2, 'Clockwork Reef'), bundleGame(5, 'Amber Observatory')] },
      { price: price(1299), addon: false, games: [bundleGame(6, 'Silent Astrolabe')] },
    ],
  }])[0];
  if (!entry?.bundle) throw new PreviewError('example_invalid');
  const groups = [
    runtime.formatNotification(first, noBanner ? {} : { banners: new Map([[id(1), BANNER]]) }),
    runtime.formatNotification(second),
    runtime.formatBundle({ bundle: entry.bundle, waitlist: [id(1), id(2)], collection: [id(1), id(4)] }),
  ];
  if (groups.some(parts => parts.length !== 1)) throw new PreviewError('example_parts');
  return groups.map(parts => parts[0]);
}

/** The real client validates receipts. No retry on ambiguous failures; its 400 image fallback remains. */
export async function deliverExamples(runtime, examples, {
  token, chatId, confirm, transport, write = console.log,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  if (!runtime.validBotToken(token)) throw new PreviewError('configuration');
  let destination;
  try { destination = runtime.parsePrivateChatId(chatId); }
  catch { throw new PreviewError('configuration'); }
  if (examples.length !== 3) throw new PreviewError('example_parts');
  if (await confirm() !== CONFIRMATION) throw new PreviewError('cancelled');
  const client = new runtime.TelegramClient(transport, token, destination);
  let confirmed = 0;
  for (const html of examples) {
    try {
      if (confirmed > 0) await sleep(1000);
      await client.sendRich(html);
      confirmed++;
      write(`telegram_preview_confirmed:${confirmed}/3`);
    } catch (error) {
      // Only values of the real sanitized error class, never external error strings.
      const category = error instanceof runtime.TelegramError ? `${error.category}:${error.reason}` : 'operation';
      const retry = error instanceof runtime.TelegramError && error.category === 'rate_limit'
        ? ` Esperar al menos ${error.retryAfterSeconds} s antes de una nueva decisión manual.` : '';
      write(`telegram_preview_stopped:${category}; confirmados=${confirmed}/3.${retry}`);
      write('No se enviarán los restantes. El intento fallido pudo llegar; revisar el chat. Relanzar repite también los confirmados y puede duplicarlos. Sin reintentos automáticos ambiguos.');
      throw new PreviewError('delivery_stopped');
    }
  }
  return confirmed;
}

export async function readHidden(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new PreviewError('protected_input_requires_terminal');
  }
  output.write(prompt);
  input.setEncoding('utf8');
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = cancelled => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (cancelled) reject(new PreviewError('cancelled'));
      else resolve(value);
      value = '';
    };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') { finish(true); return; }
        if (char === '\r' || char === '\n') { finish(false); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && char !== '\u007f') {
          if (value.length >= 256) { finish(true); return; }
          value += char;
        }
      }
    };
    input.on('data', onData);
  });
}

export async function runPreview(args, {
  compile = compilePreviewRuntime, makeTemp = () => mkdtemp(path.join(os.tmpdir(), 'itad-telegram-preview-')),
  remove = rm, read = readHidden, write = console.log, transport = request => fetch(request),
  terminal = () => process.stdin.isTTY && process.stdout.isTTY, sleep,
} = {}) {
  const options = parseArguments(args);
  if (options.live && !terminal()) throw new PreviewError('protected_input_requires_terminal');
  let temp;
  let token;
  let chatId;
  try {
    temp = await makeTemp();
    const runtime = await compile(temp);
    const examples = buildExamples(runtime, options);
    if (!options.live) {
      examples.forEach((html, index) => write(`\nEjemplo ficticio ${index + 1}/3 (HTML Rich, no render exacto de Telegram):\n${html}`));
      return;
    }
    write('Se enviarán 3 ejemplos ficticios al chat privado introducido. No modifican D1 ni producción. El banner depende de placehold.co; --no-banner lo omite.');
    token = await read('Token del bot (entrada oculta): ');
    chatId = await read('ID del chat privado (entrada oculta): ');
    await deliverExamples(runtime, examples, {
      token, chatId, transport, write, sleep,
      confirm: () => read(`Para autorizar estos tres mensajes escribe ${CONFIRMATION} (entrada oculta): `),
    });
  } catch (error) {
    throw error instanceof PreviewError ? error : new PreviewError('operation');
  } finally {
    token = undefined;
    chatId = undefined;
    if (temp !== undefined) {
      try { await remove(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
      catch {
        write('telegram_preview_failed:temp_cleanup_incomplete; revisar únicamente la carpeta itad-telegram-preview de esta ejecución en TEMP. El resultado de los envíos no cambia; no relanzar sin revisar el chat.');
        throw new PreviewError('temp_cleanup_incomplete');
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPreview(process.argv.slice(2)).catch(error => {
    console.error(error instanceof PreviewError ? error.message : 'telegram_preview_failed:operation');
    process.exitCode = 1;
  });
}
