import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePreviewRuntime } from './telegram-preview.mjs';

export const COMMIT = '7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f';
export const SPEC_SHA256 = '0d128cd045bf2fd6c7db5b879ebcbe622266180563967076ce294f578ca07841';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const source = file => `https://github.com/IsThereAnyDeal/API/blob/${COMMIT}/${file}`;
const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Offline only: pin the already verified public snapshot, not any account response. */
export async function loadOfficialSpec() {
  const bytes = await readFile(path.join(ROOT, 'itad-openapi.json'));
  if (createHash('sha256').update(bytes).digest('hex') !== SPEC_SHA256) {
    throw new Error('official_snapshot_changed: reverify public source before updating the pin');
  }
  const spec = JSON.parse(bytes.toString('utf8'));
  for (const [file, key] of [
    ['notification-waitlist', 'event.notification-waitlist'],
    ['notifications-list', 'resp.notifications.get.v1'],
    ['notifications-waitlist-detail', 'resp.notifications.waitlist.get.v1'],
  ]) {
    const fixture = JSON.parse(await readFile(path.join(ROOT, `tests/fixtures/${file}.json`), 'utf8'));
    if (JSON.stringify(fixture) !== JSON.stringify(spec.components.examples[key].value)) {
      throw new Error(`official_fixture_changed:${file}`);
    }
  }
  return spec;
}

