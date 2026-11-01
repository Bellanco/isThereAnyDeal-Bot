import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkProduction } from './check-production.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const TYPESCRIPT = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const REDIRECT_PORT = '8765';
const OAUTH_TIMEOUT_MS = 10 * 60_000;
const ADMIN_TIMEOUT_MS = 30_000;
const ADMIN_LIFETIME_MS = 15 * 60_000;
const ALLOWED_MODES = new Set(['initialize', 'reauthorize', 'recover', 'status']);
let activeAdminStop;
let activeAdminChild;
let cleanupIncomplete = false;

/** Cleanup never changes the reported outcome; a failure is only flagged as a warning. */
export async function removeTemporaryDirectory(directory, remove = rm) {
  try {
    // On Windows workerd may hold its SQLite state briefly after Wrangler exits.
    await remove(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return true;
  } catch {
    cleanupIncomplete = true;
    return false;
  }
}

process.on('exit', () => {
  if (activeAdminChild?.exitCode === null) activeAdminChild.kill();
});

export class OperatorError extends Error {
  constructor(category) {
    super(category);
    this.name = 'OperatorError';
    this.category = category;
  }
}

function fail(category) {
  throw new OperatorError(category);
}

export function parseArguments(args) {
  const parsed = {};
  const valueOptions = new Set([
    '--config', '--mode', '--notification-id', '--part-index', '--action',
  ]);
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--live') {
      if (parsed.live) fail('arguments');
      parsed.live = true;
      continue;
    }
    if (!valueOptions.has(option) || parsed[option]) fail('arguments');
    const value = args[++index];
    if (!value || value.startsWith('--')) fail('arguments');
    parsed[option] = value;
  }
  if (!parsed['--config'] || !ALLOWED_MODES.has(parsed['--mode']) || !parsed.live) {
    fail('arguments');
  }
  if (parsed['--mode'] === 'recover') {
    if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|bundle:[1-9][0-9]{0,14})$/i.test(parsed['--notification-id'] ?? '') ||
        !/^(0|[1-9]\d{0,5})$/.test(parsed['--part-index'] ?? '') ||
        !['delivered', 'retry'].includes(parsed['--action'])) fail('arguments');
    const index = Number(parsed['--part-index']);
    if (!Number.isSafeInteger(index)) fail('arguments');
    return {
      configPath: parsed['--config'], mode: 'recover', live: true,
      notificationId: parsed['--notification-id'], partIndex: index, action: parsed['--action'],
    };
  }
  if (parsed['--mode'] === 'status') {
    if (parsed['--notification-id'] || parsed['--part-index'] || parsed['--action']) fail('arguments');
    return { configPath: parsed['--config'], mode: 'status', live: true };
  }
  if (parsed['--notification-id'] || parsed['--part-index'] || parsed['--action']) fail('arguments');
  return { configPath: parsed['--config'], mode: parsed['--mode'], live: true };
}

export function validAesKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value) &&
    Buffer.from(value, 'base64').length === 32 &&
    Buffer.from(value, 'base64').toString('base64') === value;
}

export function productionAdminConfig(
  production, capability, mainPath, expiresAt = Date.now() + ADMIN_LIFETIME_MS,
) {
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: 'itad-oauth-admin-local',
    account_id: production.account_id,
    main: mainPath,
    compatibility_date: production.compatibility_date,
    workers_dev: false,
    preview_urls: false,
    send_metrics: false,
    vars: {
      APP_MODE: 'oauth-admin',
      OAUTH_ADMIN_CAPABILITY: capability,
      OAUTH_ADMIN_EXPIRES_AT: String(expiresAt),
    },
    d1_databases: [{
      binding: 'DB',
      database_name: production.d1_databases[0].database_name,
      database_id: production.d1_databases[0].database_id,
      remote: true,
    }],
  };
}

function safeEnvironment() {
  const allowed = new Set([
    'path', 'systemroot', 'windir', 'temp', 'tmp', 'home', 'userprofile',
    'appdata', 'localappdata', 'programdata', 'comspec', 'pathext',
  ]);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())),
  );
  environment.WRANGLER_SEND_METRICS = 'false';
  environment.WRANGLER_HIDE_BANNER = 'true';
  environment.NO_COLOR = '1';
  return environment;
}

function acquirePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new OperatorError('local_port_unavailable')));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new OperatorError('local_port_unavailable'));
        return;
      }
      server.close(error => error ? reject(new OperatorError('local_port_unavailable')) : resolve(address.port));
    });
  });
}

