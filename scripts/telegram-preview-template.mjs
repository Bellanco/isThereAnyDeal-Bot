// Observations, not a copy of Telegram's renderer. Native logical pixels are
// approximated as CSS pixels; fonts, theme, scaling and media layout still vary.
export const DESKTOP_COMMIT = 'a8de5f928ba68197195e6e752293af39d4db8e6c';
export const DESKTOP_SOURCE = `https://github.com/telegramdesktop/tdesktop/blob/${DESKTOP_COMMIT}/Telegram/SourceFiles/iv/`;
export const escapePreview = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";

export const PREVIEW_CSS = `
*{box-sizing:border-box}
:root{color-scheme:light dark;--page:#eef2f5;--card:#fff;--text:#17212b;--muted:#657786;--link:#287eb8;--line:#d5dfe6;--mark:#287eb81f;--success:#27854d;--success-bg:#27854d1f;--primary:#287eb8}
@media(prefers-color-scheme:dark){:root{--page:#111b24;--card:#202b35;--text:#e7edf2;--muted:#a5b3bf;--link:#7dbde5;--line:#41505c;--mark:#7dbde51f;--success:#79c891;--success-bg:#79c8911f;--primary:#337bab}}
body{margin:0;background:var(--page);color:var(--text);font:14px/1.5 system-ui,sans-serif}
main{width:min(100%,720px);margin:auto;padding:16px 12px 32px}
header,h1,h2,.scope,.provenance,.measurement,details,output{overflow-wrap:anywhere}
h1{font-size:22px}h2{font-size:17px;margin:24px 0 10px}
.scope{padding:12px;border:1px solid var(--line);border-radius:8px}
.provenance,.measurement{font-size:13px;color:var(--muted)}
a{color:var(--link)}summary,label{cursor:pointer}
details{margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}
output{display:block;min-height:2em;font:12px/1.5 monospace}
.rich-card{background:var(--card);border-radius:10px;padding:8px 12px;margin:12px 0;overflow-wrap:anywhere;font:13px/20px system-ui,sans-serif}
:where(.rich-card h3,.rich-card h4,.rich-card p,.rich-card footer,.rich-card hr){margin:0}
.rich-card>*+*{margin-top:4px}
.rich-card h3{font-size:17px;line-height:24px;font-weight:600}
.rich-card h4{font-size:16px;line-height:23px;font-weight:600}
.rich-card>*+h3,.rich-card>*+h4{margin-top:10px}
.rich-card footer{font-size:12px;line-height:19px;color:var(--muted);font-weight:400}
.rich-card mark{background:var(--mark);color:inherit;padding:0;font:inherit}
.rich-card code{font:13px/20px monospace;background:var(--mark);color:inherit}
.rich-card a{color:var(--link);text-decoration:none}
.rich-card hr{border:0;border-top:1px solid var(--line);margin:8px 0}
.rich-card:has(>img){position:relative}
.rich-card img{display:block;width:100%;aspect-ratio:600/280;visibility:hidden}
.rich-card:has(>img)::before{content:"Banner de ejemplo";position:absolute;top:8px;left:12px;right:12px;aspect-ratio:600/280;display:grid;place-items:center;border:1px dashed var(--muted);border-radius:6px;background:linear-gradient(135deg,var(--page),var(--line));color:var(--muted);font:500 14px/20px system-ui,sans-serif;pointer-events:none}
.rich-card tg-button-row{display:flex;gap:6px;margin-top:8px}
.rich-card tg-button{display:flex;flex:1;min-width:0;min-height:26px;align-items:center;justify-content:center;padding:3px 17px;border-radius:5px;text-align:center;font:600 13px/20px system-ui,sans-serif;cursor:pointer;overflow-wrap:anywhere}
.rich-card tg-button[style="success"]{background:var(--success-bg);color:var(--success)}
.rich-card tg-button[style="primary"]{background:var(--primary);color:#fff}
.rich-card :is(a,tg-button):focus-visible{outline:2px solid var(--link);outline-offset:2px}
#banners:not(:checked)~.examples .with-banner,#banners:checked~.examples .without-banner{display:none}
`;

// A browser does not implement tg-button. This local-only accessibility adapter
// exposes URLs as text OUTSIDE the Rich article; it never navigates or sends.
export const PREVIEW_UI = `
for(const button of document.querySelectorAll('.rich-card tg-button')){
  button.setAttribute('role','link');button.tabIndex=0;
}
function inspect(event){
  const link=event.target.closest('a,tg-button');
  if(!link)return;
  event.preventDefault();
  document.querySelector('#link-inspection').textContent='URL sin abrir: '+(link.getAttribute('url')||link.getAttribute('href'));
}
document.addEventListener('click',inspect);
document.addEventListener('auxclick',inspect);
document.addEventListener('keydown',event=>{
  if(event.target.matches('tg-button')&&(event.key==='Enter'||event.key===' '))inspect(event);
});
document.addEventListener('contextmenu',event=>{if(event.target.closest('a,tg-button'))event.preventDefault();});
document.addEventListener('dragstart',event=>{if(event.target.closest('a,tg-button'))event.preventDefault();});
`;

export const previewSources = `<p class="provenance">Contrato público Telegram:
<a href="https://core.telegram.org/bots/api#sendrichmessage">sendRichMessage</a>,
<a href="https://core.telegram.org/bots/api#inputrichmessage">InputRichMessage</a>,
<a href="https://core.telegram.org/bots/api#rich-html-style">Rich HTML</a>,
<a href="https://core.telegram.org/bots/api#richmessagebutton">RichMessageButton</a>.
Referencia nativa Desktop consultada 03-11-2026, commit ${DESKTOP_COMMIT}:
<a href="${DESKTOP_SOURCE}iv.style#L1102-L1174">tipografía y separaciones</a>,
<a href="${DESKTOP_SOURCE}iv.style#L956-L984">estilos de botones</a>,
<a href="${DESKTOP_SOURCE}markdown/iv_markdown_button_row.cpp#L563-L618">filas sin align distribuyen el ancho</a>.
No se usa el CSS de exportación HTML como si fuera el render del chat.</p>`;

export const previewLimits = `HTML fuente exacto; equivalencia semántica de bloques, orden y enlaces.
Estilos aproximados basados en Desktop público, no motor Telegram ni captura.
Colores, fuentes, escala, márgenes entre bloques, radios y adaptación móvil no están garantizados.
Compra success tiene tinte verde en la referencia Desktop; primary usa el tema.
Los botones y enlaces solo inspeccionan la URL aquí, también con teclado: no se abren ni envían mensajes.
Sin red ni assets externos. No acredita aceptación, entrega ni render Telegram real.`;
