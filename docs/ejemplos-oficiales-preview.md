# Revisión pública de contratos y preview oficial — 2026-11-01

**Estado local actual:** [caducidad secundaria en footer Rich nativo](#caducidad-secundaria--footer-rich-nativo).
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
  son requeridos nullable en el contrato, aunque el parser admite su ausencia
  como `null` por compatibilidad. Esa tolerancia no cambia el ejemplo.
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