function spawnQuiet(command, args, options = {}) {
  return spawn(command, args, {
    cwd: ROOT,
    windowsHide: true,
    stdio: 'ignore',
    env: safeEnvironment(),
    ...options,
  });
}

async function compileOAuthClient(tempRoot) {
  const outDir = path.join(tempRoot, 'oauth-runtime');
  const result = await new Promise(resolve => {
    const child = spawnQuiet(process.execPath, [
      TYPESCRIPT, '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
      '--lib', 'ES2024,DOM,WebWorker', '--strict', '--skipLibCheck', '--outDir', outDir,
      path.join(ROOT, 'src', 'oauth.ts'),
    ]);
    child.once('error', () => resolve(false));
    child.once('exit', code => resolve(code === 0));
  });
  if (!result) fail('oauth_runtime_unavailable');
  await writeFile(path.join(outDir, 'package.json'), '{"type":"commonjs"}', { mode: 0o600 });
  const require = createRequire(path.join(outDir, 'package.json'));
  return require(path.join(outDir, 'oauth.js'));
}

async function readHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') fail('protected_input_requires_terminal');
  process.stdout.write(prompt);
  input.setEncoding('utf8');
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = result => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      resolve(result);
    };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') {
          input.off('data', onData);
          input.setRawMode(false);
          input.pause();
          process.stdout.write('\n');
          reject(new OperatorError('cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ' && character !== '\u007f') {
          value += character;
        }
      }
    };
    input.on('data', onData);
  });
}

async function confirmExact(prompt, expected) {
  const readline = await import('node:readline/promises');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(prompt)) === expected;
  } finally {
    terminal.close();
  }
}

async function readVisible(prompt) {
  const readline = await import('node:readline/promises');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(prompt);
  } finally {
    terminal.close();
  }
}

async function loadProductionConfig(configPath) {
  let config;
  try {
    config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf8'));
    checkProduction(config, false);
  } catch {
    fail('production_config_rejected');
  }
  if (config.vars.LIVE_DELIVERY !== 'disabled' || config.triggers.crons.length !== 0 ||
      config.vars.OAUTH_REDIRECT_URI === undefined) fail('production_config_rejected');
  const redirect = new URL(config.vars.OAUTH_REDIRECT_URI);
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' ||
      redirect.port !== REDIRECT_PORT || !redirect.pathname || redirect.search || redirect.hash) {
    fail('callback_configuration_rejected');
  }
  if (redirect.pathname === '/oauth-admin-launch') fail('callback_configuration_rejected');
  return { config, redirect };
}

async function startRemoteAdmin(production) {
  let capability = randomBytes(32).toString('base64url');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'itad-oauth-admin-'));
  const configPath = path.join(tempRoot, 'wrangler.oauth-admin.jsonc');
  const expiresAt = Date.now() + ADMIN_LIFETIME_MS;
  let port;
  let child;
  const mainPath = path.join(ROOT, 'scripts', 'oauth-admin-worker.ts');
  try {
    port = await acquirePort();
    const localConfig = productionAdminConfig(production, capability, mainPath, expiresAt);
    await writeFile(configPath, JSON.stringify(localConfig), { mode: 0o600 });
    child = spawnQuiet(process.execPath, [
      WRANGLER, 'dev', '--config', configPath, '--ip', '127.0.0.1',
      '--port', String(port), '--inspector-port', '0', '--inspector-ip', '127.0.0.1',
    ]);
    activeAdminChild = child;
  } catch {
    capability = '';
    if (activeAdminChild === child) activeAdminChild = undefined;
    await removeTemporaryDirectory(tempRoot);
    fail('local_admin_start_failed');
  }
  let childFailed = false;
  child.once('error', () => { childFailed = true; });
  let stopped = false;
  const endpoint = `http://127.0.0.1:${port}/oauth-admin`;
  const send = async (action, fields = {}) => {
    let response;
    try {
      response = await fetch(`${endpoint}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${capability}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(fields),
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('admin_response_invalid');
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof OperatorError) throw error;
      fail('admin_operation_unconfirmed');
    }
  };
  const proveServerIdentity = async () => {
    const nonce = randomBytes(32).toString('base64url');
    let response;
    try {
      response = await fetch(`${endpoint}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ nonce }),
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.json();
      if (response.status !== 200 || body?.ok !== true || typeof body.proof !== 'string') return false;
      const expected = createHmac('sha256', capability)
        .update(`itad-oauth-admin-probe:v1:${nonce}`)
        .digest('base64url');
      const actualBytes = Buffer.from(body.proof);
      const expectedBytes = Buffer.from(expected);
      return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
    } catch {
      return false;
    }
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    capability = '';
    if (activeAdminStop === stop) activeAdminStop = undefined;
    await removeTemporaryDirectory(tempRoot);
  };
  activeAdminStop = stop;
  const readyUntil = Date.now() + ADMIN_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < readyUntil && child.exitCode === null && !childFailed) {
    if (await proveServerIdentity()) {
      ready = true;
      break;
    }
    // Probe carries no capability; a wrong listener never receives credentials.
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) {
    await stop();
    fail('local_remote_binding_unavailable');
  }
  return {
    send,
    async stop() {
      capability = '';
      await stop();
    },
  };
}

