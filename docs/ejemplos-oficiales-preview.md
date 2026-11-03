# Revisión pública de contratos y preview oficial — 2026-11-01

**Estado local actual NO desplegado:** [banner per-game autorizado](#banner-per-game-autorizado--2026-11-02-local-no-desplegado).
Las mediciones y negritas de seguimientos anteriores son históricas.

## Alcance y resultado

Solo documentación pública oficial, sin cuenta, API key real, OAuth, sondeo de
precios, assets descargados, mensajes reales, despliegue ni comprobación cloud.
La revisión inicial no cambió `src/`, los fixtures anteriores, la configuración ni el estado de
despliegue documentado. No se detectó un fallo de la aplicación al procesar los
ejemplos oficiales consultados; no modificó validadores/formatters. El seguimiento
aprobado de formato se registra al final, separado de esta auditoría.

**Corrección documental:** OpenAPI 2.11.0 documenta el feed `GET /bundles/v1`,
no `/bundles/v2`. El cliente `src/itad-client.ts` ya usa `/bundles/v1`.
Las menciones erróneas a `/bundles/v2` en el diseño vigente de README/I5 ya se
corrigieron a `/bundles/v1` en el seguimiento. `/games/bundles/v2` es la consulta de bundles de un juego,
con parámetro `id`; no sustituye al feed. No se reescribe el historial operativo.

## Procedencia reproducible

Consultados [docs.isthereanydeal.com](https://docs.isthereanydeal.com/) y el
repositorio oficial [IsThereAnyDeal/API](https://github.com/IsThereAnyDeal/API).
Commit observado y usado para fijar enlaces:
`7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f`.

[OpenAPI público fijado](https://raw.githubusercontent.com/IsThereAnyDeal/API/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/dist/openapi.json)
y `itad-openapi.json` existente resultaron **idénticos byte a byte**.
SHA-256 de ambos:
`0d128cd045bf2fd6c7db5b879ebcbe622266180563967076ce294f578ca07841`.
El generador verifica ese hash offline; si cambia, exige revisar de nuevo la
fuente pública antes de actualizar el pin. Las pruebas no consultan internet.

| Datos | Fuente oficial fijada | Evidencia |
| --- | --- | --- |
| Lista `/notifications/v1` | [resp.notifications.get.v1.yaml](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/notifications/examples/resp.notifications.get.v1.yaml#L1-L23) | 3 resúmenes; fixture `notifications-list.json` idéntico |
| Detalle `/notifications/waitlist/v1` | [resp.notifications.waitlist.get.v1.yaml](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/notifications/examples/resp.notifications.waitlist.get.v1.yaml#L1-L73) | Objeto completo, 1 juego/1 oferta; fixture `notifications-waitlist-detail.json` idéntico |
| Webhook `notification-waitlist` | [event.notification-waitlist.yaml](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/webhooks/examples/event.notification-waitlist.yaml#L1-L69) | Array de juegos, no objeto de aviso; fixture `notification-waitlist.json` idéntico |
| `ping` | [ping.yaml](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/webhooks/ping.yaml#L18-L24) | JSON string `"pong"`, no `{ping:...}`; receptor mock únicamente |
| Feed bundles | [bundles.v1.yaml](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/bundles/bundles.v1.yaml), [ejemplo](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/bundles/examples/resp.bundles.v1.success.yaml#L1-L89) | Bundle completo RimWorld, no placeholder genérico |
| Bundles por juego | [bundles.v2.yaml](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/games/bundles.v2.yaml), [ejemplo](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/games/examples/resp.bundles.v2.success.yaml#L1-L89) | `/games/bundles/v2`; el valor del ejemplo es igual al del feed |

No se considera «oficial» un fixture solo por el nombre: los tres valores se
compararon contra el OpenAPI remoto y se vuelven a comparar contra el snapshot
fijado en las pruebas y el generador.

## Contraste con el flujo real v4

- `domain`/`validation`: el detalle requiere `id`, `timestamp`, `read`, `games`;
  no se inventa metadata para envolver el webhook. Juegos y ofertas conservan
  todos sus campos requeridos, incluidos los nullable. `read` y los precios
  nullable aceptan `null`, no ausencia. Se conservan fechas originales y moneda.
- `itad-http`/`itad-client`: transporte inyectado, JSON, rechazo de red/timeout,
  HTTP no exitoso, redirect, JSON o shape incorrectos, `429`/`Retry-After`.
  Los mocks prueban lista → detalle con ID coincidente y feed ES/mature=true;
  no se piden detalles inexistentes para los otros dos resúmenes del ejemplo.
- `notifications`/`bundles`: formatters reales, sin recalcular precios, descuentos
  ni flags. H/N es «Mínimo histórico», S no se dibuja. No aparecen DRM,
  plataformas, tipos, adultos, publicación, habitual, storeLow o lastPrice.
  Precio y descuento juntos; tienda, cupón/caducidad cuando existan, filas
  success y primary separadas. No se pierde ningún juego, oferta, nivel ni
  enlace; no se normalizan enlaces afiliados.
- Bundles: el modelo visual es una **proyección**, no una copia íntegra del JSON.
  `page.name` pasa a `shop`, `isMature` a `mature`; `counts`, `page.id/shopId` y
  assets no son campos visuales. Los originales completos quedan visibles
  fuera de las tarjetas. `details` es opcional en el esquema; `expiry`/`note`
  son requeridos nullable en el contrato. La tolerancia anterior del parser a su
  ausencia se corrigió localmente en la auditoría de opcionales al final.
  Esa corrección no cambia el ejemplo ni está desplegada.
- Telegram oficial: [sendMessage](https://core.telegram.org/bots/api#sendmessage)
  es texto de 1–4096 caracteres después del parseo de entidades; no es el
  transporte de estas tarjetas. V4 usa
  [sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage) con
  `rich_message.html`, según
  [Rich HTML style](https://core.telegram.org/bots/api#rich-html-style) y
  [RichMessageButton](https://core.telegram.org/bots/api#richmessagebutton).
  Los colores success/primary dependen del tema. Se mantienen los presupuestos
  existentes de 30.000 bytes, 400 bloques y 40 imágenes por parte, inferiores a
  los límites oficiales (32.768, 500, 50). Nada de esto es una prueba de render
  real ni una garantía de entrega exactamente una vez.

## Inconsistencias/antigüedad conservadas

1. Stardew: `price=regular=lastPrice=13.99 EUR`, `cut=0`, `historyLow=6.99 EUR`,
   `storeLow=7 EUR`, `flag=null`. No hay inconsistencia aritmética de descuento:
   es cero oficialmente. El mínimo es inferior; no se inventa H/N.
2. `voucher` y `expiry` son `null`: no aparecen etiquetas vacías. No hay assets
   en el detalle del aviso; sin consulta de Waitlist no se añade banner.
3. El resumen dice «and 3 more games», pero el detalle tiene solo Stardew.
   No se inventan los otros tres ni los detalles de Potion Permit/Dwarven Skykeep.
4. Oferta: `2024-02-11T01:20:50+01:00`; aviso:
   `2024-09-24T02:43:04+02:00`; leído: `2024-10-06T16:06:47+02:00`.
   Son fechas diferentes del ejemplo, no datos actuales.
5. Bundle: «Rimworld with all Expansions Bundle», Fanatical, 1 nivel, RimWorld,
   Royalty, Ideology y Biotech; `87.96 USD` se muestra `87,96 US$`, no euros.
   `country=ES` no permite convertir ni reemplazar la moneda del ejemplo.
6. Publicado `2024-03-04T19:00:00+01:00`, caducado
   `2024-03-22T00:59:46+01:00`; V4 muestra
   `<footer>Hasta 00:59 22-03-2024</footer>` Madrid, sin segundos ni negrita
   (ajuste actual; las mediciones anteriores abajo son históricas).
   La nota `* Bundle being relaunched...again and again.` es oficial y se conserva
   en el payload fuera de la tarjeta, **no en el HTML Rich**. La decisión previa
   de mostrarla queda reemplazada; se omiten visualmente todas las notas ITAD.
   Los parámetros `t` de assets son posteriores a la caducidad: no se alteran.

## Entregable y reproducción local

`C:\Users\bella\.copilot\session-state\f5de483d-d716-4c23-bbf1-65bbeb7ce95e\files\telegram-preview-oficial.html`

Dos tarjetas mobile-first (~390 px), autocontenidas sin red/JS/assets externos:
aviso oficial completo y bundle oficial de documentación. Las fuentes, avisos de
antigüedad y payloads originales completos están **fuera** de las tarjetas.
Cada `article` contiene literalmente el HTML devuelto por el formatter real.
No hay banner inventado ni selección/membresía simulada en la maqueta:
`waitlist=[]`/`collection=[]` son entradas locales sin marcas. El bundle no
representa un aviso elegible de cuenta; la elegibilidad real exige el cruce.

Generación inicial: 1 parte por tarjeta, **418 / 920 bytes UTF-8 Rich**;
tras el ajuste aprobado de descuento cero: **398 / 920 bytes**.
El archivo no es una captura de Telegram. Los botones Rich son visuales, sin
envío ni apertura automática; los enlaces ordinarios de fuentes/juegos solo
se abren por acción explícita del lector.

Desde la raíz, los siguientes comandos existen y son solo locales:

```powershell
node scripts/telegram-preview-oficial.mjs --output 'C:\Users\bella\.copilot\session-state\f5de483d-d716-4c23-bbf1-65bbeb7ce95e\files\telegram-preview-oficial.html'
npm test -- tests/official-contract.test.ts tests/official-preview.test.mjs tests/validation.test.ts tests/itad-client.test.ts tests/notifications.test.ts tests/bundles.test.ts tests/telegram.test.ts
npm run typecheck
```

El directorio de salida debe existir. Compila los formatters reales en un
temporal propio y lo elimina al terminar. No modifica `dist`, ni usa el
modo `--live` del preview ficticio, ni acepta secretos.

Escenarios QA añadidos: igualdad de fixtures y contrato, shape completo,
nullable requeridos frente a ausencia, monedas, fechas inválidas, flags H/N/S,
URLs inseguras, batch inválido sin entrega, 140 juegos × 2 ofertas conservados,
chat/token entrantes ignorados, feed real de documentación pasado por cliente
ITAD y cliente Telegram con transporte mock, bundle nullable y marcas
**sintéticas únicamente en tests**, equivalencia literal tarjeta/formatter y
prohibición de recursos externos. Las pruebas existentes cubren errores de
red/HTTP/rate limit y límites de los formatters/clientes.

### Comprobaciones ejecutadas en la revisión inicial

- Runner targeted anterior: **7 archivos, 335 tests aprobados**, exit 0.
  Incluye 26 pruebas nuevas (24 de contrato y 2 de preview); no se ejecutó
  la suite completa. Durante la elaboración se corrigieron errores de las
  nuevas aserciones/helpers; no fueron defectos de la aplicación.
- `npm run typecheck`: **exit 0**.
- `git diff --check`: **exit 0** antes de añadir este registro de resultados.
- Generación offline: **exit 0**. Se volvió a compilar el runtime y comparar el
  archivo entregado con el generador: **igualdad literal de todo el HTML** y de
  las dos tarjetas con las partes de los formatters reales.
- HTML entregado: **19.842 bytes UTF-8**, sin assets externos; SHA-256:
  `2dcd3c71c87904e24abaf2ea054779a141b4bff9a33864ad2e16e0300ce4fdbd`.

Pendiente: primer payload real, elegibilidad de cuenta, render Telegram, salud
del cron/colas/servicios y entrega real. No se han comprobado ni autorizado en
esta revisión. Los ejemplos públicos reducen incertidumbre de shape/render
local, pero no garantizan cero fallos del primer aviso.

## Ajustes aprobados del formatter — seguimiento local

Implementados sobre el worktree existente, preservando README, generador y
tests de auditoría pendientes de versionar. **Sin red externa**, cuenta, OAuth,
cloud, despliegue, mensajes reales, secretos ni commits. Snapshot y fixtures
oficiales permanecen exactos; solo se actualizan expectativas del HTML.

- `cut=0`: precio recibido, sin porcentaje, mark ni separador sobrante;
  `cut>0`: formato previo. Precio cero sigue numérico, no «Gratis».
- `historyLow=null`: ninguna comparativa/etiqueta salvo H/N oficial.
  Conocido: `Mínimo histórico: X`; precio actual mayor no se presenta como
  mínimo. No se infiere H/N por igualdad/comparación de precios. Se preservan
  deduplicación de primera H/N+known y señales de otras ofertas; S omitida.
- Sin ofertas: título/enlace ITAD, sin precio inventado; histórico conocido
  sigue presente. Nivel `price:null`: `Nivel N`, más addon literal si existe.
- Moneda `Intl es-ES currency`, sin EUR forzado por ES; voucher/expiry null
  sin filas. Banner inseguro/ausente da el mismo HTML sin imagen; 400 con
  banner usa el fallback actual, probado con el formatter real.
- Sin cambios a limpieza v4, notas oficiales, selección/orden, fechas Madrid,
  botones en filas propias, límites/persistencia ni recuperación.
  Multipartes conserva todos los juegos/ofertas/niveles/URLs y `parte X/Y`.
  Sin regla de caducadas, Gratis, filtrado ni mínimos de tres meses.

Comandos ejecutados desde la raíz (locales):

```powershell
npm test -- tests/notifications.test.ts tests/bundles.test.ts tests/rich.test.ts tests/official-contract.test.ts tests/official-preview.test.mjs tests/telegram.test.ts tests/telegram-preview.test.mjs tests/bridge-cycle.test.ts tests/local-simulation.test.ts
npm run typecheck
npm test
npm test -- --no-file-parallelism
node scripts/telegram-preview-oficial.mjs --output 'C:\Users\bella\.copilot\session-state\f5de483d-d716-4c23-bbf1-65bbeb7ce95e\files\telegram-preview-oficial.html'
git diff --check
```

Resultados:

- Dirigido: **9 archivos, 309/309 aprobados**; incluye **17 casos añadidos**,
  zero/positivo y monedas, histórico conocido (0/menor/igual), H/N/S/null
  desconocido, sin ofertas known/null, tier null/addon/cero, fallback real,
  enlaces de niveles multipartes y expectativas oficiales de descuento cero.
  Primer pase detectó una expectativa antigua de 303 marcas `-0%`, corregida
  a 303 ofertas intactas sin marcas.
- Typecheck: **exit 0**. Full paralelo: **655/656**, fallo en test de timeout
  preexistente `itad-client` (`signal.aborted`). Full serial con el mismo
  runner: **18 archivos, 656/656**, exit 0; no se tocó código ajeno para
  corregir ese fallo transitorio. Warning de SQLite experimental, sin fallo.
- Medición nueva con runtime compilado real: **595 juegos × 2 ofertas,
  20 partes**, con/sin banners, sin recalibración; índices 2/1001 máximos
  **20762/20790 y 21131/21165 bytes**, **398/400 bloques**, **0/2 imágenes**.
  1190 compras y 595 enlaces ITAD; filas <2.000.000 bytes. Los tests validan
  además índices 5/8/11/98/101. [Tabla actualizada](I5.md#medicion-local-simulacion--d1-de-pruebas-y-d1-local-de-wrangler).
- Preview oficial regenerado: **398 / 920 bytes Rich**, 1 parte cada uno.
  Archivo **19.908 bytes**, SHA-256
  `9951cdeef00d557f1b3baf6edb8eb9877d530f92b900f1b62a14df25bbb3c576`.
  Comparación offline independiente tras recompilar: igualdad literal del
  archivo completo con el generador y de cada tarjeta con las partes reales;
  procedencia solo fuera de tarjetas.
- V4 existente: igualdad con las tres muestras reales, sustituyendo solo el
  placeholder de banner por su img para comprobar; **537/1287/1101 bytes**,
  **9/26/21 bloques** intactos. No necesitó regeneración; v2/v3 intactos.

No se ejecutaron de nuevo suites Wrangler D1/cron ni pruebas reales: no cambia
persistencia, ciclo o empaquetado; runner dirigido cubre cycle/pack. Render
Telegram, salud remota y entrega real siguen pendientes, sin garantía
exactamente una vez. El formatter local actualizado no está desplegado.

## Notas y caducidad — cambio local acotado

Seguimiento posterior del 2026-11-01; los resultados anteriores son históricos.
Se integra el worktree pendiente sin revertirlo. La decisión previa de mostrar
notas oficiales queda reemplazada explícitamente: se omiten **todas** las notas
ITAD de Rich bundles, sin filtro por texto. `bundle.note` permanece intacto en
payload, validadores y D1; snapshot y fixtures oficiales siguen exactos.
El original de la nota está disponible fuera de las tarjetas oficiales.

Ofertas y bundles comparten el formato de caducidad en línea propia
`<p>Hasta <b>hh:mm dd-mm-aaaa</b></p>`, reutilizando `when` Europe/Madrid
sin nueva abstracción. Null omite línea/etiqueta. El bundle oficial muestra
exactamente `<p>Hasta <b>00:59 22-03-2024</b></p>`.
No cambian el resto de reglas v4/cut=0/historyLow/null tiers, juegos, ofertas,
niveles, URLs, orden, presupuestos ni recuperación. Sin CSS/colores nuevos,
emojis, tablas, fecha de publicación, cron ni filtro de caducadas.

Comprobaciones ejecutadas:

```powershell
npm test -- tests/notifications.test.ts tests/bundles.test.ts tests/rich.test.ts tests/official-contract.test.ts tests/official-preview.test.mjs tests/telegram.test.ts tests/telegram-preview.test.mjs tests/bridge-cycle.test.ts tests/local-simulation.test.ts
npm run typecheck
node scripts/telegram-preview-oficial.mjs --output 'C:\Users\bella\.copilot\session-state\f5de483d-d716-4c23-bbf1-65bbeb7ce95e\files\telegram-preview-oficial.html'
git diff --check
```

- Runner dirigido: **9 archivos, 314/314 aprobados**, exit 0; typecheck exit 0.
  Casos de notas null/vacía/arbitraria/oficial/HTML/larga: misma salida que sin
  nota, entrada intacta. Ciclo con nota almacenada en `detail_json`, sin nota en
  `parts_json`/envío mock; bundle histórico no se filtra. Madrid exacto en negrita
  y null sin etiqueta en ambos formatters y previews.
- Preview oficial regenerado offline: **398 / 860 bytes Rich**, 1 parte por
  tarjeta. Archivo **19.918 bytes**, SHA-256
  `0e1fb95aa2d891a2130ba810545a88a2e77523c7e3317f4349a77bfc841a5648`.
  Recompilación independiente: igualdad literal del archivo completo con el
  generador y **2/2 tarjetas** con formatters reales. Procedencia y nota fuente
  solo fuera de las tarjetas.
- Preview v4 existente actualizado con salida real: **537 / 1297 / 1106 bytes**,
  **9 / 26 / 21 bloques**, una parte por ejemplo. Equivalencia literal
  **3/3 tarjetas**, normalizando únicamente el banner mock local a su `img`.
  Archivo **7.227 bytes**, SHA-256
  `8cdcbb774354d0c30be9217e028dc211479e92040d194b79a3eb25e6be33d51c`.
  Misma ruta de sesión en README; v2/v3 intactos. Sin archivo visual ni generador
  adicional, CSS existente intacto.
- Medición offline real repetida: **595 juegos × 2 ofertas, 20 partes** con/sin
  banners en índices 2/1001, 1190 compras y 595 enlaces ITAD. Máximos y filas D1
  de la tabla I5 sin cambios: esta muestra tiene expiry null. El runner conserva
  además índices 5/8/11/98/101. No se recalibra el escenario.

No full suite ni suites Wrangler D1/cron: el runner dirigido cubre formatter,
pack, cliente mock, ciclo y persistencia. Sin cuentas, OAuth, secretos, cloud,
live Telegram, envíos, despliegue ni commit/push. Render Telegram, entrega real
y salud remota siguen pendientes; no se garantiza entrega exactamente una vez.
La versión activa histórica no cambia por este encargo.

## Caducidad secundaria — footer Rich nativo

Revisión pública actual del 2026-11-01, integrada sobre los cambios pendientes,
sin revertirlos. Caducidad real de ofertas y bundles:
`<footer>Hasta 00:59 22-03-2024</footer>` (ejemplo oficial), sin `b`.
Helper compartido `src/rich.ts:expiryFooter`, usando `when` Madrid sin cambiar
ISO original, texto legado, selección, moneda, notas almacenadas o enlaces.
Null no genera bloque. El footer permanece junto a su oferta/cabecera de
bundle, antes de los botones; no se anida en un párrafo.

### Evidencia oficial Telegram

- [Rich HTML style](https://core.telegram.org/bots/api#rich-html-style):
  enumera `footer`, `h3/h4`, `p`, `b`, `code`, `mark`, `hr`, `a`,
  `img src`, `tg-button-row` y `tg-button type="url" style="success" url`.
  Solo admite etiquetas enumeradas; no usamos `small`, `span` ni CSS.
  Imágenes HTTP/HTTPS en bloques independientes.
- [InputRichBlockFooter](https://core.telegram.org/bots/api#inputrichblockfooter)
  y [RichBlockFooter](https://core.telegram.org/bots/api#richblockfooter):
  footer es un bloque de texto propio (`type: "footer"`, `text: RichText`).
  [InputRichMessage](https://core.telegram.org/bots/api#inputrichmessage)
  admite una lista de bloques; no documenta que footer deba ser único o último.
  **No garantiza tipografía menor, tamaño en px ni color concreto.**
  La maqueta representa el pie menor/secundario como aproximación, no evidencia
  de render del cliente. Quitar negrita sí cambia el contenido enviado.
- [RichMessageButton](https://core.telegram.org/bots/api#richmessagebutton):
  `success`/`primary` válidos, colores dependientes del tema; cada botón sigue
  en fila propia, compra primero. `mark` solo descuento positivo.
- [sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage):
  `chat_id` y `rich_message` requeridos, devuelve `Message` al tener éxito.
  [InputRichMessage](https://core.telegram.org/bots/api#inputrichmessage):
  exactamente uno de html/markdown/blocks; html y skip_entity_detection válidos.
  Cliente actual compatible, sin cambio de shape, credenciales/destino ni
  política de errores/fallback. [sendMessage](https://core.telegram.org/bots/api#sendmessage)
  sigue reservado al texto legado, límite 1–4096; no sirve para estos bloques.

Pruebas offline fortalecidas: subconjunto oficial de tags/atributos, footer e
imagen independientes, estilos de botones, request POST exacto con formatter
real y recibo mock. No equivalen a aceptación del servidor Telegram.
Join elimina **solo** el marcador `<footer>parte X/Y</footer>`, nunca caducidad.
El presupuesto ya cuenta cada footer (caducidad y marcador) como un bloque:
sin cambiar algoritmo, límites ni calibrar la simulación cron.

### Comprobaciones y entregables

```powershell
npm test -- tests/notifications.test.ts tests/bundles.test.ts tests/rich.test.ts tests/official-contract.test.ts tests/official-preview.test.mjs tests/telegram.test.ts tests/telegram-preview.test.mjs tests/bridge-cycle.test.ts tests/local-simulation.test.ts
npm run typecheck
npm run preview:telegram -- --dry-run
npm run preview:telegram -- --dry-run --no-banner
node scripts/telegram-preview-oficial.mjs --output 'C:\Users\bella\.copilot\session-state\f5de483d-d716-4c23-bbf1-65bbeb7ce95e\files\telegram-preview-oficial.html'
git diff --check
```

- Dirigido final: **9 archivos, 316/316 pruebas**, exit 0 (dos casos nuevos:
  helper footer y 1190 caducidades). Typecheck exit 0. Warning experimental de
  SQLite, sin fallo. `git diff --check`: exit 0. CLI offline con/sin banner
  exit 0, sin descargar imagen.
- Oficial regenerado con el generador existente: **398 / 863 bytes Rich**,
  una parte por tarjeta. Archivo **20300 bytes**; SHA-256
  `f8f9fcc1a1ef601c325658ba4297f302355741ad19084091791bb36401ffd194`.
  Recompilación independiente: archivo completo idéntico al generador,
  tarjetas **2/2** idénticas al formatter.
- V4 actualizado con `buildExamples`/formatter existentes: **537 / 1303 /
  1109 bytes**, **9 / 26 / 21 bloques**, una parte cada uno. Archivo
  **7489 bytes**; SHA-256
  `0751c27e4c9f4ae735d30e48e6cabcc8d2e8bb846504460912301cf13177ce49`.
  Equivalencia **3/3**, sustituyendo únicamente placeholder local por img real
  para comparar. CSS footer secundario solo en maqueta, aviso explícito de
  aproximación. Rutas de sesión anteriores conservadas; v2/v3 intactos.
- Medición normal **595 × 2**, índices 2/1001 con/sin banners: **20 partes**,
  valores de tabla I5 intactos (expiry null). Máximos globales **21165 bytes /
  400 bloques / 2 imágenes**; 1190 compras, 595 enlaces ITAD.
- Mutación sintética adicional con expiry en todas las ofertas: **23 partes**,
  **20121 bytes / 399 bloques** máximos, **1190 footers de caducidad** además
  de marcadores, 1190 compras/595 ITAD, fila **1011063 bytes**. Sin pérdidas.
  Multipartes exacto por bytes también probado con dos caducidades distintas.

Sin full suite ni Wrangler D1/cron: algoritmo/presupuesto y carga cron de
20 partes no cambian; las pruebas dirigidas cubren límites, cycle y mock D1.
Sin OAuth, cuenta, secretos, cloud, despliegue, commit/push ni mensajes reales.
Planes Rich ya guardados no se reformatean por este cambio.

**Aceptación/render reales: PENDIENTES de la ejecución del usuario.**
Para enviar tú los tres ejemplos ficticios con etiquetas finales, en terminal
privado TTY desde la raíz:

```powershell
npm run preview:telegram -- --live
# Alternativa: los mismos tres ejemplos sin imagen externa
npm run preview:telegram -- --live --no-banner
```

No ejecutar ambos automáticamente: repetir puede duplicar mensajes. Introduce
token/chat por entrada oculta y confirma `ENVIAR 3 EJEMPLOS`. Revisa caducidad
sin negrita, jerarquía, botones en filas propias y banner si lo eliges.
Confirmaciones del script prueban recibo, no aspecto visual: revisa el chat.
No enviar secretos ni logs privados como evidencia. El ejemplo histórico oficial
del HTML no se envía mediante ese live: son tres fixtures ficticios distintos.
No hay cambios cloud ni garantía exactamente una vez.

## Ajustes visuales aprobados — despliegue verificado (2026-11-02)

El formatter local evita repetir la tienda debajo del precio: el nombre sigue
en el botón de compra. Las caducidades usan «Hasta el 20 de octubre», sin hora
ni año, según la fecha de `Europe/Madrid`. El mínimo histórico destaca su
etiqueta con `<mark>`, mientras que el cupón conserva `<code>`. En bundles,
«En tu lista de deseos» se muestra con `<mark>` y «En tu Colección» con `<code>`.

La sintaxis elegida (`mark`, `b`, `code` y `footer`) ya forma parte de Rich HTML
documentado por Telegram. No se añaden tags, estilos CSS, emojis, campos ni datos
externos. El cambio no altera precios, selección, enlaces ni persistencia. El
despliegue está verificado en [I7 §19](I7-operacion.md#19-despliegue-autorizado-de-ajustes-rich--2026-11-02).
El preview visual es una aproximación y no acredita el render real.

## Seguimiento local NO desplegado — 2026-11-02

Se preservaron los **15 archivos dirty** iniciales. Sin secretos/configuración
privada, cuenta cloud, OAuth real, assets descargados, deploy, envíos ni commits.
La versión histórica activa registrada es
`9eedc6a6-7599-4350-aaa9-3250e58e1cdb`; no se consultó de nuevo.

### Presentación y preview exacto

- Solo el fixture **ficticio** 2 pierde Velvet Moon Afterdark: Clockwork Reef
  conserva ambas tiendas, URLs y cupón/caducidad, con banner opcional como 1.
  No hay filtro de juegos en el formatter real; las pruebas multijuego,
  contratos oficiales y multipartes siguen preservando juegos/ofertas/enlaces.
- Mínimo histórico vuelve a `<p>Mínimo histórico: X</p>` o
  `<p>Mínimo histórico</p>` para H/N con dato null; sin `<mark>`. Numéricos
  (incluido cero), null, señales oficiales y deduplicación H/N intactos.
- Bundle: «Comprar en Atlas Bundles» (misma regla para todas las tiendas);
  nombre de tienda solo en botón, no cabecera separada. Waitlist y Colección
  usan `<mark>`, también Colección sola. No se alteran títulos/URLs recibidos.
- Preview v4 existente fuera del repo actualizado; su HTML es la salida real,
  reemplazando **solo** las dos imágenes por placeholders locales explícitos.
  CSP sin red/assets. No se reformatean planes Rich/texto ya persistidos.

| Ejemplo | Bytes UTF-8 | countBlocks | Imágenes | Partes |
| --- | ---: | ---: | ---: | ---: |
| 1 con banner | 508 | 8 | 1 | 1 |
| 2 con banner | 796 | 14 | 1 | 1 |
| 3 | 1129 | 20 | 0 | 1 |
| 1 sin banner | 428 | 7 | 0 | 1 |
| 2 sin banner | 717 | 13 | 0 | 1 |

Medido con `utf8Length/countBlocks/countImages` exportados por el runtime real.
`countBlocks` **incluye footer**. Las métricas previas 21/20 omitían footers:
aquellos HTML tenían 23/21; el nuevo bundle tiene 20 al quitar la línea tienda.
Assertions exactas de HTML ejemplo 2 y de métricas ambas variantes en
`tests/telegram-preview.test.mjs`.

### Colección: recorrido y diagnóstico limitado

Fuente pública consultada:
[GET Collection](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/collection/games.v1.yaml),
[ejemplo oficial](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/collection/examples/resp.games.get.v1.success.yaml).
Devuelve **array completo de juegos con `id` UUID**, requiere `coll_read`;
no documenta offset/limit ni cursor. No se inventa paginación ni se siguen
cabeceras Link. Fixture oficial de OpenAPI probado con el cliente real y
formatter. `parseGameIds` toma `id` (no copy/group/slug), valida todos y
normaliza minúsculas; un ID inválido rechaza todo, no inventa pertenencia.

`bridge` usa el scope **persistido del grant efectivo**, no el mero scope
solicitado por la aplicación. Solo carga Colección si hay bundles nuevos que
cruzan Waitlist (`wait_read`); la carga se reutiliza en ese ciclo. Cruza IDs de
**todos** los niveles/juegos y pasa coincidencias a `formatBundle`.
Sin `coll_read` no llama Collection y no marca; no significa «no poseído».
HTTP 403/503, red, timeout, 429, JSON/shape inválido o cuerpo superior al límite
local de **1.500.000 unidades de string** producen fallback sin marcas,
con warning `collection_<categoría>`. Es una cota local posterior a leer el
cuerpo, no un máximo/paginación del servicio ni límite previo de descarga.
No se amplió arbitrariamente ni se añadieron llamadas reales.

`saveBundlePlan` persiste atómicamente `detail_json` con `collection` y
`parts_json`/`delivery_parts` Rich. Recuperación entrega **esas partes**, no
consulta ni re-enriquece planes existentes. Tras un fallback queda `collection: []`;
recuperar después el servicio o permiso **no añade retroactivamente la marca**.
Deduplicación por `bundle:<id>` evita repetir un bundle ya conocido. Sin
garantía de entrega exactamente una vez ni cambios en baseline/gates/recibos.

Bug defensivo reproducido y corregido: la frontera del bridge asumía que
Waitlist/Collection de cualquier implementación del puerto venían en minúscula;
IDs UUID uppercase no coincidían antes de formatear/persistir. Ahora normaliza
ambos sets. **El cliente real ya normalizaba**: no se atribuye por ello la
incidencia del usuario a ese bug. Ausencia de scope efectivo, fallos de lectura,
cota local, ID diferente o snapshot persistido previo son causas plausibles,
no confirmadas. No hay datos del grant/respuesta/plan real para elegir una.
No se inventa ownership por título/slug/tienda y no se propone OAuth real sin
permiso. Las pruebas cubren ambos/solo colección, scopes ausentes, fallos
403/503/shape/red/429, snapshot durable, recuperación sin reformat y no repetición.

### USD / EUR: límite oficial

[Contrato oficial del feed `/bundles/v1`](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/bundles/bundles.v1.yaml)
consultado junto a [docs.isthereanydeal.com](https://docs.isthereanydeal.com/)
(2.11.0): parámetros `country`, `offset`, `limit`, `mature`, `expired`, `sort`.
`country` es ISO 3166-1 alpha-2; **no documenta `currency` ni opción EUR**.
El cliente conserva `country=ES&mature=true`, sin parámetro inventado.
El ejemplo oficial trae USD y permanece `87,96 US$`: no se convierte ni
renombra a EUR, y ES no garantiza la moneda. Test fija parámetros oficiales
y preservación amount/amountInt/currency. No se hizo petición real del feed ES.

### QA reproducible ejecutado

```powershell
npm test -- tests/telegram-preview.test.mjs tests/notifications.test.ts tests/bundles.test.ts tests/official-contract.test.ts tests/official-preview.test.mjs tests/bridge-cycle.test.ts tests/itad-client.test.ts tests/local-simulation.test.ts tests/rich.test.ts --maxWorkers=1
npm run typecheck
```

Resultado final: **370 tests / 9 archivos**, exit **0** (14,81 s);
typecheck exit **0**. Warning SQLite experimental, sin fallos finales.
Comprobación adicional en memoria con `compilePreviewRuntime/buildExamples`:
**3/3 artículos del preview iguales literalmente** al formatter tras sustituir
solo los **2 placeholders** por sus `<img>`; métricas con footer confirmadas,
exit **0**. `git diff --check`: exit **0**. El primer check de métricas por
stdin perdió el separador Unicode en PowerShell; repetido con `\u00b7`, pasó
sin cambiar el HTML.
En una iteración previa fallaron una expectativa de título del nuevo test y
su tipo de mock; corregidos y vuelto a ejecutar el conjunto afectado.
Sin full suite, Wrangler D1/cron ni dry-run: no cambian schema/presupuestos/
algoritmo de packing. QA durable usa SQLite local de prueba, no estado real.
Render real, grant efectivo/respuesta/plan del aviso recibido y salud actual
requieren evidencia autorizada posterior; no se ejecutaron.

## Auditoría de opcionales y Colección — 2026-11-02 (NO desplegada)

Trabajo sobre **17 archivos dirty previos**, preservados sin revertir, stage ni
commit. Sin lectura de secretos/config privadas, cloud/D1 real, OAuth/refresh
real, mensajes, assets descargados ni deploy. Red solo para documentación
pública. No se atribuye la incidencia del usuario a una causa real sin evidencia.

### Opcionales: contrato frente a presentación

Fuentes oficiales consultadas de nuevo: [OpenAPI 2.11.0 fijado](https://raw.githubusercontent.com/IsThereAnyDeal/API/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/dist/openapi.json),
[docs públicas](https://docs.isthereanydeal.com/),
[ejemplo notification-waitlist](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/webhooks/examples/event.notification-waitlist.yaml)
y [ping](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/webhooks/ping.yaml).
Fixtures oficiales existentes contrastados por `official-contract.test.ts`.
`ping` lleva JSON `"pong"`; no hay cambio del receptor mock.

- Avisos: `historyLow`, `voucher`, `expiry`, `flag` son **requeridos nullable**,
  no campos que se puedan suprimir del JSON. El render omite precio mínimo,
  cupón/caducidad cuando son `null`; también cupón `""`, descuento **0** y foto
  sin URL segura. `cut` es entero requerido 0–100: ausencia/null/fuera de rango
  rechazan el lote completo antes de entregar, no se convierten en 0.
- Marcas de Waitlist/Colección: solo aparecen si hay coincidencia en los sets
  enriquecidos del bundle; sin coincidencia no hay párrafo/etiqueta vacíos.
  Banner ausente no elimina título, precio ni enlaces.
- **Elección para coordinador:** mantener H/N con `historyLow:null`.
  `obj.deal-flag` define H = Historical Low y N = New Historical Low, sin
  condicionarlos a un precio comparativo. `null` significa que no hay precio
  numérico disponible, no anula esa señal independiente. Se conserva la etiqueta
  aprobada «Mínimo histórico»; no se inventa un importe ni un flag. Cuando hay
  importe se mantiene la deduplicación existente del primer H/N.
- Bundle: `expiry` y `note` requeridos permiten `null`; `tiers[].price` requerido
  permite `null`; `details` **opcional string**, no admite `null` en la entrada
  oficial. Ausencia de `details` se normaliza al `null` del modelo interno.
  La nota sigue conservada en datos, nunca visible por decisión anterior.

Se conserva la tolerancia preexistente del parser de bundles para `expiry`/`note`
ausentes y `details:null`, normalizados a `null` interno. Esa compatibilidad no
cambia el contrato oficial ni se extiende a precios, descuentos u otros campos
obligatorios. Esta petición visual no endurece entradas antes aceptadas ni
modifica baseline o planes anteriores.

### Colección: traza completa y límites del diagnóstico

Contrato [GET /collection/games/v1](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/collection/games.v1.yaml),
[Collection Game](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/collection/schemas/obj.collection.game.yaml)
y [ejemplo](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/collection/examples/resp.games.get.v1.success.yaml):
array de juegos; sin parámetros de paginación/cursor ni envoltorio. Se realiza
una sola petición; Link inventado no se sigue.

Campos requeridos oficiales: `id` **UUID del juego**, `slug`, `title`, `type`
(nullable), `assets` (puede ser `{}`), `mature`, `group` (número ≥0) y `added`
(fecha/null). `group` es categoría, **no ID del juego**. No se usan IDs internos
numéricos, IDs de copias, títulos ni slugs para deducir propiedad.
El endpoint de copias no garantiza cubrir cada juego en Colección; no sustituye
al de juegos. Los parsers de enriquecimiento existentes son proyecciones:
`parseGameIds` verifica todos los UUID y descarta los demás campos; no es un
validador integral de Collection Game. No se cambió esa arquitectura.

Recorrido local:

1. `src/oauth.ts`: solicita `notifications wait_read coll_read`, acepta
   `token_type:Bearer` (case-insensitive), tokens opacos sin suponer JWT.
   `src/d1-storage.ts` conserva el grant efectivo cifrado. `bridge.ts` toma
   `tokens.scope` o el scope del resultado de refresh, no el solicitado
   inicialmente. El **access token** va en Authorization Bearer; refresh token
   solo al endpoint de tokens; API key del feed no sirve para Colección.
2. `src/itad-client.ts:collectionGameIds` → GET OAuth → `parseGameIds` →
   UUID lowercase. Sin llamadas para paginar. Red/timeout/HTTP/429/JSON/shape
   se clasifican; el límite local es 1.500.000 unidades de string tras leer
   el cuerpo, no un límite del contrato.
3. `src/bridge.ts:loadCollection/scanBundles`: solo tras baseline, gate debido,
   bundles nuevos válidos y cruce Waitlist; requiere `wait_read` para el cruce
   y `coll_read` para propiedad. Sin `coll_read` devuelve set vacío sin warning
   ni petición. Fallos devuelven set vacío con `collection_<categoría>`;
   un 429 también retrasa agenda. Carga una sola vez por check, incluso si falla;
   no existe caché de Colección persistente entre checks. Cruza todos los
   niveles/juegos por UUID normalizados.
4. `src/bundles.ts:gameLine` dibuja las coincidencias. **Avisos Waitlist normales
   no reciben Colección:** `bridge.ts` en Details solo carga banners y llama
   `formatNotification`; `notifications.ts:FormatOptions` solo contiene banners.
   Test nuevo lo reproduce con `coll_read` y UUID presente en Colección.
5. `src/d1-storage.ts:saveBundlePlan` guarda snapshot `collection`, partes y formato
   Rich mediante batch/INSERT OR IGNORE. Delivery lee `delivery_parts`, no vuelve
   a formatear/enriquecer el aviso. Plan pendiente o confirmado sin marcas
   permanece así aunque más tarde funcionen web/Collection o se conceda scope.
   `bridge.ts:deliver` confirma recibo solo tras éxito Telegram y CAS; si se
   pierde el recibo después del envío puede haber duplicado. No se prometen
   entregas exactamente una vez ni se modifican recibos/planes ya persistidos.

**No está demostrada la causa en producción.** Que al abrir ITAD la pertenencia
funcione no prueba el scope del bot, respuesta del API en el momento del plan,
UUID cruzado ni HTML persistido. El bug de uppercase corregido en trabajo previo
solo afecta implementaciones del puerto que no normalizaban; el cliente real ya
normalizaba. En esta auditoría no se añade otro supuesto arreglo de Colección.

Diagnóstico limitado al resumen de logs ya existente:
[procedimiento del usuario](I7-operacion.md#riesgos-y-señales-de-operación-del-rediseño).
Compartir **solo** `bridge_cycle`: `bundles.state`, `bundles.planned`,
`calls.itadCollection`, `warnings/errors` redactados; no UUID/snapshots,
cuenta/chat, tokens, payloads ni request logs. Para datos antiguos puede no
existir evidencia de aquel instante: una lectura posterior no demuestra qué
ocurrió. Esta tarea **no autoriza** obtener esos datos mediante cloud o llamadas reales.

**Pregunta al usuario/coordinador:** ¿la marca se esperaba en un bundle o en un
aviso Waitlist normal? Extenderla a avisos normales sería funcionalidad nueva,
no reparación de un fallo demostrado. No se implementó sin esa decisión.

### ¿Los bundles tienen imagen?

[Bundle oficial](https://github.com/IsThereAnyDeal/API/blob/7be4a2c68faad323ba770bfd32e1d4dc4f9c7c3f/docs/routes/bundles/schemas/obj.bundle.yaml)
no define imagen/banner/assets **propios del bundle**.
`tiers[].games[]` sí usa `obj.game` con `assets`: mapa de claves opcionales
`banner145`, `banner300`, `banner400`, `banner600`, `boxart`. El ejemplo oficial
RimWorld incluye imágenes de sus juegos; no acredita un banner propio del pack.
`counts.media` tampoco proporciona URL ni una imagen.

Estado de la auditoría anterior (reemplazado por el banner autorizado abajo):
el snapshot público `itad-openapi.json` y el preview oficial conservan
el JSON original como evidencia fuera de tarjetas. `parseBundles/bundleGame`
descarta los assets de juegos; `BundleGame`, `BundleNotice` y su snapshot D1
**no los conservan**. `formatBundle` no emite `<img>`. Para avisos normales se
extrae solo el mejor banner seguro de Waitlist (600→400→300); se conserva su
URL en el HTML planificado, no el mapa de assets ni los bytes de imagen.
No se implementó banner de bundle: elegir imagen de un juego o collage requiere
decisión del usuario y no equivale a recibir una imagen oficial del bundle.

Telegram consultado: [sendMessage](https://core.telegram.org/bots/api#sendmessage)
devuelve Message tras éxito y admite 1–4096 caracteres; las tarjetas actuales
usan [sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage), no
sendMessage. Sin cambios de transporte, límites ni fallbacks de imagen.

### QA de esta auditoría

```powershell
npm test -- tests/validation.test.ts tests/notifications.test.ts tests/bundles.test.ts tests/official-contract.test.ts tests/itad-client.test.ts tests/bridge-cycle.test.ts --maxWorkers=1
npm run typecheck
git diff --check
```

Suite dirigida final: **412 tests / 6 archivos, exit 0**, 7,57 s. Typecheck
**exit 0**. Warning SQLite experimental solamente; SQLite de tests local,
no D1 real. Regresiones: null/ausencia, cut inválido en lote, H/N sin precio,
sin etiquetas vacías, assets oficiales, alcance de marcas, scope ausente,
401/403/503/JSON/shape/red/timeout/429, caché de fallo y planes pendientes
entregados sin re-enriquecer después de recuperación.
No full suite, integración Wrangler, dry-run, despliegue ni comprobación real
de render/entrega. Los ajustes son **locales NO desplegados**.

## Banner per-game autorizado — 2026-11-02 LOCAL NO DESPLEGADO

Reemplaza únicamente la decisión anterior de no mostrar imágenes en bundles.
Se preservaron los 18 archivos dirty iniciales, sin reset, stage ni commit.
No cambia el flujo de Colección ni su telemetría, filtros, gates, scopes,
cadencias, deduplicación o recuperación.

### Contrato y decisiones

Reconsultados solo documentos públicos: Bundle y su ejemplo oficial fijado
arriba, `notification-waitlist`, `ping` y Telegram `sendMessage` /
`sendRichMessage` / Rich HTML. Bundle referencia `tiers[].games[]` → `obj.game`;
`obj.asset-map` enumera banners opcionales 600/400/300/145 y boxart.
No hay una imagen propia del pack. El ejemplo RimWorld del OpenAPI fijado se
usa como fixture **sin modificarlo** y sin descargar sus imágenes.

- Parser: proyecta el primer banner HTTPS aceptado por `safeImageUrl`, orden
  `banner600 → banner400 → banner300 → banner145`, sin construir/reparar URLs.
  Assets ausentes, vacíos, malformados o inseguros no invalidan juegos/bundles.
  No se usa boxart. Waitlist normal conserva su selección anterior.
- Modelo: `BundleGame.banner?: string | null` conserva el mejor URL necesario,
  no el mapa completo ni los bytes del asset. `BundleNotice` y `saveBundlePlan`
  ya guardan JSON íntegro del modelo: no requiere migración ni cambio de storage.
  Roundtrip probado con storage real de aplicación sobre SQLite **en memoria**.
  Ausencia del campo en planes antiguos sigue válida; no se re-enriquece ni se
  reescribe HTML persistido. La deduplicación por ID permanece igual.
- Formatter (cambio local aún no desplegado): primer juego con banner válido **y** en Waitlist, respetando orden
  de tiers/juegos (no orden de IDs de Waitlist). Sin juego de Waitlist con
  banner válido → no imagen; no se usa otro juego del bundle (decisión del
  usuario 2026-11-02). Colección no decide el banner.
  Solo una imagen, en primera parte, sin un pie de título decorativo.
- `pack` sigue presupuestando bytes/bloques/imágenes de la imagen;
  división solo por límites, sin truncar ni filtrar juegos, repeticiones,
  niveles o enlaces. La imagen puede desplazar un límite entre partes.
  URLs de compra/details y enlaces per-game se conservan exactamente con el
  escape HTML existente. Unidades indivisibles excesivas siguen rechazadas.
- Cliente Telegram sin cambios: 400 con imagen permite un único fallback.
  `stripImages` también elimina el pie identificativo de planes antiguos que
  todavía lo contengan; texto/enlaces/contador de parte quedan intactos.
  Red/timeout/429/400
  persistente mantienen el tratamiento existente. No entrega exactamente una vez.

### Maqueta y mediciones exactas

Actualizada únicamente la tercera tarjeta y su medición/título en
`C:\Users\bella\.copilot\session-state\f5de483d-d716-4c23-bbf1-65bbeb7ce95e\files\telegram-preview-v4.html`.
Primeros dos ejemplos intactos. Tercero: placeholder **local explícito**
de Nebula Drifters, no portada propia del bundle. El script real
`scripts/telegram-preview.mjs` genera ese ejemplo mediante parser/formatter con
`assets.banner600=https://example.invalid/preview/nebula-banner600.jpg`:
fixture ficticio no descargable, sin fetch ni envíos.
La maqueta oficial separada usa ahora `stripImages`, fallback real, para seguir
offline: no descarga los banners oficiales.

| Ejemplo | bytes UTF-8 | countBlocks | imágenes | partes |
| --- | ---: | ---: | ---: | ---: |
| 1 con banner | 508 | 8 | 1 | 1 |
| 2 con banner | 796 | 14 | 1 | 1 |
| 3 con banner per-game | 1204 | 23 | 1 | 1 |
| 1 sin banner | 428 | 7 | 0 | 1 |
| 2 sin banner | 717 | 13 | 0 | 1 |
| 3 sin banner | 1139 | 22 | 0 | 1 |

Medidos compilando el runtime real con `compilePreviewRuntime` y
`buildExamples`, usando `utf8Length/countBlocks/countImages`. Equivalencia
**3/3 exacta** al sustituir únicamente cada placeholder por su `<img>` del
fixture; **3/3 exacta** entre `stripImages` y salida `--no-banner`.
HTML externo completo: **8051 bytes UTF-8**, cero `<img>` remoto, CSP
`img-src 'none'; connect-src 'none'`. No prueba de render real Telegram.

### QA reproducible y límites

```powershell
npm test -- tests/bundles.test.ts tests/bundle-banner-storage.test.ts tests/validation.test.ts tests/rich.test.ts tests/telegram.test.ts tests/telegram-preview.test.mjs tests/official-contract.test.ts tests/official-preview.test.mjs tests/bridge-cycle.test.ts tests/notifications.test.ts tests/itad-client.test.ts --maxWorkers=1
npm run typecheck
git diff --check
```

Resultado final: **535 tests / 11 archivos, exit 0**, 10,89 s; typecheck y
diff-check **exit 0**. La primera pasada detectó expectativas antiguas de
«sin imagen», una medida estimada incorrecta y un `undefined` explícito
incompatible con exactOptionalPropertyTypes; corregidos y reejecutados.
Solo warning SQLite experimental. Casos: prioridad Waitlist, sin imagen sin
Waitlist con banner,
600/400/300/145, unsafe/missing, tiers vacíos/múltiples, repeticiones,
multipartes y límites, roundtrip/reinicio simulado antiguo/nuevo sin assets,
no reemplazo de plan existente, exactitud de URLs/contenido, y fallback 400
aplicable tanto al bundle oficial como al tercer ejemplo.

**Diagnóstico Collection, solo por el usuario:** histórico en dashboard
Workers Logs si existe; live con
`node .\node_modules\wrangler\bin\wrangler.js tail --config .\wrangler.production.local.jsonc --format json`,
detener con Ctrl+C. Compartir solo `bridge_cycle`: `bundles.state`,
`bundles.planned`, `calls.itadCollection`, `warnings/errors` redactados.
Nunca cuenta/chat, tokens, datos, UUID, payloads ni request logs o salida
completa. `itadCollection=0` solo sugiere scope si hubo bundle nuevo planificado,
no demuestra la causa; `=1` sin warnings no confirma UUID ni propiedad.
No se ejecutó tail ni se cambió el flujo/telemetría.

Pendiente: aceptación/render/descarga por Telegram y datos reales de Colección.
Sin full suite, integración D1/cron Wrangler ni comprobación cloud. Sin lectura
de secretos/config privada, OAuth, estado persistente real, envíos, descarga de
assets ni deploy. Red usada exclusivamente para documentación pública.

## Fidelidad de las tres muestras — 2026-11-03 local

### Fuentes y resultado del contraste

Se revisó la maqueta histórica `telegram-preview-v4.html`, sin sobrescribirla.
La evidencia confirma **tres** muestras ficticias: un juego/una tienda,
un juego/dos tiendas y un bundle con tres niveles/cinco juegos. No se
confunden con las **dos** tarjetas de documentación de
`scripts/telegram-preview-oficial.mjs`.
Fuente de contenido actual: `buildExamples` en `scripts/telegram-preview.mjs`,
validadores reales y `formatNotification`/`formatBundle`. Transporte de
referencia: `TelegramClient.sendRich`, sin cambios en `src/`.

Documentación pública Telegram consultada el 03-11-2026:

- [sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage) recibe
  `rich_message` y devuelve `Message`.
- [InputRichMessage](https://core.telegram.org/bots/api#inputrichmessage):
  exactamente una representación `html`/`markdown`/`blocks`;
  `skip_entity_detection` omite detección automática.
- [Rich HTML](https://core.telegram.org/bots/api#rich-html-style):
  admite títulos, `p`, `mark`, `code`, `footer`, `hr`, imágenes como bloques
  independientes y `tg-button-row`/`tg-button`. No es HTML/CSS de navegador.
- [RichMessageButton](https://core.telegram.org/bots/api#richmessagebutton):
  URL y estilos `success`/`primary`; las apps pueden usar colores del tema.

Para aproximar estilos se consultó el cliente **nativo** público Desktop,
commit [`a8de5f928ba68197195e6e752293af39d4db8e6c`](https://github.com/telegramdesktop/tdesktop/tree/a8de5f928ba68197195e6e752293af39d4db8e6c):

- [`iv.style`, 1102–1174](https://github.com/telegramdesktop/tdesktop/blob/a8de5f928ba68197195e6e752293af39d4db8e6c/Telegram/SourceFiles/iv/iv.style#L1102-L1174):
  `messageMarkdown` tiene cuerpo 13, h3 17/24, h4 16/23, footer 12/19;
  skips de párrafo 4, título 10 y fila 8 (unidades lógicas del cliente).
- [`iv.style`, 956–984](https://github.com/telegramdesktop/tdesktop/blob/a8de5f928ba68197195e6e752293af39d4db8e6c/Telegram/SourceFiles/iv/iv.style#L956-L984)
  y [`iv_markdown_button_row.cpp`, 263–267](https://github.com/telegramdesktop/tdesktop/blob/a8de5f928ba68197195e6e752293af39d4db8e6c/Telegram/SourceFiles/iv/markdown/iv_markdown_button_row.cpp#L263-L267):
  `success` usa color verde del tema y fondo tintado con opacidad 0,12,
  no necesariamente verde sólido con texto blanco.
- [Filas, 563–618](https://github.com/telegramdesktop/tdesktop/blob/a8de5f928ba68197195e6e752293af39d4db8e6c/Telegram/SourceFiles/iv/markdown/iv_markdown_button_row.cpp#L563-L618):
  sin `align`, se distribuye el ancho. Se mantiene cada botón en su fila.
- [`messageMarkdown`, 1344–1363](https://github.com/telegramdesktop/tdesktop/blob/a8de5f928ba68197195e6e752293af39d4db8e6c/Telegram/SourceFiles/iv/iv.style#L1344-L1363):
  mark hereda el tema, con tinte; no hay chip con tipografía propia enviado.

Se examinó también `Telegram/Resources/export_rich/css/rich_message.css`.
Es CSS de **exportación HTML**, con medidas distintas; no se tomó como prueba
del render del chat. No se copió el motor ni su hoja de estilos: el helper
local expresa solo una aproximación de las observaciones anteriores.

### Diferencias corregidas y límites

- Se eliminó la sustitución manual de `img` por `div` con título/pie dentro
  del artículo. Ahora cada artículo contiene literalmente HTML actual,
  con imágenes originales bloqueadas por CSP. Solo se dibuja un marco
  ilustrativo 600:280 (puede mostrar el icono de imagen bloqueada del navegador);
  no garantiza recorte, altura ni proporción Telegram, especialmente del bundle.
  El banner del bundle sigue siendo de Nebula Drifters, no una portada.
- Se redujeron títulos, relleno y separaciones exagerados. `mark` no añade
  padding/tamaño/peso propios. Compra usa tinte verde, ITAD primary del tema.
  Se quitó la regla contextual `p:has(a)+p` del preview oficial, que alteraba
  arbitrariamente párrafos tras enlaces. Ambos previews usan un helper mínimo.
- No se movió ni añadió ningún bloque: precio/descuento juntos, tienda en
  compra, cupón, footer y enlaces siguen en el orden del formatter. Se
  conservaron dos tiendas, los tres niveles/cinco juegos y ambas marcas.
- El control de banners muestra literalmente `stripImages`, comprobado igual
  al formatter sin assets. Ante 400 con imagen, el transporte simulado
  produjo exactamente ese segundo payload; no se cambió el fallback real.
- Los botones Rich no son botones nativos del navegador: el adaptador local
  solo añade `role`/`tabindex` al DOM y permite inspeccionar la URL en un
  `output` **fuera del artículo**, mediante click, Enter o Espacio.
  Los enlaces también inspeccionan sin navegación; no se reescriben URLs.
- Se corrigió texto desactualizado del preview oficial sobre caducidad:
  el formatter muestra día/mes, no hora/año.

**Exacto:** HTML fuente del formatter y JSON del transporte simulado
`{chat_id, rich_message:{html, skip_entity_detection:true}}`, sin CSS,
comentarios de QA ni elementos de UI dentro del payload.
**Equivalente:** árbol semántico de bloques/textos/atributos/enlaces; las
únicas adiciones DOM son accesibilidad local en `tg-button`.
**Aproximado:** estilos observados en Desktop trasladados a CSS; fuentes,
colores, escala/DPI, radios, márgenes entre bloques, ancho de burbuja y
adaptación de Android/iOS/Web no están verificados. La referencia es un commit
público, no prueba de versión instalada ni de todos los clientes.
No se promete pixel-perfect, aceptación ni entrega/render real Telegram.

### Artefactos, comandos y QA reproducible

Nueva maqueta:
`C:\Users\bella\.copilot\session-state\ddc74007-85c8-4cf3-89b9-cb640ffb991a\files\telegram-preview-fiel.html`.
Preview oficial alineado, sin sobrescribir el anterior:
`C:\Users\bella\.copilot\session-state\ddc74007-85c8-4cf3-89b9-cb640ffb991a\files\telegram-preview-oficial-fiel.html`.
Capturas **del navegador local, no Telegram**, en esa carpeta:
`preview-390-dark.png` y `preview-1280-light.png`; revisadas visualmente.

```powershell
node scripts/telegram-preview-fiel.mjs --output 'C:\Users\bella\.copilot\session-state\ddc74007-85c8-4cf3-89b9-cb640ffb991a\files\telegram-preview-fiel.html'
node scripts/telegram-preview-oficial.mjs --output 'C:\Users\bella\.copilot\session-state\ddc74007-85c8-4cf3-89b9-cb640ffb991a\files\telegram-preview-oficial-fiel.html'
$env:PREVIEW_BROWSER_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm test -- tests/telegram-preview.test.mjs tests/official-preview.test.mjs tests/telegram-preview-browser.test.mjs tests/rich.test.ts tests/telegram.test.ts tests/notifications.test.ts tests/bundles.test.ts
$env:PREVIEW_BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm test -- tests/telegram-preview-browser.test.mjs
Remove-Item Env:PREVIEW_BROWSER_PATH
```

Resultados: generadores **exit 0**; selector combinado **238 pruebas /
7 archivos aprobados**; repetición navegador Edge **1/1 aprobada**.
`git diff --check` y `node --check` de los tres scripts visuales: **exit 0**.
Baseline anterior a cambios: **36/36** (previews de texto/oficial).
La prueba de navegador es opt-in: sin `PREVIEW_BROWSER_PATH` se omite, no
instala herramientas. Usa perfil temporal vacío y CDP local, sin servidor.
Se probaron ambos previews a **320/390/414/1280 px**, temas claro/oscuro,
con/sin banners en las tres muestras: **24 combinaciones por navegador**.
Árbol semántico completo igual, sin overflow horizontal ni botones cortados,
filas completas/separadas, mark inline y footer sin negrita. Checkbox y
disclosures responden; botones/enlaces conservan la URL y no navegan.
Se verificaron los JSON completos de las tres muestras y los seis intentos
de fallback 400. Las pruebas existentes cubren conservación, agrupación,
Unicode/afiliados, límites exactos UTF-8/bloques/imágenes y multipartes.

Métricas inalteradas: con banner **508/796/1204 bytes**, **8/14/23 bloques**,
una imagen/parte cada muestra; sin banner **428/717/1139 bytes**,
**7/13/22 bloques**. Preview oficial: **381/846 bytes**, una parte cada tarjeta.

Durante el desarrollo, el arnés confundió eventos Chromium
`requestWillBeSent` con tráfico real: se emiten también para imágenes
bloqueadas. Después, `Network.setBlockedURLs` anticipaba el rechazo como
`inspector`. Se sustituyó por interceptación preventiva antes de red y se
comprobó la CSP **independientemente**: intentos de imagen con
`blockedReason=csp`, cero respuestas HTTP(S) y cero solicitudes que alcanzan
la interceptación. La comparación de HTML usa `template` inerte.
No se relajó la CSP ni se descargaron assets para hacer pasar la prueba.

No hubo cambios TypeScript, por lo que no se ejecutó typecheck. Tampoco suite
completa, build, D1/cron, cloud, configuración privada, secretos, OAuth,
mensajes ni deploy. Temporales propios/perfiles eliminados y navegadores
cerrados por su proceso; no quedan servidores de QA. Se preservaron cambios
previos del worktree y las maquetas históricas.
