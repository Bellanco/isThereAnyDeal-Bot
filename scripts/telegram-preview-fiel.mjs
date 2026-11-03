import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExamples, compilePreviewRuntime } from './telegram-preview.mjs';
import {
  escapePreview, PREVIEW_CSP, PREVIEW_CSS, PREVIEW_UI, previewLimits, previewSources,
} from './telegram-preview-template.mjs';

/** No copied snapshots: each article is literally a current formatter part. */
export function buildFaithfulPreview(runtime) {
  const groups = buildExamples(runtime);
  const fallback = groups.map(runtime.stripImages);
  const withoutAssets = buildExamples(runtime, { noBanner: true });
  if (JSON.stringify(fallback) !== JSON.stringify(withoutAssets)) throw new Error('preview_fallback_changed');
  const titles = [
    '1 · Un juego, una tienda',
    '2 · Un juego, dos tiendas',
    '3 · Bundle: tres niveles, cinco juegos y marcas de cruce',
  ];
  const measure = html => ({
    bytes: runtime.utf8Length(html), blocks: runtime.countBlocks(html), images: runtime.countImages(html),
  });
  const metrics = groups.map(measure);
  const fallbackMetrics = fallback.map(measure);
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
<title>Telegram · Preview fiel de tres muestras Rich</title>
<style>${PREVIEW_CSS}</style></head><body><main>
<header><h1>Tres muestras Rich · fidelidad local</h1>
<p class="scope">${previewLimits}</p>
<p>Datos ficticios en contratos validados, no avisos actuales. Muestras 1 y 2: avisos OAuth Waitlist.
Muestra 3: feed bundles cruzado con Waitlist/Colección, no aviso oficial de bundles.
No se cambió el formatter ni el transporte productivo.</p>
<p class="provenance">Los img originales permanecen literalmente en el HTML y están bloqueados por CSP.
Con banners se ve un placeholder neutro «Banner de ejemplo» 600:280, no una foto ni tamaño garantizado por Telegram.
No se añade título, pie ni div dentro del banner. El del bundle pertenece a Nebula Drifters, no es portada.
Desmarcar muestra literalmente stripImages, el fallback real ante 400 con imagen.
El adaptador local solo añade role/tabindex a tg-button en el DOM; no modifica texto, estructura o URL.</p>
${previewSources}</header>
<output id="link-inspection" aria-live="polite">Botones y enlaces: inspección local sin navegación.</output>
<input id="banners" type="checkbox" checked><label for="banners">Mostrar posición de banners (recursos bloqueados)</label>
<div class="examples">
${groups.map((part, index) => `<section><h2>${titles[index]}</h2>
<div class="with-banner"><article class="rich-card">${part}</article></div>
<div class="without-banner"><article class="rich-card">${fallback[index]}</article></div>
<p class="measurement">Una parte. Con banner: ${metrics[index].bytes} bytes UTF-8 · ${metrics[index].blocks} bloques · ${metrics[index].images} imagen.
Sin banner: ${fallbackMetrics[index].bytes} bytes · ${fallbackMetrics[index].blocks} bloques.</p>
<details><summary>HTML fuente exacto · muestra ${index + 1}</summary><pre>${escapePreview(part)}</pre></details>
<details><summary>HTML fallback exacto · muestra ${index + 1}</summary><pre>${escapePreview(fallback[index])}</pre></details>
</section>`).join('\n')}
</div><script>${PREVIEW_UI}</script></main></body></html>`;
  return { html, groups, fallback, metrics, fallbackMetrics };
}

export async function writeFaithfulPreview(output) {
  if (!path.isAbsolute(output) || !output.endsWith('.html')) throw new Error('preview_output');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'itad-faithful-preview-'));
  try {
    const runtime = await compilePreviewRuntime(temp);
    const result = buildFaithfulPreview(runtime);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, result.html, 'utf8');
    return result;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') {
    console.error('usage: node scripts/telegram-preview-fiel.mjs --output <absolute.html>');
    process.exitCode = 1;
  } else {
    writeFaithfulPreview(args[1]).then(result => {
      console.log(`Preview local: ${args[1]}`);
      console.log(`Tres partes: ${JSON.stringify(result.metrics)}; fallback: ${JSON.stringify(result.fallbackMetrics)}`);
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