async function openBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawnQuiet(command, args);
  await new Promise((resolve, reject) => {
    child.once('error', () => reject(new OperatorError('browser_open_failed')));
    child.once('spawn', resolve);
  });
}

export async function obtainOAuthTokens(
  config, redirect, tempRoot, clientId,
  { transport = request => fetch(request, { redirect: 'error' }), launchBrowser = openBrowser,
    timeoutMs = OAUTH_TIMEOUT_MS } = {},
) {
  const { OAuthClient } = await compileOAuthClient(tempRoot);
  const client = new OAuthClient({
    clientId,
    redirectUri: config.vars.OAUTH_REDIRECT_URI,
    authentication: { method: 'public' },
  }, transport);
  const attempt = await client.begin();
  const authorizationUrl = attempt.localAuthorizationUrl();
  let completed = false;
  let server;
  let timer;
  const tokensPromise = new Promise((resolve, reject) => {
    server = createServer(async (request, response) => {
      const host = request.headers.host;
      if (host !== `127.0.0.1:${redirect.port}` || request.url?.length > 8192) {
        response.writeHead(400, { 'Cache-Control': 'no-store' }).end('Solicitud local no valida.');
        return;
      }
      let url;
      try {
        url = new URL(request.url ?? '/', redirect.origin);
      } catch {
        response.writeHead(400, { 'Cache-Control': 'no-store' }).end('Solicitud local no valida.');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/oauth-admin-launch') {
        if (completed) {
          response.writeHead(410, { 'Cache-Control': 'no-store' }).end('Sesión finalizada.');
          return;
        }
        response.writeHead(302, {
          Location: authorizationUrl,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        }).end();
        return;
      }
      if (request.method !== 'GET' || url.pathname !== redirect.pathname) {
        response.writeHead(404, { 'Cache-Control': 'no-store' }).end('No encontrado.');
        return;
      }
      if (completed && !url.search) {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Content-Type': 'text/plain; charset=utf-8',
        });
        response.once('finish', () => server.close());
        response.end('Autorización recibida. Ya puedes cerrar esta ventana.');
        return;
      }
      try {
        const tokens = await attempt.complete(new Request(`${redirect.origin}${request.url}`, { method: 'GET' }));
        completed = true;
        response.writeHead(303, {
          Location: `${redirect.origin}${redirect.pathname}`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        }).end();
        resolve(tokens);
      } catch (error) {
        const category = typeof error?.category === 'string' ? error.category : 'oauth';
        const terminal = ['oauth', 'expired', 'network', 'timeout', 'http', 'json', 'shape', 'input'].includes(category);
        if (terminal && !completed) {
          completed = true;
          response.writeHead(303, {
            Location: `${redirect.origin}${redirect.pathname}`,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          }).end();
          reject(new OperatorError(`oauth_${category}`));
        } else {
          response.writeHead(400, { 'Cache-Control': 'no-store' }).end('OAuth no completado; vuelve a la consola local.');
        }
      }
    });
    server.on('clientError', () => {});
    server.once('error', () => reject(new OperatorError('callback_listener_unavailable')));
    server.listen(Number(redirect.port), '127.0.0.1', async () => {
      try {
        await launchBrowser(`http://127.0.0.1:${redirect.port}/oauth-admin-launch`);
      } catch (error) {
        server.close();
        reject(error);
        return;
      }
    });
    timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        attempt.cancel();
        reject(new OperatorError('oauth_expired'));
      }
      server.close();
    }, timeoutMs);
    timer.unref();
  });
  tokensPromise.finally(() => {
    clearTimeout(timer);
    const closeFallback = setTimeout(() => server.close(), 5_000);
    closeFallback.unref();
  }).catch(() => {});
  return tokensPromise;
}