/** Cards contain the real v4 formatter output verbatim; all commentary is outside. */
export function buildOfficialPreview(runtime, spec) {
  const examples = spec.components.examples;
  const detail = runtime.parseWaitlistNotification(examples['resp.notifications.waitlist.get.v1'].value);
  const entries = runtime.parseBundles(examples['resp.bundles.v1.success'].value);
  if (entries.length !== 1 || !entries[0].bundle) throw new Error('official_bundle_invalid');
  const bundle = entries[0].bundle;
  // No account, no membership inference, no synthetic selection, no banner injection.
  const groups = [
    runtime.formatNotification(detail),
    runtime.formatBundle({ bundle, waitlist: [], collection: [] }),
  ];
  const cards = parts => parts.map(part => `<article class="rich-card">${part}</article>`).join('\n');
  const payload = (label, value) => `<details><summary>${label}</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`;
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Telegram · Ejemplos públicos oficiales ITAD</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#111b26;color:#e8eef5;font:15px/1.5 system-ui,sans-serif}
main{width:min(100%,390px);margin:auto;padding:18px 12px 36px}h1{font-size:22px;line-height:1.25}h2{font-size:18px;margin-top:28px}
.scope,.provenance{color:#b8c9d9;font-size:13px}.scope{padding:12px;border:1px solid #466075;border-radius:12px;background:#182939}
a{color:#83caff;overflow-wrap:anywhere}.rich-card{background:#22364a;border-radius:16px;padding:18px 16px;margin:14px 0;box-shadow:0 3px 12px #0003;overflow-wrap:anywhere}
.rich-card h3{font-size:21px;line-height:1.25;margin:0 0 16px}.rich-card h4{font-size:19px;margin:18px 0 8px}.rich-card p{margin:8px 0}.rich-card p:has(a)+p{font-size:13px;color:#c0d5e5}
mark{background:#a8d8a9;color:#123921;border-radius:5px;padding:2px 5px;font-size:14px}hr{border:0;border-top:1px solid #476078;margin:20px 0}
tg-button-row{display:block;margin-top:9px}tg-button{display:block;border-radius:9px;padding:12px 10px;text-align:center;font-weight:650;line-height:1.3}
tg-button[style="success"]{background:#2d7655;color:#fff}tg-button[style="primary"]{background:#2866a0;color:#fff}
details{margin:14px 0;font-size:13px}summary{cursor:pointer;color:#83caff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#172634;padding:10px;border-radius:8px;font-size:11px}
code{overflow-wrap:anywhere}.rich-card footer{color:#b8c9d9;font-size:12px;font-weight:400;margin:8px 0}li{margin:8px 0}
</style>
</head>
<body><main>
<h1>Ejemplos públicos oficiales ITAD</h1>
<div class="scope">Datos de documentación, históricos de 2024; no son precios actuales, respuestas de tu cuenta ni una prueba de entrega. Aproximación móvil de 390 px: Telegram adapta colores y tipografía a tu tema. El footer se representa menor y secundario solo en esta maqueta; la documentación no garantiza tamaño ni color exactos. Sin red ni assets externos; los botones Rich aquí son solo visuales. No se envía nada.</div>
<h2>1 · Aviso Waitlist oficial</h2>
<p class="provenance">Fuente: <a href="${source('docs/routes/notifications/examples/resp.notifications.waitlist.get.v1.yaml')}#L1-L73">detalle oficial, líneas 1–73</a>, vía <a href="https://docs.isthereanydeal.com/#operation/notifications-waitlist-v1-get">/notifications/waitlist/v1</a>. El formatter v4 recibe el objeto completo, no una envoltura inventada del webhook.</p>
${cards(groups[0])}
<div class="provenance">
<ul>
<li>13.99 EUR → 13,99 €; cut=0 → sin porcentaje, mark ni separador sobrante. Mínimo histórico 6.99 EUR → 6,99 €, comparativa numérica: el precio actual es mayor, no se presenta como mínimo. No se recalcula el descuento ni se infiere una señal H/N.</li>
<li>voucher, expiry y flag son null: se omiten. Sin banner: este ejemplo no aporta assets y el formatter los obtiene de la Waitlist de cuenta, no consultada.</li>
<li>La lista dice “Stardew Valley and 3 more games”, pero el detalle de documentación contiene solo un juego. No se inventan los tres restantes ni los detalles de los otros dos avisos listados.</li>
<li>Aviso: ${esc(detail.timestamp)}; leído: ${esc(detail.read)}; oferta: ${esc(detail.games[0].deals[0].timestamp)}. Las fechas del aviso y la oferta no coinciden; se conservan, sin mostrarlas dentro de la tarjeta v4.</li>
</ul>
</div>
${payload('Payload oficial íntegro del aviso (sin editar)', examples['resp.notifications.waitlist.get.v1'].value)}
${payload('Lista oficial: solo metadatos, no más tarjetas inventadas', examples['resp.notifications.get.v1'].value)}
<h2>2 · Bundle: ejemplo oficial de documentación</h2>
<p class="provenance">Fuente: <a href="${source('docs/routes/bundles/examples/resp.bundles.v1.success.yaml')}#L1-L89">ejemplo completo, líneas 1–89</a>. No es un placeholder genérico: incluye título, precio, cuatro juegos, un nivel y enlaces. Tampoco prueba que el bundle exista o sea comprable hoy.</p>
${cards(groups[1])}
<div class="provenance">
<ul>
<li>87.96 USD → 87,96 US$; no se convierte a EUR aunque el cliente tenga country=ES. Caducidad oficial ${esc(bundle.expiry)} → 00:59 22-03-2024, Europe/Madrid. El formatter omite los segundos; el original permanece íntegro debajo.</li>
<li>La nota de relanzamiento se conserva literalmente en el payload oficial debajo, pero ninguna nota ITAD se dibuja en la tarjeta. La publicación es ${esc(bundle.publish)}; los assets del ejemplo tienen parámetros t de fechas posteriores a su caducidad. No se actualiza ni se “repara” esa muestra histórica.</li>
<li>No hay consulta de Waitlist/Colección, ni membresía real o simulada: waitlist=[] y collection=[] son entradas locales para representar el contrato sin marcas. No prueba elegibilidad: el flujo real solo notifica bundles seleccionados por cruce.</li>
<li>Se mantienen los cuatro juegos, el nivel y todos los enlaces de compra/ITAD. Caducidad en bloque footer nativo: Hasta con fecha sin negrita. V4 no dibuja notas ni banners de bundles aunque el payload los aporte. counts y assets quedan en el original, no son campos visuales del modelo.</li>
</ul>
</div>
${payload('Payload oficial íntegro del feed (sin editar)', examples['resp.bundles.v1.success'].value)}
<h2>Contrato y procedencia verificables</h2>
<div class="provenance">
<p>Consultado el 01-11-2026 exclusivamente en documentación pública. <a href="https://docs.isthereanydeal.com/">docs.isthereanydeal.com</a>, OpenAPI 2.11.0, repositorio oficial <a href="${source('dist/openapi.json')}">IsThereAnyDeal/API</a>, commit <code>${COMMIT}</code>.</p>
<p>SHA-256 del OpenAPI público y de itad-openapi.json local, idénticos byte a byte: <code>${SPEC_SHA256}</code>. Los tres fixtures existentes coinciden con sus ejemplos oficiales.</p>
<p>Corrección documental: el feed oficial es <a href="${source('docs/routes/bundles/bundles.v1.yaml')}">/bundles/v1</a>, usado ya por el cliente. /bundles/v2 no existe en el contrato consultado. <a href="${source('docs/routes/games/bundles.v2.yaml')}">/games/bundles/v2</a> consulta bundles de un juego; su ejemplo resp.bundles.v2.success es igual al del feed, no una segunda oferta.</p>
<p>Webhook <a href="${source('docs/webhooks/examples/event.notification-waitlist.yaml')}#L1-L69">notification-waitlist</a>: array de juegos, distinto del detalle OAuth. <a href="${source('docs/webhooks/ping.yaml')}">ping</a> envía “pong”; solo receptor mock local, sin publicación ni autenticación inventada.</p>
<p>Telegram: <a href="https://core.telegram.org/bots/api#sendmessage">sendMessage</a> es texto (1–4096 caracteres); estas tarjetas usan <a href="https://core.telegram.org/bots/api#sendrichmessage">sendRichMessage</a> y <a href="https://core.telegram.org/bots/api#rich-html-style">Rich HTML</a>. <a href="https://core.telegram.org/bots/api#inputrichblockfooter">InputRichBlockFooter</a> admite footer como bloque de texto independiente, no CSS. Success/primary están en filas separadas. Las fuentes/notas de esta página no forman parte del mensaje. Aceptación y render reales pendientes de la ejecución del usuario.</p>
<p>Equivalencia: cada article contiene literalmente una parte devuelta por los formatters reales actuales, sin añadir campos ni estilos HTML al payload. Sin despliegue, cuenta, OAuth, envío real ni comprobación cloud. Validación local no garantiza cero fallos ni entrega exactamente una vez.</p>
</div>
${groups.map((parts, index) => payload(`HTML Rich exacto · tarjeta ${index + 1}`, parts)).join('\n')}
</main></body></html>
`;
  return { html, groups };
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--output' || !path.isAbsolute(args[1]) || !args[1].endsWith('.html')) {
    throw new Error('usage: node scripts/telegram-preview-oficial.mjs --output <absolute.html>');
  }
  const spec = await loadOfficialSpec();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'itad-official-preview-'));
  try {
    const runtime = await compilePreviewRuntime(temp);
    const { html, groups } = buildOfficialPreview(runtime, spec);
    await writeFile(args[1], html, 'utf8');
    console.log(`Preview local: ${args[1]}`);
    console.log(`Partes: ${groups.map(parts => parts.length).join(' / ')}; bytes Rich: ${groups.map(parts => parts.map(part => Buffer.byteLength(part)).join(',')).join(' / ')}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
