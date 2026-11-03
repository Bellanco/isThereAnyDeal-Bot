# isThereAnyDeal -> Telegram

Proyecto para recibir en Telegram las ofertas de la Waitlist de IsThereAnyDeal,
sin utilizar el correo como intermediario.

[Revisión pública de ejemplos oficiales y maqueta local (2026-11-01)](docs/ejemplos-oficiales-preview.md):
fixtures contrastados con OpenAPI 2.11.0, sin cuenta ni envíos reales.
Aclara la errata documental del feed: `/bundles/v1`, no `/bundles/v2`;
el cliente ya usa la ruta correcta. No altera el historial de despliegue.

## Estado actual: ajustes de presentación Rich publicados — 2026-11-03

Publicación autorizada en el Worker existente `itad-telegram-bot` con la
configuración local de producción. Versión **`272da3c6-6e39-4c09-ac42-a300de85a141`
al 100 %**, creada `2026-11-03T20:52:38.280082Z`; deployment
`89d005e2-df9f-4318-8125-17db479d34c2` (`2026-11-03T20:52:39.546785Z`).
Incluye quitar el pie decorativo del banner y separar visualmente los juegos
bundle. `npm test` (735/735), typecheck, check offline y dry-run aprobados;
status/list coinciden. El cron `* * * * *` y metadata de bindings/runtime se
conservaron. No se comprobó render ni entrega real.
[Evidencias operativas](docs/I7-operacion.md#22-publicacion-autorizada-de-ajustes-rich-bundles--2026-11-03).

Las entradas fechadas anteriormente a continuación son antecedentes operativos.

**Publicación autorizada de observability — 2026-11-02: completada.**
Tras «Sube el código», se revisaron estado/diff y configuración activa local:
29 tests de `tests/production-config.test.mjs`, `check:prod --activate` y ambos
diff-check aprobados. El dry-run con temporal exclusivo falló (exit 1):
Node rechazó el archivo inexistente pasado con `--env-file` para evitar leer
`.env`. Temporal eliminado y hash de configuración intacto. Se resolvió el
fallo local repitiendo el dry-run sin ese argumento: exit 0, temporal eliminado.
Deploy exit 0, cron conservado. `deployments status` confirma la versión
`aff935c5-b085-49e2-975d-8691e328490f` al 100 %, deployment
`2026-11-02T22:54:08.025238Z`, mensaje
`Enable Workers Logs and invocation logging`.
[Evidencia del intento](docs/I7-operacion.md#21-intento-autorizado-de-publicar-observability--2026-11-02).

**Configuración de observability publicada (2026-11-02):** la copia
local de producción y su plantilla incorporan el bloque mostrado en el panel:
`observability: { logs: { enabled: true, invocation_logs: true }, traces: { enabled: false } }`.
`check:prod` valida estrictamente sus claves y booleanos; omitir el bloque sigue
siendo válido. Desplegado sin modificar cron, vars ni bindings.
El estado de ingesta de logs en el panel no se comprobó en esta operación.

El usuario reautorizó OAuth con `notifications wait_read coll_read` y desplegó
el checkout local el 2026-11-02 en la versión anterior
`613fede8-8bc1-4967-bed8-ffcbb3dc9fbd`. Lecturas posteriores a ese despliegue
confirmaron sesión D1 versión 4,
configuración activa, migraciones al día y un ciclo real sin errores.
No hay partes pendientes/bloqueadas ni flags de parada; ambos baselines siguen
completos según aquella lectura, no repetida tras el nuevo deploy.
Aún falta observar la lectura real de Colección y el próximo mensaje.
No se descargó el código remoto para compararlo byte a byte con el checkout.
La revisión completa posterior corrigió localmente el rechazo de banners con
Unicode mal formado y dos expectativas de tests antiguas: 713 tests aprobados,
typecheck correcto.

Con autorización explícita «Súbela», se publicó el checkout con esa corrección:
**`cfcd14fb-0843-4481-8217-d8484b138e63`, activa al 100 %**,
versión creada **2026-11-02T22:38:34.406885Z**; deployment registrado
**2026-11-02T22:38:35.842788Z**. Mensaje:
`Fix malformed Unicode rejection in safeImageUrl banners`.
`check:prod --activate`, typecheck y dry-run: exit 0; temporal exclusivo
eliminado. La suite completa anterior no se repitió, sin cambios inesperados.
Deploy exit 0; status/list coinciden y metadata de bindings/runtime permanece
idéntica a la versión anterior. Conserva `LIVE_DELIVERY=enabled`, cron
`* * * * *` confirmado por salida de triggers, DB/callback/key version y secretos.
Sin OAuth, migraciones, manipulación de cola, tick forzado ni mensajes de prueba.
No se observó render, entrega o Colección reales en esta operación.
[Evidencias de cierre y límites](docs/I7-operacion.md#20-reautorizacion-del-usuario-y-revision-de-cierre--2026-11-02).

[Auditoría de opcionales, Colección y assets de bundles](docs/ejemplos-oficiales-preview.md#auditoria-de-opcionales-y-coleccion--2026-11-02-no-desplegada):
el render omite decoraciones vacías sin inventar datos; H/N sigue siendo una
señal oficial aunque `historyLow:null`. Se conserva la compatibilidad existente
para metadatos ausentes de bundles, sin endurecer el parser por un cambio visual.
Colección actualmente se marca solo en bundles, no en avisos Waitlist normales.
Banner per-game de bundle autorizado e implementado localmente en el seguimiento
abajo; sin diagnóstico confirmado de producción.

**Banner de bundles — cambios incluidos en el checkout desplegado por el usuario (2026-11-02):**
primer juego con banner seguro que pertenece a Waitlist, en orden de
tiers/juegos; si ningún juego de Waitlist tiene banner seguro → sin imagen
(sin recurrir a otros juegos del bundle).
Assets oficiales per-game `banner600 → banner400 → banner300 → banner145`,
sin construir URLs ni inventar portada del bundle. El banner no lleva una
etiqueta de título. No se filtra ni cambia ningún juego/nivel/enlace.
El mejor banner opcional se guarda en el modelo/snapshot JSON; planes antiguos
sin assets siguen válidos y no se reescriben. Fallback 400 existente elimina
la imagen, manteniendo el contenido. La eliminación del pie y la separación visual entre juegos se publicaron el
2026-11-03; véase el estado y las limitaciones operativas arriba.
[Evidencias, maqueta v4 y diagnóstico de Colección limitado a logs](docs/ejemplos-oficiales-preview.md#banner-per-game-autorizado--2026-11-02-local-no-desplegado).

Seguimiento de esta petición (2026-11-02): ejemplo ficticio 2 con **un juego y
dos tiendas**, banner opcional como ejemplo 1; no se filtran juegos reales.
Mínimo histórico en texto simple (datos numeric/null y deduplicación H/N
intactos). Bundles: tienda solo en «Comprar en …» y ambas marcas con `<mark>`.
Normalización defensiva de IDs al cruzar Colección/Waitlist en el bridge.
Los 15 archivos dirty iniciales se preservaron, sin revertir ni hacer commit.
El usuario desplegó estos cambios junto con la reactivación tras OAuth.
La versión anterior **`9eedc6a6-7599-4350-aaa9-3250e58e1cdb`** es histórica;
las evidencias locales que siguen conservan su contexto anterior al despliegue.
[Diagnóstico Colección, límite EUR y QA local](docs/ejemplos-oficiales-preview.md#seguimiento-local-no-desplegado--2026-11-02).

### Deploy autorizado de ajustes de presentación — 2026-11-02

Cambios Rich locales desplegados en el Worker existente `itad-telegram-bot`
con `wrangler.production.local.jsonc`. La versión **`9eedc6a6-7599-4350-aaa9-3250e58e1cdb`,
al 100%**, creada **2026-11-02 12:35:26.659386 UTC**, con mensaje
`Deploy approved Rich display tweaks`. `deployments status` y el último registro
de `deployments list` coinciden en la versión activa.

Incluye quitar la línea de tienda duplicada bajo el precio, fecha de caducidad
«Hasta el 20 de octubre», mínimo histórico con `<mark>` y marcas de bundles
distintas (`<mark>` para Waitlist, `<code>` para Colección). Check de producción
offline, typecheck, suite completa en serie y dry-run: exit 0. Deploy: exit 0;
metadata informa trigger `deployment`. No se modificaron configuración,
secretos, migraciones, D1 ni recursos; sin OAuth, mensajes manuales ni pruebas
reales ITAD/Telegram. La metadata `deployment` no confirma un tick cron ni
prueba el render o la entrega real. Costes cloud no medidos.
[Comandos y comprobaciones](docs/I7-operacion.md#19-despliegue-autorizado-de-ajustes-rich--2026-11-02).

### Antecedente: deploy autorizado de reglas finales — 2026-11-01

Árbol local completo desplegado en el Worker existente `itad-telegram-bot` con
`wrangler.production.local.jsonc`. Versión **`a5249f58-4e5a-4c78-9df8-1aa26b73c7a6`,
al 100%**, fecha **2026-11-01 11:46:48.755025 UTC**, mensaje
`Deploy final Rich display rules and subtle expiry`. `deployments status` y el
**último** registro de `deployments list` coinciden en versión, fecha, mensaje
y autor (identidad redactada). Sustituye a `a246f649-1b2b-40f8-98f5-f026acc1229b`.

Incluye cero por ciento omitido, niveles sin precio cuando `price:null`, notas
ITAD omitidas visualmente y `<footer>Hasta hh:mm dd-mm-aaaa</footer>`, además
del resto de v4 y tests/preview oficial aprobados. Check offline, typecheck,
suite completa en serie (**663 tests / 18 archivos**) y dry-run producción:
exit 0; temporal propio eliminado. Deploy: exit 0, salida de triggers
**`schedule: * * * * *`**. Conserva `APP_MODE=production`,
`LIVE_DELIVERY=enabled`, `workers_dev=false`, `preview_urls=false`, sin rutas.

No se modificaron config, secretos, dependencias, migraciones ni estado D1;
sin OAuth/refresh manual, envíos manuales, pruebas HTTP o ITAD/Telegram reales,
stage/commit/push. El cron natural preexistente permanece habilitado:
confirmar trigger no acredita un tick funcional, render o entrega.
`bundles: off` sigue siendo el estado conocido por logs del usuario, no una
comprobación nueva; no se cambiaron key/scopes. Coste cloud no cuantificado,
sin recursos nuevos. [Comandos y checklist actual](docs/I7-operacion.md#18-despliegue-autorizado-de-reglas-finales-rich--2026-11-01).

### Antecedente: deploy autorizado Rich v4 — 2026-11-01

Sobre el checkout existente, `check:prod -- --config .\wrangler.production.local.jsonc --activate`,
`npm run typecheck` y `wrangler deploy --dry-run` con la configuración de producción
pasaron. El deploy autorizado terminó con exit **0**. La comprobación final de
`deployments status` y del último registro de `deployments list` coincide:
**`a246f649-1b2b-40f8-98f5-f026acc1229b`, al 100%**, mensaje
`Deploy approved compact Rich v4 design`, creado el 2026-11-01 a las 01:53 UTC.
La discrepancia inicial era una lectura del primer registro del listado:
`024ac491-0fcf-4a67-a34f-cb9bdc71aa8c` corresponde a un cambio de secreto anterior
del 2026-10-31, no al deploy nuevo. No se repitió el deploy ni se hizo rollback.

La configuración local usada conserva `LIVE_DELIVERY=enabled` y cron
`* * * * *`; `deployments status` no expuso el cron, por lo que su estado remoto
posterior a este deploy queda sin verificar. No se esperó un tick. No se consultó
ni modificó D1 ni se aplicaron migraciones nuevas. No se cambiaron secretos,
cuenta/chat, baseline, gates o colas; no se ejecutó OAuth/refresh manual, no se
hizo envío manual, prueba real ITAD/Telegram ni request HTTP público.
`workers_dev=false`, `preview_urls=false` y la ausencia de rutas se conservaron
en la configuración inspeccionada: no se publicó el receptor HTTP mock.
[Comandos, versiones y checklist](docs/I7-operacion.md#17-intento-autorizado-de-despliegue-rich-v4--2026-11-01).

La operación anterior había aplicado 0005 y listado la versión
`02994b02-61e2-4a3a-a96d-18bf1fc70525`; queda como antecedente, no prueba de salud
actual. Render real, tick funcional, scopes/API key,
cuotas y continuidad funcional siguen pendientes. Las referencias a “no
ejecutado en I7” describen fases históricas.

### Diseño preparado

- Avisos oficiales OAuth cada **5 min**, drenaje cada **1 min**. Rich HTML mediante
  `sendRichMessage`: banner opcional, título, precio actual y descuento juntos,
  tienda, cupón/caducidad y datos secundarios cuando existen. Sin precio
  habitual, mínimo de tienda ni precio anterior en el HTML; sí conserva el
  mínimo histórico del juego con esa etiqueta, sin presentarlo como mínimo de
  tres meses. Los metadatos de tipo/adultos, DRM, plataformas, publicación y
  señales de mínimo de tienda se omiten por decisión del usuario.
  Sin cabecera resumen ni pie técnico; caducidad en footer nativo sin negrita
  y `parte X/Y` solo en mensajes multipartes.
  Sin emojis ni tablas.
- Bundles: feed oficial `/bundles/v1`, país **ES**, `mature=true`, cada **60 min**.
  No hay reglas oficiales de notificación de bundles: es un cruce separado del
  feed con la Waitlist, no una reinterpretación de los avisos oficiales.
  Se preservan **todos los juegos y niveles**, caducidad y enlaces;
  `bundle.note` permanece en datos/validación/persistencia, no en las tarjetas.
  marcas «en tu lista de deseos» y «en tu Colección». Cada juego enlaza a ITAD por su slug;
  los bloques de juegos se separan con una línea horizontal.
  Sin cabecera resumen ni pie con ID/publicación: de las fechas del bundle
  solo se muestra caducidad en footer nativo sin negrita, también en ofertas Waitlist.
- `ITAD_API_KEY` es un secreto **opcional**; sin key, `bundles: off`.
  Una sesión antigua con `notifications` sigue procesando avisos, sin banners.
  Reautorizar para `notifications wait_read coll_read`: `wait_read` permite
  banners y cruce; `coll_read` permite marcas de Colección (best effort).
- Persistencia Rich y baseline/agenda de bundles en
  [0005_rich_bundles.sql](migrations/0005_rich_bundles.sql). Planes antiguos de
  texto siguen entregándose como texto; IDs/recibos/baseline anteriores se conservan.
  Rich se divide sin truncar por presupuesto conservador de 30.000 bytes UTF-8,
  400 bloques y 40 imágenes (límites oficiales: 32.768, 500 y 50).

### Historial: ajustes visuales Rich desplegados — 2026-11-02

El formatter quita la línea de tienda debajo del precio de cada oferta; el
nombre sigue en el botón «Comprar en …». La caducidad de ofertas y bundles se
muestra como «Hasta el 20 de octubre», sin hora ni año, usando la fecha local
`Europe/Madrid`. El mínimo histórico se resalta con `<mark>`, distinto del cupón
`<code>`; en bundles, «En tu lista de deseos» usa `<mark>` y «En tu Colección»
`<code>`.

Son cambios solo de presentación: no alteran datos recibidos, precios, selección,
agrupación, enlaces ni persistencia. El despliegue está verificado; el render
real en Telegram y la entrega de una oferta siguen pendientes de comprobación.

### Diseño Rich — tres ejemplos ficticios para revisar en móvil

El formatter v4 está incluido en la versión activa verificada del deploy autorizado.
La jerarquía es banner/título → precio actual con descuento → cupón/caducidad y
secundarios → botones. El nombre de tienda se conserva en el botón de compra.
Se quitan visualmente «Precio habitual», «Mínimo en
tienda» y «Precio anterior»; permanece `game.historyLow` como «Mínimo histórico».
El payload validado y persistido no cambia: esos campos originales no se borran
ni se alteran. No se añade comparación de tres meses, endpoint ni sondeo; queda
pendiente hasta que se decida una fuente de datos. No se renombra el mínimo
histórico como mínimo trimestral.

Las fechas de caducidad Rich muestran día y mes en texto, calculados en
`Europe/Madrid` (península y Baleares); se omiten hora y año. La publicación se
omite. No se muestra `tg-time` que Telegram relocalice según lector/idioma. Los
ISO de contratos y el texto legado no se modifican. Se omiten DLC/paquete y
metadatos de contenido adulto junto con DRM,
plataformas y publicación. La señal H/N se muestra exactamente como «Mínimo
histórico»; si `historyLow` existe, su comparativa numérica aparece una sola vez
por juego y sustituye la etiqueta duplicada en la primera oferta. Si es `null`,
H/N muestra solo la etiqueta. No se infiere H/N comparando precios; también se
omite la señal S (mínimo de tienda).

En bundles cada juego enlazado ocupa su propia línea y las marcas de lista de
deseos/Colección van en la siguiente cuando existan, sin repetir el tipo de juego.
Una línea horizontal separa cada bloque de juego para que la marca no se confunda
con el título siguiente. `<mark>` se usa para descuentos y, en el formatter local
actual, también para las marcas de Waitlist y Colección; su ancho sigue el texto
de la etiqueta, sin extenderse por la línea. El mínimo histórico vuelve a texto
simple.
Se preservan todos los juegos, niveles y enlaces. La decisión anterior de mostrar
notas oficiales queda reemplazada explícitamente por el ajuste local aprobado:
**ninguna nota ITAD se dibuja en Rich bundles**, sin filtrar por su texto.
`bundle.note` se conserva intacto en payload, validadores y persistencia;
los fixtures oficiales no cambian.
Entre las fechas del bundle solo aparece caducidad; sin cabecera resumen ni pie
técnico salvo `parte X/Y`. Sin emojis, tablas ni contenido plegado.

Compra usa `style="success"` e ITAD `style="primary"`, **cada botón en su propia
fila**, compra primero. Se conserva el enlace ITAD por juego (no se añade uno
por cada tienda), y todos los enlaces/URLs afiliadas sin normalizar.
Los colores verde/azul son dependientes del tema, no colores CSS enviados a
Telegram. Fuente: [Rich HTML style](https://core.telegram.org/bots/api#rich-html-style)
y [RichMessageButton](https://core.telegram.org/bots/api#richmessagebutton).
La lista oficial consultada no enumera `<small>`: se usan `p`, títulos, `mark`
para descuentos y, en el formatter local, para las marcas de Waitlist/Colección,
`hr` y filas/botones Rich documentados. No se usa
`tg-time` porque mostraría fechas localizadas por Telegram.

### Historial: ajustes Rich incluidos en el deploy del 2026-11-01

- `cut=0`: precio exacto, sin porcentaje, `mark` ni ` · ` sobrante;
  `cut>0` conserva el formato anterior. Un precio cero sigue siendo numérico,
  no se sustituye por «Gratis».
- `historyLow=null`: sin comparativa ni etiqueta, salvo H/N oficial («Mínimo
  histórico»). Si se conoce: `Mínimo histórico: X`, incluso cuando el precio
  actual es mayor; no implica que el actual sea mínimo ni se infiere H/N.
  Se mantiene la deduplicación de la primera H/N con histórico conocido y las
  señales de otras ofertas; S sigue omitida.
- Juego sin ofertas: título y enlace ITAD, sin precio inventado; se conserva
  el histórico oficial numérico si existe. Nivel con `price:null`: solo
  `Nivel N` y ` · addon` si corresponde, sin texto de precio.
- Moneda/importe oficiales con `Intl es-ES currency` (p. ej. `87,96 US$`),
  sin convertir a EUR por `country=ES`. Cupón/caducidad null se omiten.
  Banner ausente o inseguro mantiene el HTML sin imagen; ante 400 con imagen
  se conserva el fallback real existente, sin otra arquitectura.
- Se preservan limpieza v4, notas reales, orden, juegos/ofertas/niveles y
  URLs exactas (notas solo en datos), con `parte X/Y` cuando haga falta. No se añade regla de
  caducadas, Gratis, selección/filtrado ni histórico de tres meses.
- Caducidad de ofertas y bundles en una línea propia:
  `<footer>Hasta hh:mm dd-mm-aaaa</footer>`, sin negrita, con el helper
  compartido `expiryFooter` y `when` actual
  (`Europe/Madrid`); si es `null`, no aparece línea ni etiqueta.
  Ninguna nota ITAD en tarjetas de bundles; las fuentes oficiales íntegras
  siguen disponibles fuera de las tarjetas del preview oficial.

El contrato público actual admite [`footer`](https://core.telegram.org/bots/api#rich-html-style)
como [bloque Rich independiente](https://core.telegram.org/bots/api#inputrichblockfooter).
No exige que sea el último bloque ni documenta tamaño/color exactos. Se elige
como información secundaria sin negrita; la maqueta lo representa menor, **no
garantiza ese tamaño en Telegram**. No se envían `small`, `span` ni CSS.
`sendRichMessage`, `html`/`skip_entity_detection`, imágenes independientes y
botones success/primary contrastados con la fuente oficial; sin incompatibilidad
que justifique cambiar el cliente. Aceptación y render reales **PENDIENTES de
tu ejecución**; el ajuste está desplegado, sin envíos de prueba.
[Evidencia y QA](docs/ejemplos-oficiales-preview.md#caducidad-secundaria--footer-rich-nativo).

QA y preview oficial offline actualizado:
[reglas, comandos y resultados](docs/ejemplos-oficiales-preview.md#ajustes-aprobados-del-formatter--seguimiento-local).
Estos ajustes ya están en la versión activa indicada arriba; no acreditan
render/entrega reales.

Preview v4 autocontenido de esta sesión:
`C:\Users\bella\.copilot\session-state\f5de483d-d716-4c23-bbf1-65bbeb7ce95e\files\telegram-preview-v4.html`.
Incluye estos tres ejemplos producidos por los formatters reales, vista
mobile-first de ~390 px, sin red ni assets externos. Solo el banner es un
placeholder local explícito; se declara «Aproximación: Telegram adapta colores
y tipografía a tu tema». Verde/azul son aproximaciones de `success`/`primary`,
no estilos CSS enviados a Telegram. Las fechas son texto fijo Madrid. No es
captura ni prueba de render Telegram. Se conservan sin cambios los previews v2
y v3. El generador visual fue temporal, no es un nuevo comando del proyecto.

Medición local del formatter en este checkout (cambios visuales aún no
desplegados; no acredita render ni entrega reales): ejemplos de una parte
**508 / 796 / 1204 bytes** y **8 / 14 / 23 bloques**, con imágenes **1 / 1 / 1**, usando
`utf8Length` y `countBlocks` reales (incluyen footer).
Sin banners: **428 / 717 / 1139 bytes**, **7 / 13 / 22 bloques**.
Las cifras anteriores del tercer ejemplo, **1194 / 21** con banner y
**1129 / 20** sin banner, corresponden al formatter local previo a añadir los
separadores `<hr/>` entre juegos; no son las métricas de este checkout.
La muestra original de **595 juegos × 2 ofertas**
da **17 partes** (antes 20), sin perder juegos, ofertas ni enlaces. La simulación
ficticia usa esos mismos 595 juegos con/sin banners en los índices probados.
No se cambian presupuestos, selección ITAD ni límites operativos.
[Mediciones y escenarios QA](docs/I5.md#medicion-local-simulacion--d1-de-pruebas-y-d1-local-de-wrangler).

```powershell
npm run preview:telegram -- --dry-run
npm run preview:telegram -- --dry-run --no-banner
npm test -- tests/telegram-preview.test.mjs
```

`--dry-run` imprime tres HTML Rich usando validadores/formatters reales compilados
en un temporal propio: (1) banner, oferta y mínimo histórico simple,
(2) **un juego**, dos tiendas, cupón/caducidad y banner opcional,
(3) bundle de tres niveles y ambas marcas con `<mark>`.
No pide tokens, lee configuración privada, accede a cloud ni hace red.
HTML en un navegador **no es el render exacto de Telegram**.
Los tres ejemplos usan el diseño Rich sin cabeceras resumen ni pies técnicos,
con la nota ficticia del bundle ausente (`note: null`). Todas las notas ITAD se
omiten visualmente; la nota real permanece en los datos internos.
El último ajuste está validado localmente, **NO desplegado**; el preview sigue siendo
offline, no una prueba de Telegram real.

Solo el usuario, en un terminal privado y tras decidir autorizar esos tres envíos:

```powershell
npm run preview:telegram -- --live
# Alternativa sin dependencia de imagen:
npm run preview:telegram -- --live --no-banner
```

Exige modo explícito; rechaza opciones de tokens/chat/configuración. Token e ID
de chat privado se introducen con entrada oculta TTY, nunca por argumentos/env/
archivo; confirmación exacta `ENVIAR 3 EJEMPLOS` antes de enviar. Se validan
credenciales y recibos, espera ~1 s entre mensajes y se detiene al primer fallo,
incluido 429 (informa espera mínima). No persiste ni deduplica estos ejemplos:
relanzar repite los confirmados; un timeout/recibo inválido pudo llegar también.
Revisar el chat antes de repetir. No hay reintentos ambiguos automáticos; el
cliente real solo hace fallback sin imágenes ante 400 con banner; otro 400 detiene.
Estados/errores sanitizados, sin URL con token, chat ni respuestas externas.
El temporal se elimina en `finally`; fallo de limpieza es explícito y exit no cero,
sin cambiar el resultado de envíos ya confirmados. Los secretos quedan solo en
memoria (JavaScript no garantiza borrado físico); evitar transcript/proxies de logs.

Títulos/tiendas son ficticios y enlaces de compra `example.com`. Slugs ficticios
generan enlaces ITAD que **pueden no existir**. Banner placeholder conocido HTTP
200: `https://placehold.co/600x280/2b3a55/ffffff/png?text=Nebula+Drifters`;
depende de un tercero y de la descarga de Telegram, no se ha vuelto a consultar.
`--no-banner` elimina esa dependencia. No se han enviado estos ejemplos realmente.

### Hecho / pendiente

**Hecho local:** implementación Rich/bundles, migración 0005, simulaciones,
script y guía de actualización. [I5](docs/I5.md) explica medición y logs;
[I7, actualización](docs/I7-operacion.md#actualización-rich-y-bundles-sobre-producción-existente)
describe permisos paso a paso. Evidencias de este cierre se enumeran al final de I7.

**Pendiente externo:** confirmar cron remoto, render móvil real,
API key y reautorización de scopes, moneda real con country ES, CPU/cuotas Workers
Free con Rich/bundles, continuidad/recibos reales y aviso natural nuevo con correo
desactivado. No hay garantía de que desactivar
correo conserve la generación de avisos. No hay entrega exactamente una vez.
Mismo ID de bundle relanzado no es nuevo; tras una parada larga solo se revisan
los **50 bundles recientes**, y pertenencia Waitlist se evalúa al detectar,
sin retroactividad. 400 persistente bloquea parte; fallos ambiguos requieren
revisión manual antes de recuperar.

## I7: referencia histórica de preparación operativa

[Guia paso a paso I8–I9 y recuperacion](docs/I7-operacion.md).
[Plantilla production](wrangler.production.jsonc) separada y apagada:
`LIVE_DELIVERY=disabled`, sin cron ni URL publica, D1 con placeholders.
`wrangler.jsonc` conserva el mock. `npm run dry-run:prod` solo empaqueta;
`npm run check:prod -- --config wrangler.production.local.jsonc` rechaza
placeholders antes de operaciones cloud. Secretos solo por entrada local/
Workers secret, nunca archivos versionados.

`npm run oauth:operator` prepara provisioning/reautorizacion PKCE local y
operaciones manuales exactas para partes `unverified`; necesita `--live`,
consentimiento interactivo y acceso a la D1 seleccionada. No se ha ejecutado:
no se han creado cuentas/recursos, migrado D1 remota, iniciado OAuth live,
alterado la D1 ni enviado mensajes en I7. I9 sigue bloqueado por capacidad
cloud pendiente y permisos.

## Estado

### Alcance acordado: notificaciones oficiales mediante OAuth

La arquitectura acordada sustituye el webhook como entrada principal por consultas
OAuth de las notificaciones oficiales de ITAD cada cinco minutos:
`GET /notifications/v1` y `GET /notifications/waitlist/v1?id=...`.
No es una consulta periodica de precios ni reproduce filtros por su cuenta.
La primera sincronizacion registrara los avisos existentes sin enviarlos;
solo los IDs nuevos posteriores se procesaran hacia el chat configurado.

ITAD seguira decidiendo la frecuencia de generacion y los juegos/ofertas que
cumplen los ajustes del usuario. El bot no anadira filtros ni juegos ajenos al
detalle oficial. Cada notificacion conservara todos sus juegos/ofertas y su
agrupacion: un mensaje si cabe o partes identificadas del mismo aviso por el
limite de Telegram. I1 implementa un formatter independiente por notificacion;
el formato mock por oferta se conserva sin cambios.
Consultar cada cinco minutos introduce demora; no promete el instante del correo.
Desde I6 el tick local es cada minuto: las consultas a ITAD siguen limitadas a
una cada cinco minutos por una compuerta durable en D1 y cada minuto solo se
drenan las partes pendientes (3 por tick, provisional).

Pruebas reales autorizadas confirmaron acceso `notifications`, lectura de 23
avisos/detalle y un refresh OAuth exitoso que roto ambos tokens y permitio otro
GET. La prueba I3 fue puntual; no verificó continuidad durante días. No quedaron
tokens de esa prueba; la sesión de producción posterior está cifrada en D1.
Sigue pendiente observar un aviso nuevo con el correo
desactivado y comprobar su entrega integrada.
Los contratos de notificaciones no documentan retencion/paginacion suficiente
para prometer recuperacion tras ausencias indefinidas.

I1: contratos, validacion y formato agrupado implementados y probados sin red.
I2: cliente GET y OAuth/PKCE/refresh implementados con transporte obligatorio
inyectado y pruebas en memoria. Ver [contratos, pruebas y limites I2](docs/I2.md).
I3: refresh OAuth real probado con autorizacion; no quedan tokens guardados.
I4: adaptador D1, migracion, baseline no repetible, avisos nuevos pendientes,
planes completos/partes, confirmaciones, reservas CAS y sobre AES-GCM
implementados y probados contra D1 local. Ver mas abajo.
I6 (correcciones, solo simulacion y D1 local): fallo cerrado si no se pueden
leer los indicadores, reserva durable de cada consulta de detalle (migracion
0003) y listas DRM/plataformas oficiales sin el tope mock. Ver [I5](docs/I5.md).
I6 (drenaje separado, solo simulacion y D1 local): `scheduled` usa `runTick`;
el cron LOCAL es cada minuto, la consulta OAuth/ITAD solo ocurre cuando la
compuerta durable `poll_gate` (migracion 0004, propietario/version/caducidad
120 s con CAS) esta vencida (cada 5 min, respetando 429) y la entrega corre en
cada tick. Históricamente, el formato anterior drenaba 20 partes en 7 ticks;
con los ajustes Rich desplegados el 2026-11-02, la muestra de 595 juegos
produce 17 partes y se drena en 6 ticks. Ver
[I5](docs/I5.md#i6-tick-cada-minuto-y-compuerta-durable-de-consultas-itad).
La configuracion principal sigue siendo mock, sin cron.
I5: ciclo `scheduled` cada cinco minutos que integra refresh OAuth con el sobre
D1, consulta, baseline, detalle persistido, cliente Telegram `sendMessage` con
validacion de recibo, throttle global durable, reservas y recibos. Solo se ha
ejecutado con simulaciones (Vitest) y con D1 local real + simulacion en
`wrangler dev --test-scheduled`. Ver [I5](docs/I5.md). No hay binding D1 ni cron
en la configuracion mock principal y no se han creado recursos remotos.
Los comandos de ejecucion siguientes corresponden a la base mock de webhook.
Las secciones de webhook se conservan
como referencia de esa base, no como arquitectura elegida de produccion.
La falta de autenticacion documentada de los POST ITAD no bloquea esta nueva ruta,
que consulta la API oficial por HTTPS y OAuth. No publicar el receptor mock.
En aquella fase local no se desplegó ni envió; el estado actual figura arriba.

Base ejecutable local. El flujo mock heredado y el cliente OAuth de aplicacion
siguen sin llamadas externas; D1 se prueba solo mediante un Worker temporal de
QA local. Decisiones confirmadas:
TypeScript estricto, HTTP nativo de Cloudflare Workers sin framework, Wrangler
para desarrollo local, Vitest para pruebas y Cloudflare D1 para persistencia.
La base mock no tiene bindings cloud; producción anterior tiene D1 según evidencia del usuario.

El cliente Telegram y el modo `production` existen pero fallan cerrados sin
`LIVE_DELIVERY=enabled` y secretos; nunca se ejecutaron contra servicios
reales en esa fase. La CLI OAuth/operador existe; la recuperación posterior fue
aportada por el usuario. No hay frontend,
correo, sondeo de precios ni despliegue. Los mocks no realizan llamadas
externas. Node 24.14.1 y npm 11.11.0 se usaron
para verificar esta base; no es necesario cambiar el runtime instalado.

## Ejecutar y comprobar

Desde la carpeta del proyecto:

```powershell
npm install
npm test
npm run test:d1
npm run test:cron
npm run typecheck
npm run dry-run
npm run dev
```

El lockfile fija las dependencias; QA puede usar `npm ci` para reproducirlas.
Solo hay tres dependencias directas, todas de desarrollo: TypeScript, Vitest y
Wrangler. No hay dependencias de produccion. `test` termina, no deja watchers.
`dry-run` empaqueta en `dist/` sin desplegar, iniciar sesion ni crear recursos.
No existe script de despliegue. `dev` escucha solo en `127.0.0.1:8787` por
defecto; detener con Ctrl+C. Si el puerto esta ocupado:
`npm run dev -- --port 8788`.

`npm run test:cron` inicia `wrangler dev --test-scheduled` con
[wrangler.local-integration.jsonc](wrangler.local-integration.jsonc), D1 local
real en carpeta temporal y simulacion en memoria de ITAD/OAuth/Telegram; dispara
`/__scheduled?cron=*+*+*+*+*` en loopback (cron local cada minuto; fuerza la
compuerta solo en la D1 temporal) y muestra el progreso por tick de un aviso de
17 partes con el formatter local. `npm run dev:cron` y `npm run db:local:migrate`
permiten repetirlo a mano (ver [I5](docs/I5.md)).

`npm run test:d1` aplica [migrations/0001_i4_storage.sql](migrations/0001_i4_storage.sql),
[migrations/0002_i5_delivery.sql](migrations/0002_i5_delivery.sql),
[migrations/0003_i6_detail_claims.sql](migrations/0003_i6_detail_claims.sql) y
[migrations/0004_i6_poll_gate.sql](migrations/0004_i6_poll_gate.sql) y
[migrations/0005_rich_bundles.sql](migrations/0005_rich_bundles.sql)
con `wrangler d1 execute --local` y ejecuta el adaptador contra D1 local real
mediante una configuracion/Worker exclusivos de pruebas. Usa una carpeta temporal
para persistencia, la elimina al terminar y no configura `--remote`, secretos ni
recursos cloud. El proceso Wrangler usa un HOME temporal, sin heredar tokens
Cloudflare; el Worker QA escucha solo en loopback. `npm test` sigue siendo
la suite unitaria sin servicios externos; `test:d1` usa solo HTTP local al
simulador D1 de Wrangler.

Ejemplo PowerShell contra el simulador iniciado localmente:

```powershell
$headers = @{
  'ITAD-Hook-ID' = '497f6eca-6276-4993-bfeb-53cbbbba6f08'
  'ITAD-Event' = 'notification-waitlist'
  'X-Mock-Receiver-Key' = 'local-mock-only'
}
$body = Get-Content -Raw tests/fixtures/notification-waitlist.json
Invoke-RestMethod -Uri http://127.0.0.1:8787/webhooks/itad -Method Post -Headers $headers -UserAgent 'ITAD-Webhooks/1.0 (+https://isthereanydeal.com)' -ContentType 'application/json' -Body $body
$headers['ITAD-Event'] = 'ping'
Invoke-RestMethod -Uri http://127.0.0.1:8787/webhooks/itad -Method Post -Headers $headers -UserAgent 'ITAD-Webhooks/1.0 (+https://isthereanydeal.com)' -ContentType 'application/json' -Body '"pong"'
```

La oferta responde `mode: mock`, `sent: 1`, `skipped: 0`; repetirla en el mismo
proceso responde `sent: 0`, `skipped: 1`. Son entregas simuladas, NO mensajes
reales. `ping` devuelve `pong: true` sin tocar entrega ni almacenamiento.

### Configuracion mock y seguridad

Los bindings del Worker mock principal estan en [wrangler.jsonc](wrangler.jsonc):

| Variable | Valor local | Uso |
| --- | --- | --- |
| `APP_MODE` | `mock` | Cualquier otro modo falla con 503. |
| `MOCK_CHAT_ID` | `mock:local` | Destino ficticio, debe empezar por `mock:`. |
| `MOCK_RECEIVER_KEY` | `local-mock-only` | Barrera local, NO secreto ni firma ITAD. |
| `MOCK_FAILURE` | `none` | `network`, `http`, `rejected`, `rate-limit`, `invalid-response`. |
| `MOCK_FAIL_AT` | `1` | Numero de intento de envio que falla una sola vez. |

La cabecera propia `X-Mock-Receiver-Key` solo protege contra solicitudes locales
accidentales. Su valor de ejemplo es publico: NO autentica a IsThereAnyDeal y
NO debe usarse en produccion ni como secreto real. No registrar este receptor
como webhook publico. Los IDs, el User-Agent y `ITAD-Event` se validan como
estructura, nunca como autenticacion. No se ha encontrado firma documentada
en los contratos consultados. No se usa un secreto en la URL.

La configuracion falla cerrada ante bindings desconocidos, incluyendo
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` u otras variables live, en lugar de
aceptarlos silenciosamente. No introducir valores reales en esta fase. El
destino nunca procede del payload. El codigo no registra cuerpos, tokens,
cabeceras, enlaces ni errores externos; las respuestas de error son genericas.
Wrangler puede mostrar bindings locales: todos los valores versionados son
ficticios. Los archivos `.dev.vars*` y `.env*` estan ignorados para fases futuras.
El binding D1 ficticio de [wrangler.d1-test.jsonc](wrangler.d1-test.jsonc) solo
se usa en pruebas locales con `npm run test:d1`; no forma parte del Worker mock.

### Capas

- [src/index.ts](src/index.ts): composicion Workers, configuracion mock estricta
  y `scheduled` (`mock` sin efecto, `local-integration`, `production` cerrado).
- [src/bridge.ts](src/bridge.ts): ciclo cron I5 y `PROVISIONAL_LIMITS`.
- [src/telegram.ts](src/telegram.ts): `sendMessage` con transporte inyectado,
  timeout de 10s, validacion de recibo y clasificacion de errores.
- [src/local-simulation.ts](src/local-simulation.ts): simulacion local de
  ITAD/OAuth/Telegram; nunca usa `fetch` real.
- [src/http.ts](src/http.ts): ruta POST, cabeceras, JSON UTF-8 y limite de bytes.
- [src/validation.ts](src/validation.ts): contratos de juegos, ofertas, ping y
  lista/detalle de notificaciones.
- [src/domain.ts](src/domain.ts): tipos y formato de texto plano, sin `parse_mode`.
- [src/notifications.ts](src/notifications.ts): formato por aviso y preparacion
  completa del lote de detalles, sin envio ni filtros (I1).
- [src/itad-http.ts](src/itad-http.ts): transporte inyectado, timeout de 10s y
  errores sanitizados, sin `fetch` por defecto (I2).
- [src/itad-client.ts](src/itad-client.ts): GET lista/detalle con validadores I1.
- [src/oauth.ts](src/oauth.ts): PKCE S256/state, grants estandar y sesion en
  memoria; instrumento callback loopback sin listener ni integracion Workers.
- [src/d1-storage.ts](src/d1-storage.ts): adaptador D1 aislado para baseline,
  IDs nuevos y detalle/partes durables, reservas CAS de 120s, recibos confirmados
  y almacenamiento OAuth cifrado autenticado. No hace consultas ni entregas.
- [src/notify.ts](src/notify.ts): plan, deduplicacion y confirmacion de cada mensaje.
- [src/ports.ts](src/ports.ts): contratos de entrega y almacenamiento.
- [src/mocks.ts](src/mocks.ts): entrega ficticia y almacenamiento en memoria.
- [tests/bridge.test.ts](tests/bridge.test.ts): pruebas sin red y escenarios QA.
- [tests/notifications.test.ts](tests/notifications.test.ts): contratos oficiales
  de lista/detalle, agrupacion, conservacion y limites del formato I1.
- [tests/d1-worker.ts](tests/d1-worker.ts) y
  [tests/d1.integration.mjs](tests/d1.integration.mjs): arnes de pruebas local,
  no incluido en la configuracion ni en el Worker mock principal. Ver
  [detalles I4](docs/I4.md).

La fixture de ofertas y la de ping en [tests/fixtures/notification-waitlist.json](tests/fixtures/notification-waitlist.json)
y [tests/fixtures/ping.json](tests/fixtures/ping.json) reproducen los ejemplos
oficiales enlazados en Fuentes; los casos derivados se construyen en las pruebas.
Las fixtures [notifications-list.json](tests/fixtures/notifications-list.json) y
[notifications-waitlist-detail.json](tests/fixtures/notifications-waitlist-detail.json)
reproducen los ejemplos oficiales de las dos consultas, no datos de una cuenta.

### Contratos y formato I1

`parseNotificationList` recibe el array oficial: cada entrada requiere `id`
(UUID), `type: "waitlist"`, `title`, `timestamp` y `read`. `read` es fecha ISO
o `null`, nunca booleano; la propiedad debe existir. La lista no contiene juegos.
`parseWaitlistNotification` valida el detalle: `id`, `timestamp`, `read`, `games`;
no inventa `title` o `type` del aviso. Reutiliza `Game`, `Deal` y sus validadores.
Las propiedades desconocidas se ignoran; destino y credenciales no se extraen.
No filtra avisos leidos ni deduce ofertas del titulo resumido de la lista.

`formatNotification` conserva orden, juegos y ofertas del detalle en un solo
mensaje si cabe. Incluye título de juego, precio/moneda/descuento, enlace intacto
y, cuando existen, cupón, caducidad y señales H/N. El nombre de tienda aparece
en el botón de compra, no como línea duplicada. En el Rich actual no muestra
`regular`, `storeLow`, `lastPrice`, DRM, plataformas, publicación ni señal S; sí muestra
`historyLow` como «Mínimo histórico». La exclusión es solo visual: no cambia
validación, payload original ni datos persistidos. Solo muestra fechas de
caducidad, no fecha/UUID/estado leído del aviso ni cabecera resumen. No calcula el
mínimo de tres meses. Ahora es Rich HTML, no copia garantizada del correo ni del render móvil.
Cada parte lleva solo el contador `parte N/M` si hay varias y respeta
el presupuesto Rich descrito arriba. Texto plano de 4096 unidades UTF-16 sigue
en el mock y los planes históricos.
No rompe pares Unicode ni divide/trunca/normaliza enlaces, incluidos afiliados.
Una URL que no cabe con su contenido y marcador de parte se rechaza antes de cualquier envio.

`prepareNotificationBatch` valida todos los detalles antes de formatearlos y
devuelve `{ notification, parts }` por aviso. El futuro cliente debe preparar
el lote entero antes de enviar: un error en cualquier detalle o URL rechaza
la preparacion completa, no devuelve una seleccion parcial. No mezcla ni
deduplica avisos, tampoco los identicos. No implementa entrega ni atomicidad.
El nuevo detalle no impone los topes mock de 100 juegos/200 ofertas, 100
entradas DRM/plataformas ni 500 mensajes: el esquema oficial (`obj.drm-list`,
`obj.platform-list`) no declara maximos (I6). Se conservan todas las entradas o
se rechaza el detalle completo si alguna es invalida; nunca hay una seleccion
parcial ni exito silencioso. La respuesta oficial no tiene tope de bytes propio;
la cota operativa es la memoria/CPU del Worker y un fallo deja el detalle
pendiente y visible. Limites de transporte/capacidad de produccion quedan
pendientes; no se promete recuperar ausencias indefinidas.

### Limites y errores

Politicas del receptor mock, no supuestos limites de ITAD: 256 KiB por cuerpo, incluso
en streaming o con Content-Length falso; hasta 100 juegos, 200 ofertas totales,
100 entradas por lista DRM/plataformas y 500 mensajes por solicitud. Los campos
utilizados requieren tipos validos; textos descriptivos no vacios y Unicode
bien formado. Las propiedades desconocidas se ignoran, no se usan como ajustes.
Los campos requeridos anulables deben existir; `null` no equivale a omision.

En el mock cada oferta genera uno o varios mensajes de texto plano de hasta 4096 unidades
UTF-16, cota conservadora para el limite de Telegram de 4096 caracteres. Los
pares Unicode no se parten. Los enlaces HTTP(S) se conservan completos, sin
normalizacion ni eliminacion de afiliados; nunca se consultan. Un enlace que
no quepa solo se rechaza, no se trunca ni divide. Todo el lote se valida y
formatea antes del primer envio. No hay transaccion atomica de entrega del lote.

HTTP: 200 tras terminar correctamente o recibir ping, 400 entrada invalida,
401 sin barrera mock, 404 ruta desconocida, 405 metodo incorrecto, 413 cuerpo
excesivo, 415 tipo incorrecto y 503 entrega no confirmada/configuracion invalida.
Ante `rate-limit`, el mock devuelve `Retry-After: 2`; ante reserva ocupada,
`Retry-After: 1`. No hay reintento automatico ni espera en el Worker. El operador
reenvia el lote; no se supone que ITAD lo haga. Los fallos frecuentes pueden
deshabilitar el webhook segun la documentacion oficial.

### Deduplicacion y fallos parciales

La clave SHA-256 incluye hook, juego, tienda, timestamp recibido, enlace,
destino, textos completos y parte del mensaje. No se inventa un identificador
unico de entrega ITAD ni se usa `ITAD-Event-ID` para deduplicar/autenticar.
El resumen general menciona esa cabecera, pero los contratos de los dos eventos
especifican `ITAD-Event`; se sigue el contrato especifico.

En un mismo almacenamiento se reserva cada mensaje antes de enviarlo. Las
solicitudes concurrentes que encuentren esa reserva reciben 503. Solo se marca
confirmado despues de obtener un `message_id` valido de la entrega simulada;
los errores liberan la reserva. Si falla la segunda oferta o parte de un texto,
el reenvio del lote omite las partes confirmadas y vuelve a intentar las demas.
Un cambio en los textos/timestamp/enlace puede producir una nueva entrega.
Dos avisos distintos con contenido identico se pueden colapsar.

Estas limitaciones corresponden solo al receptor webhook mock y su `MemoryStore`;
el adaptador D1 I4 esta aislado y aun no esta conectado a este flujo.
La memoria es VOLATIL y limitada a 10.000 registros por instancia; al llenarse
falla con 503 sin expulsar confirmaciones. Reiniciar, recargar, cambiar la
configuracion o usar otro isolate pierde la deduplicacion. No hay persistencia
de pendientes ni recuperacion tras caidas. Una solicitud colgada conserva la
reserva hasta reiniciar. Esta fase NO cumple el criterio de persistencia tras
reinicios. Nunca se promete entrega exactamente una vez: una confirmacion
perdida despues del envio puede provocar duplicados al reintentar.

### QA reproducible

`npm test` bloquea `fetch` global y exige que no se invoque; no usa cuentas ni
servicios externos. Cubre ejemplos oficiales, ping, lotes, entradas invalidas,
proteccion local, destino fijo, enlaces, Unicode, limites, repeticiones,
concurrencia, reinicio y reintentos tras fallos parciales. I1 anade 56 pruebas
focalizadas, incluidas 101 juegos/303 ofertas, limites exactos y contadores de
partes de varias cifras. Comandos enfocados:

```powershell
npm test -- -t 'recovers a partial'
npm test -- -t 'concurrent'
npm test -- -t 'fails closed'
npm test -- tests/notifications.test.ts
npm run typecheck
npm run dry-run
```

Para simular un fallo manual al primer envio, iniciar una instancia nueva con:
`npm run dev -- --var MOCK_FAILURE:rate-limit --var MOCK_FAIL_AT:1`.
La primera oferta recibe 503 y Retry-After; el siguiente intento se confirma.
Los cinco tipos de fallo se simulan sin sockets ni llamadas a Telegram. No hay
adaptador HTTP real ni se ha probado el comportamiento real de esos servicios.

### Pendiente después de I5 (histórico; actualización actual arriba)

I1-I5 estan implementados en el alcance descrito, solo con simulaciones y D1
local. Siguientes pasos:

1. Medir en Cloudflare CPU, duracion, consultas D1 y subrequests por tick y
  aprobar los limites de lote (hoy provisionales: 3 detalles por consulta y
  3 mensajes por tick). I6 solo midio en local: 20 partes en 7 ticks, 0
  llamadas ITAD/OAuth en ticks no vencidos, ~21 sentencias D1 por tick de entrega.
2. Con permisos específicos: provisioning OAuth y operaciones remotas de
   operador mediante `npm run oauth:operator` (ver [guía I7](docs/I7-operacion.md)).
3. Solo con autorizacion posterior: crear recursos, configurar secretos,
  desplegar, activar cron y probar Telegram real (chat privado).
4. Verificar una oferta nueva con correo desactivado y notificaciones Waitlist
  habilitadas; las pruebas simuladas no demuestran esa independencia.

## Funcionamiento previsto

```text
IsThereAnyDeal
  -> GET OAuth /notifications/v1 cada cinco minutos (compuerta durable D1)
  -> GET OAuth /notifications/waitlist/v1?id=... para IDs nuevos
  -> validacion y formato por aviso, pendientes D1
  -> API de Telegram (drenaje de partes en cada tick de un minuto, I6 local)
  -> chat autorizado
```

IsThereAnyDeal genera los avisos y determina juegos/ofertas segun
los ajustes de notificacion del usuario. No es necesario leer su correo ni
reproducir localmente los filtros de precios.

Antes de dar por terminada la integracion, comprobar un aviso nuevo y su entrega
con correo desactivado, manteniendo las notificaciones de la Waitlist habilitadas.
El evento `ping` solo pertenece a la referencia webhook mock.

## Alcance de produccion acordado

- Uso personal, con un chat de destino configurado.
- Lectura OAuth de notificaciones oficiales cada cinco minutos, no precios.
- Primera sincronizacion registra baseline sin enviar historicos; reinicios no
  repiten baseline. Se procesan IDs nuevos aunque ya esten leidos en ITAD.
- Un mensaje por aviso o partes identificadas; todos sus juegos y ofertas.
- Mensajes con titulo, tienda, precio, moneda, descuento y enlace recibido.
- Conservacion de los enlaces originales, incluidos sus parametros de afiliado.
- Validacion de respuestas, proteccion de credenciales, control de duplicados y
  tratamiento explicito de errores.
- Ninguna lectura de correo ni consulta periodica de precios en el flujo inicial.

## Configuración real (referencia de instalación inicial)

- Bot creado con BotFather y token de Telegram almacenado como secreto.
- Chat de destino autorizado; para un chat privado, el usuario debe iniciar
  primero una conversacion con el bot.
- Worker con cron (I6 local: cada minuto, consultas ITAD cada cinco minutos por la
  compuerta durable) y acceso HTTPS a ITAD y Telegram. Aplicar la migracion 0004.
- OAuth con permiso `notifications` y, para Rich/bundles, `wait_read coll_read`;
  refresh real se comprobo en I3. En I4 se
  almacena el conjunto de tokens en D1 como sobre AES-GCM con nonce reservado
  contra reutilizacion; la clave se introduce luego como Workers secret, nunca
  en D1/vars versionadas. D1 local no demuestra configuracion cloud ni secretos.
- Migracion y adaptador D1 para baseline, trabajo nuevo, planes, reservas y
  confirmaciones; aun no existe binding en el Worker mock ni recurso cloud.

No se requiere registro de webhook para la arquitectura acordada. Una API key
no sustituye el permiso OAuth `notifications`.

No compartir tokens en el chat ni incluirlos en archivos versionados, ejemplos,
capturas o registros.

## Agentes de VS Code

Definiciones en [`.github/agents/`](.github/agents/):

| Agente | Responsabilidad |
| --- | --- |
| ITAD Coordinador | Agente padre seleccionable; elige los hijos segun la tarea. |
| ITAD Implementacion | Construir el flujo de avisos y la entrega a Telegram, con pruebas. |
| ITAD QA | Ejecutar pruebas y revisar el comportamiento sin modificar archivos. |
| ITAD Despliegue | Preparar alojamiento, secretos, persistencia y guia operativa. |

Seleccionar **ITAD Coordinador** en el chat de VS Code. Los archivos
definen roles: no ponen en marcha procesos ni despliegan servicios.
No es necesario invocarlos todos en cada tarea.

### Punto de entrada recomendado

Seleccionar **ITAD Coordinador** en el selector de agentes de VS Code y solicitar,
por ejemplo: "Coordina la siguiente fase del bot con Workers, TypeScript y D1
futuro; revisa las limitaciones de los mocks". El coordinador elige automaticamente al hijo adecuado
segun el resultado solicitado; no es necesario indicar que especialista usar.
Los hijos no delegan entre si.

```text
Usuario -> ITAD Coordinador (padre)
             +-- ITAD Implementacion: crear o corregir codigo
             +-- ITAD QA: probar o revisar sin editar
             +-- ITAD Despliegue: alojamiento y operacion
```

Ejemplos de tareas para el padre:

- "Corrige los avisos duplicados": asigna la correccion a Implementacion.
- "Comprueba las pruebas de deduplicacion": selecciona QA.
- "Prepara el despliegue HTTPS": selecciona Despliegue.

En tareas mixtas, coordina las dependencias y devuelve un resultado conjunto.

Definiciones:

- [ITAD Coordinador](.github/agents/itad-coordinador.agent.md)
- [ITAD Implementacion](.github/agents/itad-implementacion.agent.md)
- [ITAD QA](.github/agents/itad-qa.agent.md)
- [ITAD Despliegue](.github/agents/itad-despliegue.agent.md)

Si no aparecen tras crear los archivos, volver a abrir el selector o recargar
la ventana de VS Code. La disponibilidad de delegacion depende del entorno;
tambien se pueden seleccionar los especialistas manualmente.

El coordinador usa las herramientas predeterminadas del entorno para poder
consultar al usuario y delegar. Los especialistas tienen herramientas limitadas
a su trabajo; QA puede ejecutar pruebas, pero no dispone de herramientas de
edicion. Esa restriccion de rol no es un aislamiento de seguridad del terminal.

## Orden de trabajo

1. Lenguaje y alojamiento acordados: TypeScript, Cloudflare Workers y D1.
2. Base webhook mock conservada; I1 contratos/formato implementados e instrucciones
   alineadas con la ruta OAuth.
3. Cliente/OAuth implementados (I2), refresh real puntual comprobado (I3), D1
   local y persistencia cifrada (I4).
4. I5 implementado: Telegram y cron con simulaciones y D1 local. Pendiente QA,
   I6 (capacidad) y guia antes de solicitar configuracion/despliegue reales.
5. Solo con permiso: probar envio Telegram real y aviso nuevo sin correo.

## Criterios de aceptacion

- Un aviso valido produce mensajes solo en el chat configurado.
- Un lote con varios juegos y ofertas se procesa sin omitir datos relevantes.
- Los mensajes respetan los limites y el formato de Telegram.
- Un ID repetido no repite partes confirmadas en los escenarios documentados
  (integrado en I5 con ITAD/Telegram simulados y D1 local; sin prueba real).
- Los fallos de red y limites de Telegram no se presentan como entregas correctas
  (I5, simulado).
- Baseline, pendientes y recibos sobreviven reinicios locales y la entrega se
  recupera en `test:cron`; sin comprobacion en Cloudflare ni Telegram reales.
- Las entradas invalidas o no autorizadas se rechazan sin enviar mensajes.
- Los registros permiten diagnosticar errores sin revelar secretos.
- La guia distingue pruebas simuladas de la comprobacion real sin correo.

## Fuentes oficiales

- [Documentacion API](https://docs.isthereanydeal.com/)
- [GET lista de notificaciones](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/notifications/list.v1.yaml)
- [GET detalle Waitlist](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/notifications/waitlist.v1.yaml)
- [Esquema de lista](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/notifications/schemas/obj.notification.yaml)
- [Esquema de detalle](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/notifications/schemas/obj.notification.waitlist.yaml)
- [Ejemplo de lista](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/notifications/examples/resp.notifications.get.v1.yaml)
- [Ejemplo de detalle](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/notifications/examples/resp.notifications.waitlist.get.v1.yaml)
- [Evento de ofertas de la Waitlist](https://github.com/IsThereAnyDeal/API/blob/master/docs/webhooks/notification.yaml)
- [Evento ping](https://github.com/IsThereAnyDeal/API/blob/master/docs/webhooks/ping.yaml)
- [Ejemplo del evento](https://github.com/IsThereAnyDeal/API/blob/master/docs/webhooks/examples/event.notification-waitlist.yaml)
- [Registro y eliminacion de webhooks mediante API](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/webhooks/webhooks.v1.yaml)
- [Configuracion manual de webhooks](https://isthereanydeal.com/settings/webhooks/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage)
- [Telegram sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage)
- [Telegram InputRichMessage](https://core.telegram.org/bots/api#inputrichmessage)
- [Telegram ResponseParameters y retry_after](https://core.telegram.org/bots/api/types/responseparameters)
- [Esquema de juegos de notificacion](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/notifications/schemas/obj.notification.game.yaml)
- [Esquema de ofertas de notificacion](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/notifications/schemas/obj.notification.deal.yaml)

Contratos de lista/detalle, juegos/ofertas, webhook/ping y `sendMessage`
verificados en fuentes oficiales publicas para I1 el 2026-10-31. La base mock
se verifico el 2026-10-27, incluidos los
esquemas referenciados de precios, tiendas, tipo de juego, flags, DRM y plataformas.
Telegram documenta `chat_id` y `text`, texto de 1 a 4096 caracteres y resultado
`Message` al tener exito. Las pruebas usan el puerto mock, no acceso a su API.

Revisar los contratos vigentes antes de implementar. No asumir garantias de
reintento, firmas de autenticacion o independencia del correo que no esten
documentadas o verificadas.