function validateProvisioningTokens(tokens) {
  if (!tokens || typeof tokens.accessToken !== 'string' ||
      typeof tokens.refreshToken !== 'string' || !tokens.refreshToken ||
      !Number.isSafeInteger(tokens.expiresAt) || tokens.expiresAt <= Date.now() ||
      !tokens.scope.split(' ').includes('notifications')) {
    fail('oauth_response_not_refreshable');
  }
}

async function operatorRun(args) {
  const { config, redirect } = await loadProductionConfig(args.configPath);
  if (args.mode === 'status') {
    await runStatus(config);
    return;
  }
  if (args.mode === 'recover') {
    await runRecovery(args, config);
    return;
  }

  const modeName = args.mode === 'initialize' ? 'initialización' : 'reautorización';
  const phrase = `CONFIRMO PARADA Y DRENAJE; AUTORIZO OAUTH ITAD, ACCESO BINDING D1 REMOTO Y ESCRITURA ${config.d1_databases[0].database_name} ${args.mode.toUpperCase()}`;
  console.log(`Operación ${modeName}: OAuth real de ITAD + escritura en D1 remota.`);
  console.log('No despliega Worker ni envía Telegram. Verifica cron apagado, invocaciones drenadas y migraciones aplicadas.');
  console.log(`Base seleccionada: ${config.d1_databases[0].database_name}. Callback: 127.0.0.1:${REDIRECT_PORT}${redirect.pathname}.`);
  if (!await confirmExact(`Escribe exactamente "${phrase}": `, phrase)) fail('operator_confirmation_required');

  const clientId = await readVisible('Client ID publico (debe coincidir con la app configurada): ');
  if (clientId !== config.vars.OAUTH_CLIENT_ID) fail('client_id_mismatch');
  let key = await readHidden('Clave AES-256 Base64 (entrada oculta; no se guardará): ');
  if (!validAesKey(key)) {
    key = '';
    fail('aes_key_invalid');
  }
  let tempRoot;
  let admin;
  let tokens;
  let importFields;
  try {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'itad-oauth-client-'));
    admin = await startRemoteAdmin(config);
    const statusResult = await admin.send('status', {});
    if (statusResult.status !== 200 || statusResult.body.ok !== true) fail('database_status_unavailable');
    const currentVersion = statusResult.body.sessionVersion;
    if (args.mode === 'initialize' && currentVersion !== null) fail('oauth_session_already_exists');
    if (args.mode === 'reauthorize' && (!Number.isSafeInteger(currentVersion) || currentVersion < 1)) {
      fail('oauth_session_missing');
    }
    console.log(args.mode === 'initialize'
      ? 'D1 no tiene una sesión OAuth inicial.'
      : `Sesión D1 observada: versión ${currentVersion}; el reemplazo usará CAS.`);
    tokens = await obtainOAuthTokens(config, redirect, tempRoot, clientId);
    validateProvisioningTokens(tokens);
    // Permission names are not secret; they tell the operator which optional features will work.
    const granted = tokens.scope.split(' ');
    console.log(`Permisos concedidos: ${granted.join(', ')}.`);
    if (!granted.includes('wait_read')) console.log('Aviso: sin wait_read no habrá banners ni avisos de bundles.');
    if (!granted.includes('coll_read')) console.log('Aviso: sin coll_read no se marcarán los juegos de tu Colección.');
    importFields = {
      mode: args.mode,
      key,
      keyVersion: config.vars.OAUTH_TOKEN_KEY_VERSION,
      tokens,
      expectedSessionVersion: args.mode === 'initialize' ? null : currentVersion,
    };
    let applied;
    try {
      applied = await admin.send('import', importFields);
    } catch {
      // Do not resubmit a token exchange/import after an ambiguous response.
      applied = null;
    }
    const targetVersion = args.mode === 'initialize' ? 1 : currentVersion + 1;
    let verified;
    try {
      verified = await admin.send('verify', {
        mode: args.mode, key, keyVersion: config.vars.OAUTH_TOKEN_KEY_VERSION,
        tokens, expectedSessionVersion: targetVersion,
      });
    } catch {
      verified = null;
    }
    if (verified?.status === 200 && verified.body.ok === true &&
        verified.body.matches === true && verified.body.sessionVersion === targetVersion) {
      console.log(applied?.body?.result === 'already-stored'
        ? 'La misma sesión ya estaba cifrada en D1; verificación de lectura correcta.'
        : 'Sobre cifrado escrito y lectura verificada en D1; sesión confirmada.');
      return;
    }
    if (applied?.status === 409) fail('oauth_session_conflict');
    fail('oauth_import_not_verified_do_not_retry');
  } finally {
    if (tokens) {
      tokens.accessToken = '';
      tokens.refreshToken = '';
      tokens.scope = '';
      tokens.expiresAt = null;
    }
    key = '';
    if (importFields) importFields.key = '';
    importFields = undefined;
    try {
      if (admin) await admin.stop();
    } finally {
      if (tempRoot) await removeTemporaryDirectory(tempRoot);
    }
  }
}

async function runStatus(production) {
  const phrase = `AUTORIZO LECTURA DE METADATOS D1 ${production.d1_databases[0].database_name}`;
  console.log('Solo lectura de version OAuth y presencia del indicador oauth_reauth; no lee el sobre.');
  if (!await confirmExact(`Escribe exactamente "${phrase}": `, phrase)) fail('operator_confirmation_required');
  const admin = await startRemoteAdmin(production);
  try {
    const result = await admin.send('status', {});
    if (result.status !== 200 || result.body.ok !== true) fail('database_status_unavailable');
    console.log(`Sesión OAuth: ${result.body.sessionVersion === null ? 'ausente' : `versión ${result.body.sessionVersion}`}; reautorización pendiente: ${result.body.reauthRequired === true ? 'sí' : 'no'}.`);
  } finally {
    await admin.stop();
  }
}

async function runRecovery(args, production) {
  const phrase = `AUTORIZO RECUPERACIÓN D1 ${args.notificationId} PARTE ${args.partIndex} ${args.action.toUpperCase()}`;
  console.log('Recuperación remota de una sola parte bloqueada; no cambia flags ni otras partes.');
  console.log(`Base seleccionada: ${production.d1_databases[0].database_name}.`);
  if (!await confirmExact(`Escribe exactamente "${phrase}": `, phrase)) fail('operator_confirmation_required');
  const admin = await startRemoteAdmin(production);
  try {
    const preview = await admin.send('recovery-preview', {
      notificationId: args.notificationId, partIndex: args.partIndex,
    });
    if (preview.status !== 200 || preview.body.ok !== true) fail('recovery_part_not_found');
    console.log(`Estado: ${preview.body.status}; categoría: ${preview.body.blockedCategory ?? 'none'}.`);
    const permitted = ['unverified_json', 'unverified_shape', 'unverified_message_id'];
    if (preview.body.status !== 'pending' || !permitted.includes(preview.body.blockedCategory)) {
      fail('recovery_category_not_allowed');
    }
    let operatorConfirmed = false;
    let duplicateRiskAcknowledged = false;
    if (args.action === 'delivered') {
      const confirmation = `CONFIRMO MENSAJE VISIBLE EN CHAT PRIVADO ${args.notificationId} ${args.partIndex}`;
      if (!await confirmExact(
        'Comprueba el mensaje exacto en el chat privado configurado. No se consultará Telegram. ' +
          `Escribe "${confirmation}": `,
        confirmation,
      )) fail('operator_confirmation_required');
      operatorConfirmed = true;
    } else {
      const confirmation = `REINTENTO DUPLICADO POSIBLE ${args.notificationId} ${args.partIndex}`;
      if (!await confirmExact(
        'Confirma que no viste el mensaje y acepta que Telegram pudo aceptarlo; el reintento puede duplicar. ' +
          `Escribe "${confirmation}": `,
        confirmation,
      )) fail('duplicate_risk_not_accepted');
      duplicateRiskAcknowledged = true;
    }
    const result = await admin.send('recovery', {
      action: args.action === 'delivered' ? 'confirm-delivered' : 'retry-possible-duplicate',
      notificationId: args.notificationId,
      partIndex: args.partIndex,
      operatorConfirmed,
      duplicateRiskAcknowledged,
    });
    if (result.status !== 200 || result.body.ok !== true) fail('recovery_state_changed');
    console.log(args.action === 'delivered'
      ? 'Parte confirmada manualmente; receipt etiquetado operator_manual, no Telegram.'
      : 'Parte reencolada. La entrega puede producir un duplicado; delivery_halt no se modificó.');
  } finally {
    await admin.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const interrupt = async () => {
    await activeAdminStop?.();
    process.exit(130);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await operatorRun(parseArguments(process.argv.slice(2)));
  } catch (error) {
    const category = error instanceof OperatorError ? error.category : 'operation_failed';
    console.error(`oauth_operator_failed:${category}`);
    process.exitCode = 1;
  } finally {
    if (cleanupIncomplete) {
      console.error('oauth_operator_warning:temp_cleanup_incomplete (borrar %TEMP%\\itad-oauth-* tras cerrar Wrangler)');
    }
  }
}
