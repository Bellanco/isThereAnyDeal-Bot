# Operación — despliegues Rich/bundles y estado actual

**Último deploy (2026-11-03):** ajustes Rich de bundles publicados en el Worker
existente; versión `272da3c6-6e39-4c09-ac42-a300de85a141` al **100 %**,
creada `2026-11-03T20:52:38.280082Z`; deployment
`89d005e2-df9f-4318-8125-17db479d34c2`, `2026-11-03T20:52:39.546785Z`.
Status/list coinciden, cron `* * * * *`; metadata de bindings/runtime igual
a la versión anterior. Sin tick, render ni entrega real verificados.
[Evidencia completa](#22-publicacion-autorizada-de-ajustes-rich-bundles--2026-11-03).

**Intento histórico (2026-11-02):** intento autorizado de publicar Workers Logs
detenido por fallo del dry-run, antes de cualquier deploy. Sin nueva versión,
reintento ni rollback; observability solo confirmado en configuración local.
[Comprobaciones y fallo](#21-intento-autorizado-de-publicar-observability--2026-11-02).

**Anterior (2026-11-02):** corrección de Unicode mal formado en `safeImageUrl`
publicada en `cfcd14fb-0843-4481-8217-d8484b138e63` al **100 %**,
versión creada `2026-11-02T22:38:34.406885Z`, deployment
`2026-11-02T22:38:35.842788Z`. Status/list coinciden; cron `* * * * *`
confirmado por salida de triggers, `LIVE_DELIVERY=enabled` y metadata de
bindings/runtime sin cambios frente a `613fede8-8bc1-4967-bed8-ffcbb3dc9fbd`.
No se forzó ni observó tick, render, entrega o lectura de Colección en esa
operación. [Evidencias y límites históricos](#20-reautorizacion-del-usuario-y-revision-de-cierre--2026-11-02).

**Antecedente (2026-11-01 11:46:48.755025 UTC):** reglas finales Rich desplegadas,
versión `a5249f58-4e5a-4c78-9df8-1aa26b73c7a6` al **100%**, mensaje
`Deploy final Rich display rules and subtle expiry`. Status y último registro
del listado coinciden, autor redactado. La salida del deploy confirmó
`schedule: * * * * *`; no se verificó tick funcional ni render/entrega reales.
Config activa existente intacta, sin nuevas migraciones o cambios de secretos,
D1, OAuth, key/scopes, baseline/gates/colas. `bundles: off` conocido por logs del
usuario, no reconsultado ni modificado. [Evidencia y checklist actual](#18-despliegue-autorizado-de-reglas-finales-rich--2026-11-01).

**Antecedente (2026-11-01):** migración 0005 aplicada y versión
`02994b02-61e2-4a3a-a96d-18bf1fc70525` listada; cron cada minuto confirmado en
ese deploy. Ver el [intento histórico](#16-intento-autorizado-de-actualización--2026-11-01).

**Antecedente: deploy Rich v4 posterior (2026-11-01):** comando de deploy exit 0 y versión
`a246f649-1b2b-40f8-98f5-f026acc1229b` confirmada al 100% en
`deployments status` y en el último registro de `deployments list`, con el mensaje
autorizado. La discrepancia inicial se resolvió revisando fechas y el listado completo:
se había tomado un cambio de secreto antiguo como el registro más reciente.
No se repitió el deploy ni se hizo rollback. La consulta no informó el cron, así que el trigger remoto actual
queda sin verificar. Ver [evidencia y checklist del intento nuevo](#17-intento-autorizado-de-despliegue-rich-v4--2026-11-01).

Render real, salud funcional, scopes/API key y cuotas siguen pendientes. La
producción anterior se describió como activa según evidencia aportada por el
usuario (baseline de 23 avisos, tick cada minuto y sesión OAuth recuperada);
no se verificó aquí un tick ni el funcionamiento de ninguna de las versiones.
Cloudflare Workers + D1, TypeScript, HTTP nativo y sin nuevas dependencias.

Las secciones I7/I8/I9 de instalación inicial y su validación al final son
**históricas**, no instrucciones para crear de nuevo la DB, baseline o bot.
Su "no ejecutado en I7" no niega la evidencia posterior del usuario. Para la
instalación existente usar el procedimiento siguiente; cada paso cloud necesita
su propia confirmación, no se autoriza por haber aprobado el diseño.

## Actualización Rich y bundles sobre producción existente

**Preparado local:** Rich HTML `sendRichMessage`, banners opcionales,
conservación íntegra de ofertas y enlaces, bundles completos con marcas y
migración `0005_rich_bundles.sql`. Avisos OAuth cada 5 min, tick de entrega
1 min. Bundles **ES**, **mature=true**, cada **60 min**: cruce separado del
feed oficial con Waitlist, no reglas oficiales de notificación de bundles.

1. **Validar offline**, sin leer secretos: tests/typecheck/D1 local/cron/dry-run
   listados abajo. `check:prod` sobre plantilla debe rechazar placeholders;
   sobre copia pública apagada completa debe pasar. Sobre copia activa necesita
   `--activate`, solo check offline, nunca permiso para desplegar.
2. **Pedir permiso de parada y deploy apagado.** Usuario cambia la copia pública
   existente a `LIVE_DELIVERY=disabled`, `crons=[]`, conserva cuenta/DB/nombres/
   callback/versión AES. Verificar con `check:prod` y desplegar **config apagada
   antes de reautorizar** (procedimiento de parada §10). No basta editar el archivo.
   Verificar propagación del cron en dashboard y drenar invocaciones en curso:
   ninguna activa y reservas caducadas 120 s después de última actividad.
   Pendientes D1 se conservan, no se borran para "vaciar". `oauth_reauth` solo
   no para entregas, por eso se exige parada total.
3. **Pedir permiso independiente de migración D1 remota.** Revisar pendientes
   con `d1 migrations list`, aplicar **0005 remoto antes del nuevo deploy**,
   comprobar lista de aplicadas (§4). No recrear DB ni reaplicar SQL manual.
   Si falla, parar y revisar; no desplegar rediseño contra esquema antiguo.
4. **Pedir permiso de secreto.** Usuario introduce `ITAD_API_KEY` mediante el
   prompt oculto de Wrangler con Worker apagado. Es opcional: sin key, bundles
   off y avisos continúan. Nunca en config pública, argv, chat o fichero.
   `node $w secret put ITAD_API_KEY --config $cfg` es operación cloud, **no
   ejecutada ni autorizada en este encargo**; `secret put` puede desplegar
   versión, verificar que siga apagada. API key no sustituye OAuth.
5. **Pedir permiso OAuth real + lectura/escritura D1 remota.** Usuario ejecuta
   `npm run oauth:operator -- --config wrangler.production.local.jsonc --mode reauthorize --live`
   tras confirmar parada/drenaje. La CLI ya solicita
   **`notifications wait_read coll_read`** y valida scopes. Conservar la clave
   **AES y versión actuales**; ampliar scopes no requiere rotarlas.
   Solo cambiarlas por recuperación/compromiso mediante §12. Reemplazo CAS
   conserva baseline 23, IDs y recibos. Resultado ambiguo: usar `status` con
   permiso y revisar, no repetir OAuth a ciegas.
6. **Pedir permiso de nuevo deploy apagado.** Config revisada sin extras ni
   secretos en vars, misma DB y clave/sesión compatibles con 0005. Comprobar
   versión, triggers apagados y estado agregado. No hay migración inversa ni
   rollback automático; planes de texto existentes seguirán como texto.
7. **Solo por permiso explícito de reactivación**, revisar gate CPU/cuotas,
   habilitar `LIVE_DELIVERY=enabled` y cron `* * * * *`, check `--activate`,
   deploy y observación autorizada. Verificar avisos/cola y baseline bundles
   único sin envíos históricos; no resetear baseline ni gate.
8. **Permisos de comprobación real separados:** render móvil con los tres
   ejemplos del script, moneda real con country ES, CPU Free Rich/bundles,
   continuidad/refresh/recibos y oferta natural con correo desactivado.
   No afirmar entrega ni independencia del correo por un deploy o preview.

No ejecutar pasos siguientes si el anterior carece de evidencia/confirmación.
Este procedimiento histórico no autoriza operaciones adicionales. El deploy
actual autorizado figura en §20; no se ejecutaron OAuth ni envíos de prueba
durante la publicación de la corrección Unicode.

### Preview móvil sin tocar producción

```powershell
npm run preview:telegram -- --dry-run
npm run preview:telegram -- --dry-run --no-banner
npm test -- tests/telegram-preview.test.mjs
# Solo el usuario tras autorizar 3 mensajes y en consola privada TTY:
npm run preview:telegram -- --live
```

Token/chat de entrada oculta, validación y confirmación exacta
`ENVIAR 3 EJEMPLOS`; no opciones/env/archivos de secretos. Formateadores,
validadores y cliente Telegram reales compilados en temporal propio, sin D1
ni cloud. Dry-run imprime HTML, no render exacto del cliente Telegram.
El formato v4 incluido en la versión listada quita cabeceras resumen y pies técnicos en Rich;
solo conserva `parte X/Y` en multipartes. Del bundle solo muestra caducidad;
ofertas Waitlist también muestran solo caducidad, en Madrid `hh:mm dd-mm-aaaa`
(formato del deploy del 2026-11-01, actualizado por §19).
El ajuste desplegado en §18 usaba en ambas `<footer>Hasta hh:mm dd-mm-aaaa</footer>`,
sin negrita, helper compartido `expiryFooter`/`when` Europe/Madrid existente;
null no muestra bloque ni etiqueta. Footer es un bloque Rich oficial,
no CSS/tamaño arbitrario. La maqueta lo aproxima menor y secundario, sin
garantía de tamaño/color; aceptación/render reales **PENDIENTES de la
ejecución del usuario** con el comando live de arriba.
Omite DRM/plataformas, publicación, precios secundarios de tienda, precio anterior
y señal de mínimo de tienda; conserva mínimo histórico del juego, sin inferir
un mínimo trimestral. No cambia texto legado,
IDs/recibos ni planes ya persistidos. Este ajuste ya está desplegado (§18).
Ejemplos: banner/precios/mínimo; varias tiendas/DLC/cupón/caducidad/adultos;
bundle tres niveles/caducidad/Waitlist+Colección. La nota ficticia se quitó del
ejemplo. La decisión anterior de conservar notas reales visualmente queda
reemplazada explícitamente: ninguna nota ITAD se dibuja en Rich bundles;
`bundle.note` se conserva en payload, validadores y persistencia. No cambia
planes ya persistidos; el formatter actualizado está en la versión remota
indicada en §18. La [verificación local y maquetas](ejemplos-oficiales-preview.md#caducidad-secundaria--footer-rich-nativo)
sigue siendo evidencia offline, no render real.
Títulos/tiendas inventados,
compras en example.com, enlaces ITAD por slugs ficticios que pueden no existir.
Banner conocido HTTP 200 `https://placehold.co/600x280/2b3a55/ffffff/png?text=Nebula+Drifters`
depende de tercero/Telegram; no se reconsultó. `--no-banner` lo omite.
~1 s entre envíos; primer fallo detiene, informa confirmados y espera mínima 429.
Seguimiento local NO desplegado: el tercer ejemplo ahora tiene un banner
ficticio **per-game** `https://example.invalid/preview/nebula-banner600.jpg`.
No es descargable ni una portada de bundle; la maqueta externa solo usa un
placeholder local explícito. `--no-banner` lo elimina. No se autoriza envío
real ni descarga en este seguimiento.
Sin reintentos ambiguos ni persistencia/dedup: relanzar duplica confirmados y
el intento fallido pudo llegar. 400 con imagen permite un fallback sin imagen;
400 persistente detiene. No mostrar URL con token/respuestas/ID de chat.
Temporal propio borrado en finally; limpieza fallida es explícita y exit no cero,
sin invalidar confirmaciones previas. No garantía de borrado físico en JS.

### Riesgos y señales de operación del rediseño

Sin key: `bundles.state=off`; key + OAuth antiguo `notifications`: avisos
siguen, banners ausentes y bundles `scope_missing` hasta reautorizar `wait_read`.
`coll_read` permite marcas de Colección, best effort: fallo solo quita marcas.
`warnings` indica `banners_<categoría>` / `collection_<categoría>`; no confundir
decoración ausente con entrega perdida. `bundles` informa estado/listados/
baseline/vistos/planificados/inválidos; `calls` añade `itadWaitlistGames`,
`itadCollection`, `itadBundles`. Revisar `errors`, `queue`, `sent`, bloqueos y
edad de cola, no solo `planned`. [Detalle y mediciones locales](I5.md).

**Diagnóstico Colección por el usuario (no ejecutado aquí):** puede revisar el
histórico en el dashboard Workers Logs **si está disponible**. Para observar
solo ciclos futuros en live:

```powershell
node .\node_modules\wrangler\bin\wrangler.js tail --config .\wrangler.production.local.jsonc --format json
```

Detener con **Ctrl+C**. Compartir únicamente campos de `bridge_cycle`:
`bundles.state`, `bundles.planned`, `calls.itadCollection` y `warnings/errors`
**redactados**. No compartir datos de cuenta/chat, tokens, payloads, IDs/UUID,
URLs privadas ni request logs; no enviar la salida completa de tail.
`itadCollection=0` solo sugiere falta de scope **si hubo un bundle nuevo
planificado**, no lo demuestra (hay otros caminos sin llamada). `=1` y sin
warnings no confirma UUID coincidente ni propiedad. Logs actuales no
demuestran la pertenencia al crear un plan antiguo. No se modifica el flujo
Collection ni su telemetría; no se ha consultado cloud.

Todos los juegos/niveles se conservan. Mismo ID relanzado no es nuevo; después
del baseline solo se leen **50 recientes**, recuperación tras parada larga
limitada. Pertenencia se evalúa al detectar, no retroactiva. 400 banner hace
fallback sin imágenes; 400 persistente bloquea parte. Recibo confirmado no se
repite, pero ack/persistencia perdidos pueden duplicar; `unverified` requiere
revisión manual. Moneda ES, CPU Free, render e independencia del correo pendientes.

## 1. Archivos y contrato de seguridad

- `wrangler.jsonc` sigue mock, sin D1 ni cron; NO desplegarlo.
- `wrangler.production.jsonc` es una plantilla JSON valida (extension JSONC):
  `APP_MODE=production`, `LIVE_DELIVERY=disabled`, `crons=[]`, D1 `DB` con
  identificadores ficticios. Sin rutas, workers.dev ni previews.
- `scripts/check-production.mjs` comprueba offline una copia con placeholders
  reemplazados. No autentica, no comprueba secretos, cuenta ni capacidad.
  El script de comprobacion no envuelve Wrangler: no impide saltarselo.
- `npm run dry-run:prod` solo empaqueta la plantilla apagada en
  `dist/production`; **no valida la configuracion real ni provisiona D1**.
- `.gitignore` excluye configuracion local, `.dev.vars*`, `.env*`, sobres OAuth
  y estado local. Ignorar NO cifra ni protege ACL; no guardar secretos en el
  proyecto, OneDrive, historial, transcript, capturas ni evidencias compartidas.

`src/index.ts` acepta en produccion SOLAMENTE:

| Binding | Lugar / requisito |
| --- | --- |
| `APP_MODE` | var publica: `production` |
| `LIVE_DELIVERY` | var: `disabled` en preparacion; `enabled` solo con permiso I9 |
| `DB` | binding D1 con migraciones 0001–0005 para el rediseño |
| `OAUTH_CLIENT_ID` | var: Client ID publico de la app compatible |
| `OAUTH_REDIRECT_URI` | var: callback EXACTO registrado, HTTP `127.0.0.1` con puerto explicito, sin query/fragmento/credenciales |
| `OAUTH_TOKEN_KEY_VERSION` | var: identificador de clave, 1–32 caracteres `[A-Za-z0-9._-]` |
| `OAUTH_TOKEN_KEY` | Workers secret: AES de 32 bytes, Base64 estandar; nunca D1 ni var |
| `TELEGRAM_BOT_TOKEN` | Workers secret; token del bot, nunca URL mostrada |
| `TELEGRAM_CHAT_ID` | Workers secret por privacidad: entero positivo de chat privado, <= 2^52 |
| `ITAD_API_KEY` | Workers secret opcional; sin key bundles off |

No anadir `OAUTH_CLIENT_SECRET`, access/refresh tokens como bindings, mocks,
bindings administrativos ni variables extra. La composicion usa OAuth
**public PKCE**, no `client_secret_*`. Esos metodos existen en la libreria pero
no en esta composicion. Una app incompatible requiere volver al coordinador.
La validacion ocurre antes de crear el transporte live. Los tokens deben
estar en un sobre AES-GCM D1 inicializado; poner solo los secretos NO lo crea.

### Superficie HTTPS, ping y webhook

No se necesita URL publica: el cron consulta ITAD por HTTPS y envia a Telegram
por HTTPS. El callback OAuth es loopback local, NO una URL publica Workers.
El `fetch` production devuelve 503; no hay healthcheck HTTP, endpoint admin ni
disparador remoto. No habilitar `workers_dev`, previews o rutas para probarlo.
No registrar webhook ITAD ni Telegram. BotFather + iniciar chat NO requieren
webhook. `ping`/`pong` siguen siendo solo el mock heredado; no forman parte de
I8–I9. `/__scheduled` existe solo en Wrangler local `--test-scheduled`, no cloud.
Un 503 del Worker no demuestra conectividad ITAD ni un servicio averiado.

## 2. Preparacion local reproducible (sin proveedor)

Desde la raiz, Node >=22.12 y dependencias del lockfile:

```powershell
npm ci
npm test
npm run typecheck
npm run test:d1
npm run test:cron
npm run dry-run
npm run dry-run:prod
```

`npm ci` instala paquetes (necesita acceso al registro si no estan cacheados);
no es despliegue. No se ejecuto en I7: dependencias ya instaladas. No hay
comando `build`, `start:prod` ni demonio local de produccion. La CLI temporal
`npm run oauth:operator` esta descrita en seccion 5; no sustituye al cron ni se
ha ejecutado con OAuth/D1 reales.
Workers ejecuta `scheduled` sin ordenador encendido; D1 cloud es persistencia,
no `dist/`, memoria del isolate o D1 local temporal de tests.

Crear una copia local SIN secretos y editarla como JSON (sin comentarios):

```powershell
if (Test-Path wrangler.production.local.jsonc) { throw 'Copia existente: revisar, no sobrescribir.' }
Copy-Item wrangler.production.jsonc wrangler.production.local.jsonc
$cfg = 'wrangler.production.local.jsonc'
$w = 'node_modules/wrangler/bin/wrangler.js'
```

No sobreescribir una copia existente. Reemplazar el nombre Worker, nombre D1,
account ID de 32 hex, UUID D1, Client ID publico, callback y version de clave.
El UUID D1 se obtiene solo despues de la creacion autorizada. Los nombres
elegidos deben ser estables y no los de mock/integracion.

```powershell
npm run check:prod -- --config wrangler.production.local.jsonc
```

Exit 1 con `placeholders` hasta completar datos. Exit 0 solo valida sintaxis y
estado apagado; verificar manualmente que cuenta/DB son las elegidas. No leer
archivos de secretos en esta comprobacion ni usar `--var` con credenciales.

## 3. I8 — Bot y chat privado (permiso especifico primero)

1. Usuario abre el BotFather oficial verificado, `/newbot`, elige nombre y
   username y guarda el token en su gestor seguro local. No pegarlo en chat,
   ticket, navegador, comando o archivo versionado.
2. Abre SU bot, pulsa Start o envia `/start`. Solo chat privado; no grupos,
   canales, bots de terceros para averiguar IDs ni destinos desde payloads.
3. Con permiso para las consultas Telegram, usar el bloque siguiente en una
   consola PRIVADA sin transcript, verbose/debug ni proxy que registre URL.
   El token de Telegram necesariamente viaja en la ruta HTTPS en memoria;
   nunca imprimir URI, objeto Request, excepcion original o respuesta completa.
   Este bloque NO se ha ejecutado contra Telegram en I7.

Funcion local para las consultas puntuales y la prueba posterior:

```powershell
function Invoke-PrivateTelegram {
  param(
    [ValidateSet('getWebhookInfo','getUpdates','sendMessage')][string]$Method,
    [hashtable]$Payload
  )
  $secret = Read-Host 'Token del bot (solo entrada local protegida)' -AsSecureString
  $ptr = [IntPtr]::Zero
  $token = $null
  $uri = $null
  try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($token -notmatch '^\d{1,20}:[A-Za-z0-9_-]{20,128}$') { throw 'invalid' }
    $uri = 'https://api.telegram.org/bot' + $token + '/' + $Method
    $result = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body ($Payload | ConvertTo-Json -Compress) -TimeoutSec 10 -ErrorAction Stop
    if ($result.ok -ne $true) { throw 'rejected' }
    return $result
  } catch {
    # No mostrar $_, ErrorRecord, URL ni description Telegram.
    throw 'Telegram: operacion no verificada; no repetir un envio sin revisar el chat.'
  } finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $secret.Dispose()
    $token = $null
    $uri = $null
    $Error.Clear()
  }
}
```

Pegar cada bloque siguiente completo. El envoltorio `. { }` conserva las
variables en la consola y hace que un `throw` detenga todo el bloque aunque
PowerShell 5.1/PSReadLine reciba el pegado linea a linea.

```powershell
. {
  $info = Invoke-PrivateTelegram -Method getWebhookInfo -Payload @{}
  if ($info.result.url) { throw 'Bot con webhook existente: parar; no borrarlo automaticamente.' }
  $info = $null
  $marker = 'I8-' + [guid]::NewGuid().ToString('N')
  $marker  # Solo marcador publico: enviar este texto a SU bot en Telegram.
}
```

Despues de enviar el marcador, una sola consulta, sin bucle ni long polling:

```powershell
. {
  $updates = Invoke-PrivateTelegram -Method getUpdates -Payload @{ timeout = 0; limit = 100; allowed_updates = @('message') }
  $found = @($updates.result | Where-Object {
    $_.message.text -ceq $marker -and
    $_.message.chat.type -ceq 'private' -and
    $_.message.chat.id -eq $_.message.from.id -and
    $_.message.from.is_bot -eq $false
  })
  $updates = $null
  if ($found.Count -ne 1) { throw 'No hay un unico mensaje propio: parar y revisar, no elegir el primer ID.' }
  $chatId = [string]$found[0].message.chat.id
  $found = $null
  if ($chatId -notmatch '^[1-9]\d{0,15}$' -or [decimal]$chatId -gt 4503599627370496) { throw 'Chat privado no valido.' }
  $chatId  # Mostrar SOLO localmente para introducirlo en el prompt de secret put.
}
```

No usar `offset`, no confirmar/borrar updates, no iniciar sondeo continuo. Si
hay demasiados updates, conflicto con otro consumidor o webhook, parar y
acordar diagnostico puntual. La respuesta puede contener datos personales;
limpiar variables y cerrar consola al terminar. Los strings en memoria .NET
no tienen borrado garantizado; `SecureString` reduce exposicion de entrada, no
es una garantia contra un equipo comprometido.

## 4. I8 — Cloudflare y D1 (permiso separado)

El usuario crea/accede a su cuenta Cloudflare por la interfaz oficial, revisa
plan/costes y autoriza Wrangler. No introducir contrasenas, cookies ni API
tokens cloud en este chat. Sin sesion autenticada inspeccionada en I7.

Solo despues del permiso y en consola privada (puede mostrar email/account ID):

```powershell
$w = 'node_modules/wrangler/bin/wrangler.js'
$cfg = 'wrangler.production.local.jsonc'
node $w login
node $w whoami
```

Seleccionar account ID correcto en la copia. Wrangler puede almacenar
credenciales de login en su perfil local: proteger perfil/ACL y cerrar sesion
cuando corresponda. No exportarlas al repositorio ni evidencias.

Crear DB solo si NO existe ya la DB aprobada; sustituir nombre placeholder:

```powershell
node $w d1 create REPLACE_WITH_CHOSEN_DATABASE_NAME --config $cfg --update-config=false
```

Este comando es REMOTO aunque no tenga `--remote`. Copiar SOLO UUID publico de
la DB elegida al config; no activar remote bindings de desarrollo. No repetir
`create` tras un resultado ambiguo: revisar recursos y confirmar identidad.
Antes de migrar: `check:prod` exit 0, cuenta/UUID/nombre confirmados. Con permiso
de migracion remota (sintaxis comprobada, NO ejecutada en I7):

```powershell
node $w d1 migrations list DB --remote --config $cfg
node $w d1 migrations apply DB --remote --config $cfg
node $w d1 migrations list DB --remote --config $cfg
node $w d1 execute DB --remote --config $cfg --command "SELECT name FROM d1_migrations ORDER BY id"
```

Revisar confirmacion interactiva, no usar CI ni aprobacion automatica. Se
esperan `0001_i4_storage.sql`, `0002_i5_delivery.sql`,
`0003_i6_detail_claims.sql`, `0004_i6_poll_gate.sql`, `0005_rich_bundles.sql`,
en orden. `list` muestra
PENDIENTES, no todas las aplicadas. No ejecutar las SQL manualmente:
`ALTER TABLE` de 0002/0003 no es repetible. Un fallo revierte la migracion
fallida, no las anteriores; revisar antes de reintentar.

## 5. I8 — provisioning y reautorizacion OAuth local

Existe `npm run oauth:operator`; no se ejecutó en I7 ni en este cierre. Es una herramienta
opt-in: sin `--live`, configuracion production local sin placeholders y una
confirmacion interactiva exacta, falla sin iniciar OAuth ni acceder a D1.
Solo admite OAuth public PKCE y el callback registrado exacto en
`127.0.0.1:8765`; no implementa `client_secret`, endpoint publico, despliegue,
Telegram ni importacion SQL.

Precondiciones operativas que la herramienta no puede demostrar por si sola:

- D1 remota creada y migraciones 0001–0005 aplicadas para rediseño; Cloudflare autenticado con
  `wrangler login` guardado localmente (la herramienta no hereda tokens API de
  entorno).
- Confirmar en dashboard que el Worker desplegado tiene `LIVE_DELIVERY=disabled`,
  cron parado y ninguna invocacion activa; esperar al vencimiento de leases.
  La copia local apagada no prueba el estado remoto.
- Tener la clave AES-256 Base64 y su version guardadas fuera del proyecto en un
  gestor seguro. Ejecutar desde una consola local privada sin transcript ni
  grabacion. La herramienta la solicita sin eco en un terminal interactivo;
  no la genera, imprime, pasa por argv/env ni escribe a disco. El Client ID y la
  callback se leen de la copia local publica (el operador vuelve a introducir
  localmente el Client ID y la herramienta exige coincidencia exacta).
- La herramienta no actualiza bindings ni Workers secrets. Antes de activar
  cron, `OAUTH_TOKEN_KEY` del Worker y `OAUTH_TOKEN_KEY_VERSION` desplegados
  deben coincidir con la clave/version que cifraron el sobre; comprobarlo
  mediante el procedimiento autorizado de I9, no se puede inferir del import.
- OAuth real consume autorizacion/codigo. Una respuesta ambigua de D1 no se
  reenvia a ciegas; tokens en memoria se descartan al cerrar. Segun el proveedor,
  un token anterior podria dejar de servir despues de una reautorizacion, aunque
  CAS rechace la escritura. No se promete recuperacion automatica ni exactly-once.

Comandos disponibles (NO ejecutar sin permiso OAuth y permiso de lectura/
escritura D1 remota):

```powershell
# Provision inicial: solo si no existe ninguna sesion OAuth en D1.
npm run oauth:operator -- --config wrangler.production.local.jsonc --mode initialize --live

# Reautorizacion: lee la version actual y reemplaza con CAS.
npm run oauth:operator -- --config wrangler.production.local.jsonc --mode reauthorize --live

# Lectura sanitizada de version/indicador, util para diagnostico de resultado ambiguo.
npm run oauth:operator -- --config wrangler.production.local.jsonc --mode status --live
```

En provision/reauth, una vez confirmada la operacion, la herramienta inicia un
Worker administrativo efimero `wrangler dev` que escucha SOLO
`127.0.0.1`/puerto local. Usa `remote: true` en el binding D1: el codigo del
Worker se ejecuta localmente y utiliza el API oficial D1 Binding; no se publica
ni despliega un Worker, y `src/index.ts` no incorpora una ruta admin. El binding
se limita a la DB identificada por la copia aprobada. `wrangler dev` puede
contactar Cloudflare para autenticar/configurar el acceso al binding remoto;
este comportamiento y cualquier recurso auxiliar del proveedor no se han
probado. Revisar la version/documentacion de Wrangler y autorizar ese acceso
antes de usar `--live`; no asumir que equivale a una prueba offline. Un
capability aleatorio de un solo uso autentica las peticiones loopback; el archivo
de configuracion temporal contiene ese capability, no tokens ni la clave, y se
elimina al cerrar.
Antes de enviar el bearer, la CLI verifica un HMAC con nonce aleatorio: si otro
proceso ocupa el puerto local, no recibe la clave ni tokens. No se garantiza
borrado fisico. Ejecutar solo en una maquina local de confianza; `workerd` local
no es un sandbox endurecido. Capability y endpoints caducan a los 15 minutos;
una interrupcion abrupta podria dejar el proceso local hasta su salida, pero
rechaza operaciones pasado ese limite. Tras Ctrl+C, confirmar que Wrangler cerro
antes de reintentar.
La carpeta temporal `%TEMP%\itad-oauth-*` se borra al terminar, con reintentos,
porque en Windows `workerd` puede bloquear unos segundos su estado SQLite local.
Si aun asi no se puede borrar, la herramienta muestra
`oauth_operator_warning:temp_cleanup_incomplete`: es solo un aviso y no cambia el
resultado ya impreso. Borrar esas carpetas cuando Wrangler haya cerrado. Las
versiones anteriores a esta correccion mostraban en ese caso
`oauth_operator_failed:operation_failed` despues de una operacion confirmada.

Un listener OAuth temporal se enlaza al callback exacto `127.0.0.1:8765`.
`state`, verifier, authorization code, access/refresh tokens y clave se
mantienen en memoria del proceso; no se imprimen ni se registran por la
herramienta. El navegador recibe la URL de autorizacion mediante una redireccion
del listener, no como argumento de proceso. El callback redirige a la ruta limpia
sin query; aun asi, no se puede prometer que el navegador/sistema operativo no
retenga brevemente la URL de callback en historial o telemetria local. La clave
y tokens viajan solo en un POST loopback autenticado a ese Worker efimero. El
Worker usa `D1Storage` existente: AES-GCM, nonce aleatorio de
96 bits, envelope version 1 y AAD
`itad-oauth-envelope:1:<keyVersion>:<sessionVersion>`. D1 recibe el sobre cifrado
mediante los metodos de storage; no se genera SQL ni fichero con ciphertext.
La herramienta comprueba version/lectura descifrando en memoria y comparando
sin devolver tokens.

Provision usa insercion inicial solo cuando no existe sesion. Reauth pasa el
`expectedSessionVersion` observado y conserva el CAS existente: version de
sesion y reserva incrementadas, nonce history + sobre en un D1 batch, y
`oauth_reauth` se borra unicamente en el mismo batch exitoso. Conflicto devuelve
no-exito. Baseline, IDs conocidos, detalles, planes, partes, recibos y
`delivery_halt` no se modifican. Si el cliente pierde respuesta y la lectura
verificadora tampoco puede confirmar, parar y revisar version/indicador con
`status`; no repetir automaticamente. `status` no demuestra que tokens
especificos se escribieron.

El diseño remoto se apoya en [remote bindings de Wrangler](https://developers.cloudflare.com/workers/local-development/#remote-bindings)
y en [`D1Database.batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
(transaccional); no usa `d1 execute --file` como sustituto de un batch.
**Capacidad, autenticacion, D1 remota y callback real siguen sin probar**
hasta una ejecucion autorizada.

## 6. I9 — Instalacion apagada y secretos (otro permiso de despliegue)

Este paso puede preparar un Worker apagado si se autoriza expresamente, pero
no cierra los gates de OAuth real, capacidad ni permiso. Guardar copia del codigo/lockfile/config publico
revisado fuera de `dist`; este directorio es solo artefacto regenerable.

```powershell
npm run check:prod -- --config wrangler.production.local.jsonc
# Solo si exit 0 y permiso especifico:
node $w deploy --config $cfg --autoconfig=false --message "I9 staged disabled"
node $w deployments list --config $cfg
```

Comprobar en dashboard que cron/rutas/previews/workers.dev estan apagados y DB
es la correcta. Registrar version ID apagada como referencia de recuperacion.
Los cambios de cron pueden tardar en propagarse; no dar por parado un cron
preexistente solo por exito del deploy. `secret put` puede crear Worker si no
existe y puede desplegar una version: **no ejecutarlo antes del despliegue
apagado autorizado** ni aceptar creacion implicita.

Generar AES de 32 bytes con CSPRNG mediante herramienta segura local y
conservar Base64 en gestor privado con copia de recuperacion protegida.
No usar una contrasena, los valores QA o solo cambiar version. Registrar
version PUBLICA correspondiente en config; misma clave/version en el futuro
provisioner y Worker. El usuario introduce cada secreto en el prompt Wrangler:

```powershell
node $w secret put TELEGRAM_BOT_TOKEN --config $cfg
node $w secret put TELEGRAM_CHAT_ID --config $cfg
node $w secret put OAUTH_TOKEN_KEY --config $cfg
node $w secret list --config $cfg
```

`secret list` muestra nombres/tipos, NO prueba valores correctos. Deben existir
los tres secretos requeridos y, opcionalmente, `ITAD_API_KEY`; extras pueden
hacer rechazar `Env`. No usar `--secrets-file`, `--keep-vars`, secretos en vars,
ni credenciales como argumentos. Cliente publico/version/callback se despliegan
desde el config, no `secret put`. No afirmar salud sin sobre OAuth validado.

## 7. I9 — Prueba controlada de transporte (permiso de UN envio)

Antes de automatismo, cron apagado. En la misma consola privada, funcion de
seccion 3 y `$chatId` propio ya verificado, autorizar un mensaje de prueba:

```powershell
. {
  $reply = Invoke-PrivateTelegram -Method sendMessage -Payload @{ chat_id = $chatId; text = 'Prueba autorizada I9: transporte Telegram, no oferta ITAD.' }
  if ($reply.result.chat.type -cne 'private' -or [string]$reply.result.chat.id -cne $chatId -or $reply.result.message_id -lt 1) {
    throw 'Recibo no verificado: revisar chat antes de cualquier reintento.'
  }
  $reply = $null
  'Prueba de transporte confirmada en chat privado configurado.'
}
```

Comprobar visualmente recepcion una sola vez. No imprimir respuesta,
`message_id`, chat ID ni token en evidencias. Esta prueba directa no crea
confirmaciones D1, no comprueba cron/OAuth/formatter integrado ni acepta I10.
Error/timeout puede significar aceptado con respuesta perdida: NO repetir
sin revisar el chat. No insertar avisos ficticios en DB de produccion para
forzar un envio integrado. No existe comando de envio administrativo del Worker.

## 8. I9 — Gate de capacidad y activacion automatica

**No activar hasta resolver provisioning y aprobar capacidad cloud.** Revisar
en cuenta/plan elegidos cuotas actuales de Workers: CPU de cron de un minuto,
duracion, subrequests, concurrencia; D1: consultas por invocacion, lecturas/
escrituras, tamano por fila/base y JSON completo de planes. Confirmar limite
de cron y que una invocacion peor caso cabe en lease 120 s. Medir con I9
autorizado; no subir tandas sin evidencia ni limitar juegos/ofertas.

Sin cloud medido: 3 detalles por consulta, 3 mensajes/tick privado, throttle
1 s, timeout externo 10 s, hasta 5 intentos transitorios. Tick cada minuto
`* * * * *` UTC; consultas ITAD/OAuth solo con gate durable minimo 300 s
(429 puede aplazarlas). **No hay tolerancia que adelante la consulta 30 s.**
Un aviso de 20 partes: 7 ticks (~6 min tras planificar); multiples detalles
pueden esperar consultas posteriores. 180 partes/h teoricas, NO SLA cloud.
Preserva TODOS grouped games/deals, sin descarte al exceder una tanda.

Con permisos explicitos de automatismo (NO solamente el de un mensaje),
sobre importado/validado y gates satisfechos, editar COPIA local:
`LIVE_DELIVERY=enabled`, `triggers.crons=["* * * * *"]`. Ningun otro cambio.

```powershell
npm run check:prod -- --config wrangler.production.local.jsonc --activate
node $w deploy --dry-run --config $cfg --outdir dist/production-reviewed
# Solo si exit 0 y autorizacion de activacion:
node $w deploy --config $cfg --autoconfig=false --message "I9 authorized activation"
node $w deployments list --config $cfg
node $w tail --config $cfg --format json
```

Detener tail con Ctrl+C. Cron puede tardar en propagarse; observar dashboard
y varias invocaciones, no llamar `/__scheduled` remotamente. Primera lista
VALIDA crea baseline actual, sin mandar historicos (no la antigua lista de
23). En instalación existente conservar el baseline 23, no repetirlo.
Desde ese punto los IDs nuevos se guardan aunque tengan `read` fecha o `null`.
No borrar baseline ni resetear gate para acelerar. Primera sincronizacion
con error no es baseline vacio. I9 integrado requiere evidencia de cron,
baseline unico, persistencia, y refresh durable; si no ocurre refresh en la
ventana autorizada, queda pendiente, no se fuerza por SQL.

## 9. Estado, conectividad y evidencias para QA

Con permiso de lectura remota, consultas sanitizadas sin textos/tokens:

```powershell
node $w d1 execute DB --remote --config $cfg --command "SELECT complete FROM bridge_state WHERE state_key = 'baseline'; SELECT source, COUNT(*) AS count FROM known_notifications GROUP BY source; SELECT flag_key, category, set_at FROM bridge_flags"
node $w d1 execute DB --remote --config $cfg --command "SELECT status, blocked_category, COUNT(*) AS count FROM delivery_parts GROUP BY status, blocked_category; SELECT status, detail_blocked, COUNT(*) AS count FROM notification_work GROUP BY status, detail_blocked; SELECT MIN(k.first_seen_at) AS oldest_open_ms FROM known_notifications k JOIN notification_work w USING(notification_id) WHERE w.status = 'pending_detail' OR EXISTS (SELECT 1 FROM delivery_parts p WHERE p.notification_id = k.notification_id AND p.status <> 'confirmed')"
node $w d1 execute DB --remote --config $cfg --command "SELECT next_poll_at, lease_expires_at, last_started_at, last_completed_at, last_outcome FROM poll_gate WHERE gate_key = 'itad_poll'; SELECT key_version, session_version, refresh_claim_version, refresh_expires_at FROM oauth_credentials WHERE credential_id = 1"
```

No `SELECT *` sobre OAuth, planes, mensajes ni export total para diagnostico.
Logs de aplicacion: `bridge_cycle`, `bridge_cycle_failed`, `ok`, `poll`,
`pollGate`, `nextPollInSeconds`, `calls`, `queue`, `bundles`, `warnings`,
categorías e indicadores.
Revisar edad de pendientes y bloqueos, no solo contador de envios.
Conectividad: baseline/lista valida prueba ITAD; refresh con version persistida
prueba continuidad en ese momento; recibo validado prueba Telegram.
Ticks `not_due` no llaman ITAD/OAuth; tras 300 s puede consultarse.
No marcar sano por un deploy exit 0, secreto presente o un tail silencioso.

Cloudflare puede incluir metadata de plataforma en tail/dashboard: revisar y
redactar email/account IDs, chat IDs, detalles de avisos/URLs o cualquier
credencial antes de entregar evidencias. No habilitar Logpush, APM/proxy ni
logs de requests/responses para resolver fallos de tokens.

## 10. Parada, actualizacion, reinicio y rollback

No hay proceso local que mantener. **Parada total** autorizada: cambiar copia
a `LIVE_DELIVERY=disabled` y `crons=[]`, ejecutar:

```powershell
npm run check:prod -- --config wrangler.production.local.jsonc
node $w deploy --config $cfg --autoconfig=false --message "Operator stop"
```

Verificar propagacion en dashboard y ausencia de invocaciones nuevas; las ya
iniciadas pueden seguir y usar su Env anterior. Antes de importar/rotar
credenciales o modificar cola: esperar propagacion observada, ninguna
invocacion activa y caducidad de reservas (120 s DESPUES de la ultima actividad,
no 120 s despues de pulsar deploy). No prometer parada instantanea.

Actualizacion: detener si se cambian credenciales/esquema; conservar misma
cuenta/DB/nombres, snapshot publico de version y estado agregado; `npm ci`,
tests/typecheck/D1 local/cron/dryrun. Aplicar solo migraciones pendientes con
permiso, desplegar copia revisada apagada, comprobar estado, reactivar con
permiso. Secretos se conservan en deploy; no usar `--keep-vars` para esconder
drift de bindings. No aplicar QA SQL en cloud.

Reinicio/redeploy con misma DB/sesion: baseline, known IDs, partes y recibos
permanecen. Reservas vencidas se recuperan con CAS; confirmadas no se repiten.
Pendientes se drenan en orden por aviso y partes. Falta de flags aborta TODO;
fallo de gate no consulta pero puede drenar partes; `oauth_reauth` detiene
consultas, **no** entregas ya planificadas. Para parar TODO usar parada total,
no solo ese flag. Retencion API desconocida: no prometer recuperacion tras
ausencias indefinidas.

Rollback de codigo con permiso, servicio primero parado:

```powershell
node $w deployments list --config $cfg
# Elegir version ID revisada, compatible con esquema y clave/sesion actuales:
node $w rollback REPLACE_WITH_REVIEWED_WORKER_VERSION_ID --config $cfg --message "Reviewed recovery"
```

Puede restaurar bindings/secretos de esa version: comprobar key/version/Env
antes de reanudar y volver a asegurar estado apagado. No seleccionar version
vieja con credenciales revocadas. Si no hay version compatible, redesplegar
codigo conocido bueno con config/secretos ACTUALES, no rollback ciego.
Rollback Worker NO deshace D1 ni cron por garantia; verificar triggers.
No restaurar backup D1 automaticamente: podria perder recibos (duplicados),
IDs nuevos o devolver refresh rotado invalido. Antes de restaurar, parar,
preservar estado actual cifrado de forma protegida, comparar baseline/IDs/
confirmaciones y acordar reconciliacion y reauth con coordinador.

## 11. Fallos de entrega y recuperacion administrativa

429 respeta `retry_after` durable, no consume intento ni duerme con reserva;
transitorios hasta 5 intentos con backoff; agotados/permanentes bloqueados
visibles. Destino rechazado activa `delivery_halt`; nunca migrar a otro chat.
Ventana de duplicado inevitable: Telegram puede aceptar y perderse el ack o
persistencia D1; tras lease puede repetirse. `unverified` no reintenta solo.

Antes de recuperar: revisar chat privado localmente y causa, corregir
credenciales/config, parada total y reservas caducadas, permiso para la accion.
El comando nuevo opera sobre UNA parte exacta con CAS de estado/categoria; no lee
el texto ni el recibo. El UUID/indice cero-based no son secretos, pero deben
confirmarse antes de ejecutar. Solo acepta `unverified_json`, `unverified_shape`
o `unverified_message_id`. Categorias `unverified_chat_mismatch` y
`unverified_not_private` no son recuperables por este comando.

```powershell
# Solo tras permiso de lectura/escritura D1 y verificacion manual del estado.
npm run oauth:operator -- --config wrangler.production.local.jsonc --mode recover --notification-id REPLACE_WITH_VERIFIED_UUID --part-index 0 --action delivered --live
npm run oauth:operator -- --config wrangler.production.local.jsonc --mode recover --notification-id REPLACE_WITH_VERIFIED_UUID --part-index 0 --action retry --live
```

`delivered` requiere que el operador vea el mensaje exacto en el chat privado y
confirme; actualiza solo una parte bloqueada a `confirmed` con receipt
`operator_manual:<timestamp>`, nunca simula un `message_id` de Telegram.
`retry` requiere confirmar que no se vio el mensaje y aceptar explicitamente
que Telegram pudo aceptarlo: puede haber duplicado. Solo desbloquea esa parte,
conserva intentos y la pone debida; no despeja `delivery_halt`, no altera otras
partes ni reintenta automaticamente. Si el resultado es ambiguo, no volver a
ejecutar sin revisar el estado.

Los siguientes SQL preexistentes solo corresponden a bloqueos transitorios/
destino ya diagnosticados; NO usarlos para resolver `unverified`:

```powershell
# SOLO bloqueo transitorio agotado conocido:
node $w d1 execute DB --remote --config $cfg --command "UPDATE delivery_parts SET blocked_category = NULL, blocked_at = NULL, attempts = 0, next_attempt_at = 0 WHERE notification_id = 'REPLACE_WITH_VERIFIED_NOTIFICATION_UUID' AND part_index = 0 AND status = 'pending' AND blocked_category = 'transient_exhausted'"
# Tras corregir destino, SOLO con permiso y diagnostico confirmado:
node $w d1 execute DB --remote --config $cfg --command "DELETE FROM bridge_flags WHERE flag_key = 'delivery_halt'"
```

Verificar fila afectada y estado; cero cambios no es recuperacion. Para detalle
bloqueado, categorias permanentes, `chat_mismatch` o `not_private`, no resetear
intentos ni usar el nuevo comando; pedir procedimiento al coordinador. Nunca
borrar partes confirmadas, baseline o conocidos para "arreglar" entrega. La
recuperacion I7 no despeja ningun indicador.

## 12. Secretos comprometidos, perdidos y reautorizacion

- Bot token: parada total, revocar/regenerar en BotFather, usuario introduce
  nuevo `secret put TELEGRAM_BOT_TOKEN` con Worker apagado. Confirmar el mismo
  chat privado con permiso; no cambiar destino automaticamente. Reprobar solo
  con permiso de envio, despejar `delivery_halt` tras diagnostico y reactivar.
- Clave AES perdida: sobre existente no es recuperable sin clave. Nueva clave
  CSPRNG + nueva version y reauth explicita mediante
  `npm run oauth:operator -- --config wrangler.production.local.jsonc --mode reauthorize --live`.
  Conservar baseline/IDs/recibos; no crear otra DB ni borrar sesion para resetear.
- Clave comprometida o posible extraccion D1: tratar ambos tokens como
  comprometidos. Parar, revocar autorizacion en ITAD por usuario, nueva clave/
  version, autorizar otra vez, import CAS probado, comprobar lectura/sesion,
  luego reactivar. Revocar solo la clave Workers NO revoca tokens ITAD.
- Rotacion planificada de clave: no basta `secret put` o cambiar version.
  El sobre anterior fallara cerrado. Preservar respaldo protegido de clave/
  estado si no comprometidos y usar reauth/reemplazo coordinado; no hay
  comando de recifrado multiclave en este repo.
- `invalid_grant`, refresh perdido/rotado no persistido, `oauth_reauth`:
  parar, leer version actual, reautorizar y reemplazar CAS. No borrar flag
  para seguir con token invalido ni reutilizar token de prueba I3.
- Acceso Cloudflare comprometido: usuario revoca sesiones/credenciales del
  proveedor y audita deployments/secrets/DB. Rotar bot y OAuth/clave segun
  exposicion; no compartir API tokens ni incorporar un admin API poderoso.

## 13. I10 y costes pendientes

Despues del baseline activo, esperar oferta ITAD NATURAL nueva. No Reset,
sondeo de precios, cambios de reglas/frecuencia ni reactivar correo. Mantener
Waitlist y generacion de avisos; confirmar por observacion local segura que
el canal email sigue desactivado (corte observado: 2026-10-31T14:51:53.688Z).
Aviso posterior al corte Y al baseline, con entrega automatica al chat fijo:
comparar TODOS games/deals, enlaces intactos y partes ordenadas con detalle
oficial obtenido dentro de permiso. Guardar evidencia redactada, no tokens.
Un envio de prueba o aviso historico no prueba independencia del email.
Si no hay oferta natural, I10 sigue pendiente; no provocar otra.

I7 no genero cargos ni recursos externos. No se ha elegido/inspeccionado plan
facturable: no se promete gratis. Confirmar precios oficiales actuales de
Workers y D1 en cuenta antes de creacion/activacion, limites gratuitos,
sobreconsumo, almacenamiento creciente (sin borrado automatico), backups/
retencion y alertas presupuestarias disponibles. Sin dominio publico necesario,
no se preparo gasto de dominio/tunel/servidor. El crecimiento de DB y retencion
desconocida ITAD impiden prometer capacidad ilimitada o recuperacion eterna.

## 14. Validación I7 local realizada (histórica)

Wrangler instalado: **4.153.0**, sin instalar herramientas ni esbuild directo.
Sintaxis comprobada mediante `--help`: login/whoami, d1 create/execute,
migrations list/apply, secret put/list, deploy, deployments list, rollback y
tail. Esos comandos remotos NO se ejecutaron (solo su ayuda).

- `npm test`: 323/323 (313 previas + 10 de OAuth/operador, callback loopback
  simulado y recuperacion), exit 0.
- `npm run typecheck`: exit 0.
- `npm run dry-run`: exit 0, mock intacto, 109.03 KiB / gzip 24.89 KiB.
- `npm run dry-run:prod`: exit 0, plantilla apagada, 109.03 KiB / gzip 24.89 KiB.
- `npm run test:d1`: 1 suite local pasada, exit 0.
- `npm run test:cron`: 1 suite local pasada, exit 0; 20 partes / 7 ticks
  consecutivos simulados, ~19.4 s de prueba (NO tiempo cloud).
- `npm run check:prod -- --config wrangler.production.jsonc`: exit 1
  ESPERADO, `production_config_rejected:placeholders`.
  No atribuir tests locales al proveedor ni dar I8/I9 por ejecutados.
- `node --check` de la CLI/tests: exit 0. `npm run oauth:operator -- --bad`
  falla cerrado con `oauth_operator_failed:arguments` (exit 1).
- La prueba de loopback usa `OAuthClient` real y transporte token simulado; no
  abre browser, no contacta ITAD ni usa D1 remota. Wrangler remote bindings,
  autenticacion, callback real y provisioning no se han probado ni ejecutado.

Entrega QA: probar plantilla apagada/mock intacto, rechazo de placeholders,
separacion activacion/parada, sin secretos. I8 aun requiere permisos y
verificacion real de cuenta/callback/clave/version, primer provision/reauth y
lectura D1. I9 sigue bloqueado por capacidad Cloudflare no medida y permisos;
despues de esos gates se comprueban baseline, ticks/gate >=300 s,
recibos/backlog/reinicio/refresh persistido en cloud.
**Parar tras preparacion: no se ejecuto OAuth, binding remoto, escritura D1,
deployment, cron ni mensaje Telegram.**

## 15. Cierre local Rich/bundles y preview — 2026-11-01

Archivos de este cierre: `scripts/telegram-preview.mjs` (nuevo),
`tests/telegram-preview.test.mjs` (nuevo), `package.json` (`preview:telegram`),
`README.md`, `docs/I5.md`, `docs/I7-operacion.md`. Sin cambios adicionales a
fuentes del puente ni a migración 0005; no se ha repetido investigación histórica.

| Comprobación ejecutada | Resultado real |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **612/612**, 16 archivos, exit 0; incluye **31** pruebas preview y 12 de simulación grande |
| `npm run test:d1` | 1 suite local pasada, migraciones/planes Rich/bundles/CAS/reinicio, exit 0 |
| `npm run test:cron` | 1 suite local pasada; Rich 20 partes en 7 ticks `[3,3,3,3,3,3,2]`, baseline bundles y marcas, reinicio/solapamiento/429/403; drenaje medido 19.400 ms local |
| `npm run dry-run:prod` | exit 0, 140,23 KiB / gzip 32,49 KiB, plantilla apagada, sin deploy |
| `npm run check:prod -- --config wrangler.production.jsonc` | exit 1 **esperado**, `production_config_rejected:placeholders` |
| `npm run check:prod -- --config wrangler.production.local.jsonc --activate` | exit 0, `production_config_valid_offline_only`; sin mostrar contenidos, no prueba cloud |
| `node --check scripts/telegram-preview.mjs` y `node --check tests/telegram-preview.test.mjs` | exit 0 |
| CLI preview `--dry-run` y `--dry-run --no-banner` | cada una exit 0, tres ejemplos, sin imagen con `--no-banner`; transporte live no usado |

Verificados archivos persistentes y **0** temporales `itad-telegram-preview-*`
restantes. Primer pase focalizado detectó un error de parametrización `it.each`
en las nuevas pruebas (8 fallos); corregido antes del pase completo final.
Las pruebas live del script inyectan transporte **simulado**, no tokens reales.
No instalación de dependencias, commit/push, lectura de archivos de secretos,
OAuth real, deploy, operación cloud ni mensaje real en este encargo.

**Cierre histórico anterior a los deploys:** render móvil, moneda ES, CPU/cuotas
Free, continuidad real y aviso natural con correo desactivado seguían externos.
Su frase «rediseño local no desplegado» describe solo ese cierre y no el intento
posterior documentado abajo.

## 16. Intento autorizado de actualización — 2026-11-01

Permiso recibido: lectura de metadatos Cloudflare/D1, migración 0005 remota
si era la única pendiente y despliegue conservando el cron activo existente.
Esta autorización no incluyó parada, secretos, OAuth/refresh manual,
modificaciones de baseline/gates/colas ni ejemplos Telegram.

### Ejecutado realmente

- `git --no-pager status --short`: sin cambios al comenzar.
- `git --no-pager log -1 --format="%h %s"`:
  `3010b5c feat: update design`. No se comprobó el estado de `main` remoto.
- `node --version`: `v24.14.1`; wrapper Wrangler local: `4.153.0`.
- Lectura de README, instrucciones del proyecto y secciones operativas
  pertinentes; revisión de la migración aditiva 0005 y del validador offline.
- `npm run check:prod -- --config .\wrangler.production.local.jsonc --activate`:
  exit **0**, `production_config_valid_offline_only`.
- Comprobación selectiva de configuración pública: Worker
  `itad-telegram-bot`, D1 `itad-telegram-db`, binding `DB`;
  `APP_MODE=production`, `LIVE_DELIVERY=enabled`, cron `* * * * *`,
  `workers_dev=false`, `preview_urls=false`, sin rutas configuradas.
  No se imprimieron config completa, IDs ni callback.
- Ayuda local de `deployments list`, `triggers` y `tail`, sin operaciones
  de escritura. Un primer comprobador suplementario tuvo un error de comillas
  PowerShell/Node; se corrigió mediante stdin y pasó, sin operación cloud.
- Única operación remota intentada:

```powershell
node .\node_modules\wrangler\bin\wrangler.js d1 migrations list DB --remote --config .\wrangler.production.local.jsonc --env-file NUL
```

Se ejecutó mediante `spawnSync` con timeout de 90 s y salida capturada en
memoria para filtrar evidencia. `--env-file NUL` evitó cargar `.env`;
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false` y
`WRANGLER_SEND_METRICS=false` se fijaron solo para el proceso.
Resultado: exit **1**, `remote_read_failed; raw_output_suppressed`.
No se obtuvo lista ni causa sanitizada: no atribuir el fallo a permisos,
autenticación, conectividad o esquema sin nueva evidencia.

### Continuacion verificada del intento

La consulta remota posterior sin `--env-file NUL` paso (exit 0); no se ha
determinado la causa del primer fallo. Solo 0005 estaba pendiente:
`d1 migrations apply DB --remote --config .\wrangler.production.local.jsonc`
la aplico correctamente. Una nueva lista no mostro pendientes y la consulta de
metadata confirmo columna `format TEXT` y tabla `bundle_state`.
`deploy --autoconfig=false` termino con exit 0 y trigger `* * * * *`.
Version `02994b02-61e2-4a3a-a96d-18bf1fc70525` comprobada en deployments.
No se cambiaron secretos ni se hizo OAuth o envio manual de ejemplos.

### Checklist hecho / pendiente (actualizado)

| Control | Evidencia |
| --- | --- |
| Checkout y configuración activa offline | Hecho; resultados anteriores |
| Lista de pendientes remotas, solo 0005 | Hecho, exit 0 tras el primer fallo |
| Aplicar 0005 por mecanismo de migraciones Wrangler | Hecho |
| Lista pendiente vacía y migraciones aplicadas | Hecho |
| Metadata de columna `delivery_parts.format` y tabla `bundle_state` | Hecho |
| Deploy con `--autoconfig=false`, mensaje descriptivo y cron conservado | Hecho, exit 0 |
| Versión/deployment y triggers remotos | Version verificada; deploy confirmo cron cada minuto |
| Tail acotado de un tick, warnings/errors/poll/bundles | NO iniciado |
| Nombres de secretos / presencia de `ITAD_API_KEY` | NO consultados |
| Render móvil, scopes, moneda ES, continuidad y aviso natural sin correo | Pendientes, no inferibles del check offline |

Se detuvo el procedimiento al primer fallo remoto, sin reintento ni rollback.
No se alteraron config, secretos, cuenta/chat, baseline, gates o colas.
No se publicó HTTP, ni se hizo prueba HTTP, OAuth/refresh manual o envío de
ejemplos. El procesamiento natural del cron preexistente no se deshabilitó;
no se verificó su continuidad remota en este intento.

**Procedimiento historico de recuperacion (ya superado):** diagnosticar en consola privada el fallo de lectura,
sin compartir salida cruda ni credenciales. Antes de continuar, obtener una
lista verificable: si hay pendientes inesperadas además de 0005, bloquear.
Solo después de confirmar que 0005 es la única pendiente, aplicar mediante
Wrangler, verificar lista vacía/esquema aditivo y desplegar la copia activa
conservando identidad y cron. No resetear estado ni hacer rollback automático.

No se crearon recursos ni se instalaron dependencias. Coste de este intento
no cuantificado; plan/cuotas/CPU de Workers + D1 siguen sin verificar.
Config local activa no constituye evidencia de despliegue ni de salud funcional.
Solo se editaron `README.md` y este documento; sin commit/push.

Siguiente comando para el usuario, exclusivamente si decide autorizar los tres
ejemplos y en terminal privado interactivo; no necesita desplegar el script:

```powershell
npm run preview:telegram -- --live
```

No lo ejecutó el agente. Exige entrada oculta de token/chat y confirmación
`ENVIAR 3 EJEMPLOS`; el render móvil sigue pendiente.

## 17. Intento autorizado de despliegue Rich v4 — 2026-11-01

Permiso: desplegar el árbol actual en el Worker existente mediante
`wrangler.production.local.jsonc`, conservando `LIVE_DELIVERY=enabled`, cron
`* * * * *` y valores/secretos actuales. No incluía migraciones nuevas,
modificar secretos/configuración/estado, OAuth manual, llamadas reales de prueba,
mensajes manuales ni cambios de correo. No se reinstalaron dependencias.

### Ejecutado realmente

- `git --no-pager status --short`: worktree con cambios acumulados autorizados
  en README, docs, formatter/helper, simulación y fixtures/tests; no se revirtió
  nada. `git diff --check` y `git diff --cached --check`: exit 0.
- En la lectura final, `git status --short` mostró solo `README.md` y
  `docs/I7-operacion.md` como modificados; `HEAD` se observó como `f2f99e0`.
  No ejecuté commit ni push. La diferencia respecto del estado inicial no se
  atribuye a una acción del agente ni se intentó reconstruir/revertir.
- `npm run check:prod -- --config .\wrangler.production.local.jsonc --activate`:
  exit 0, `production_config_valid_offline_only`.
- `npm run typecheck`: exit 0.
- `wrangler deploy --dry-run --config .\wrangler.production.local.jsonc
  --env-file NUL`: exit 0; bundle temporal eliminado. Sin deploy durante el dry-run.
- `node .\node_modules\wrangler\bin\wrangler.js deploy --config
  .\wrangler.production.local.jsonc --autoconfig=false --message "Deploy
  approved compact Rich v4 design"`: exit 0. La salida cruda se suprimió para
  evitar filtrar datos de cuenta/configuración.
- `wrangler deployments list --config .\wrangler.production.local.jsonc`:
  exit 0. Inicialmente se interpretó el primer registro
  `024ac491-0fcf-4a67-a34f-cb9bdc71aa8c` como reciente; corresponde realmente
  a un cambio de secreto del 2026-10-31 a las 20:38 UTC.
- `wrangler deployments status --config .\wrangler.production.local.jsonc`:
  exit 0, metadata de versión actual
  `a246f649-1b2b-40f8-98f5-f026acc1229b`, al 100%, mensaje autorizado.
- Comprobación final: ambos comandos repetidos, exit 0; el último registro del
  listado coincide con status, creado el 2026-11-01 a las 01:53:39 UTC.
  Versión nueva activa confirmada sin efectuar otra escritura.
- La configuración inspeccionada mantiene el cron cada minuto y live delivery.
  `deployments status` no expuso el cron; conservación remota posterior no
  verificada. No se inició tail ni espera de tick.
- No se consultó ni modificó D1; no se ejecutó migración alguna. No se leyeron
  secretos ni se ejecutaron OAuth/refresh, ITAD/Telegram reales, envíos manuales,
  pruebas HTTP públicas o cambios de cuenta/chat/baseline/gates/colas.
- No commit ni push.

### Checklist posterior

| Control | Evidencia |
| --- | --- |
| Check offline con configuración activa, typecheck y dry-run producción | Hecho, exit 0 |
| Deploy del mensaje autorizado | Hecho, exit 0 |
| Versión nueva presente en `deployments list` | Hecho: `a246f649-1b2b-40f8-98f5-f026acc1229b` |
| Versión nueva confirmada como actual/activa | Hecho: `deployments status` coincide, 100% |
| Cron remoto `* * * * *` después del deploy | **No verificado** por metadata disponible; no se esperó tick |
| Render real, oferta natural, scopes, salud y cuotas | Pendientes; no inferibles del deploy |

La discrepancia inicial quedó resuelta mediante lecturas de metadata y revisión
de fechas, sin reintentar deploy, rollback, cambio de triggers ni otra escritura
remota. La versión nueva está activa. El cron remoto y la salud funcional quedan
pendientes de observación; no se infieren del estado de la versión.

Los checks son locales; no prueban render Telegram, procesamiento de tick,
entrega, continuidad OAuth ni correo. No se cuantificó coste cloud. Alojamiento:
Worker existente + D1 existente; no se crearon recursos ni rutas HTTP públicas.

## 18. Despliegue autorizado de reglas finales Rich — 2026-11-01

Permiso explícito: deploy de todo el árbol actual, sin omitir ajustes aprobados,
en `itad-telegram-bot` con `wrangler.production.local.jsonc`. No se exigió rama
ni se revirtieron cambios; Git estaba limpio al inicio. Solo se editaron README
y este documento después del deploy. Sin stage/commit/push ni hooks.

### Comandos ejecutados y resultados

Desde la raíz del proyecto, PowerShell:

```powershell
git --no-pager status --short
git --no-pager diff --check
npm run check:prod -- --config .\wrangler.production.local.jsonc --activate
npm run typecheck
npm test -- --no-file-parallelism
# $tmp: directorio exclusivo itad-prod-dryrun-<UUID> en GetTempPath();
# salida Wrangler capturada en memoria y filtrada, eliminación en finally.
node .\node_modules\wrangler\bin\wrangler.js deploy --dry-run --config .\wrangler.production.local.jsonc --autoconfig=false --outdir $tmp
node .\node_modules\wrangler\bin\wrangler.js deploy --config .\wrangler.production.local.jsonc --autoconfig=false --message "Deploy final Rich display rules and subtle expiry"
node .\node_modules\wrangler\bin\wrangler.js deployments status --config .\wrangler.production.local.jsonc --json
node .\node_modules\wrangler\bin\wrangler.js deployments list --config .\wrangler.production.local.jsonc --json
```

Todos exit **0**. Check: `production_config_valid_offline_only`. Suite:
**663 tests, 18 archivos**, 16,49 s en serie; incluye Rich, bundles, contratos
oficiales y ambos previews. Warning SQLite experimental, sin fallos.
Dry-run: **139,02 KiB / gzip 32,05 KiB**, temporal eliminado y comprobado.
Deploy: mismo tamaño, startup **4 ms**, upload **6,21 s**, triggers **3,12 s**:

```text
Deployed itad-telegram-bot triggers (3.12 sec)
  schedule: * * * * *
Current Version ID: a5249f58-4e5a-4c78-9df8-1aa26b73c7a6
```

Metadata: deployment `392dde8f-ba15-4ac3-b1b0-fd2a23a346f3`,
creado **2026-11-01T11:46:48.755025Z**, fuente `wrangler`,
`workers/triggered_by=deployment`, mensaje autorizado, una sola versión al
**100%**. Autor presente y coincidente en status/list; identidad redactada.
El listado de diez registros está en orden **antiguo primero**: el último
coincide con status y es el nuevo deploy. Versión antes activa:
`a246f649-1b2b-40f8-98f5-f026acc1229b`. No hubo reintento ni rollback.
No se mostraron bindings, valores privados, contactos o secretos.

### Checklist y límites para QA

| Control | Resultado |
| --- | --- |
| Árbol completo aprobado, cero % omitido, tier null sin precio, notas omitidas, footer nativo y resto v4 | Incluido en deploy; suite offline aprobada |
| Check activo offline, typecheck, tests y dry-run config real | Exit 0 |
| Temporal de dry-run | Eliminado |
| Versión persistida activa, mensaje/autor/fecha y último registro | Coinciden; 100% |
| Cron cada minuto | Confirmado por salida de triggers del deploy, no por status |
| Config existente | `APP_MODE=production`, `LIVE_DELIVERY=enabled`, `workers_dev=false`, `preview_urls=false`, sin routes/route; intacta |
| D1/secrets/config/migraciones/dependencias/OAuth/refresh/baseline/gates/colas/key/scopes | Sin modificaciones ni operaciones manuales |
| Tick funcional, recuperación, render móvil y oferta real sin correo | Pendientes; no se disparó HTTP/mock ni pruebas ITAD/Telegram reales |
| Bundles | `off` según logs conocidos del usuario; no verificado de nuevo ni alterado |

Se conserva el cron natural preexistente; podría ejecutar producción y sus
operaciones normales, pero no se observó ni provocó un tick. No se inició tail.
No se crearon recursos ni rutas públicas. Costes nuevos de infraestructura:
ninguno provisionado; consumo Workers/D1 sujeto al plan existente, no medido.
La metadata activa y el trigger no prueban entrega, salud OAuth, cuotas,
aceptación del footer por Telegram ni independencia del correo. Preview
oficial validado offline; ejemplo real Telegram pendiente de autorización
y ejecución del usuario, sin deshabilitar la Waitlist. No ejecutar
reaprovisionamiento histórico de §§1–17 por este deploy.

## 19. Despliegue autorizado de ajustes Rich — 2026-11-02

**Registro histórico**: esta sección describe el despliegue anterior a los
últimos ajustes. Ver [seguimiento local, Colección/EUR y QA](ejemplos-oficiales-preview.md#seguimiento-local-no-desplegado--2026-11-02)
y el estado posterior en la sección 20. La versión histórica de esta sección
no es la actualmente activa.

El usuario autorizó publicar en Telegram los cambios de presentación Rich
aprobados: quitar la tienda duplicada bajo el precio, caducidad con día y mes,
etiqueta de mínimo histórico y marcas distintas para Waitlist y Colección.
Despliegue al Worker existente `itad-telegram-bot` con
`wrangler.production.local.jsonc`; sin cambios de código durante la operación.

### Comprobaciones y ejecución

Antes del despliegue, `git status --short`, `git diff --check` y
`git diff --cached --check` mostraron 14 rutas locales modificadas y ningún
error de formato. `npm run check:prod -- --config .\wrangler.production.local.jsonc --activate`,
`npm run typecheck`, `npm test -- --no-file-parallelism` y
`wrangler deploy --dry-run --config .\wrangler.production.local.jsonc --autoconfig=false`
terminaron con exit **0**. El directorio temporal del dry-run fue eliminado y
comprobado.

Deploy ejecutado con exit **0**:

```powershell
node .\node_modules\wrangler\bin\wrangler.js deploy --config .\wrangler.production.local.jsonc --autoconfig=false --message "Deploy approved Rich display tweaks"
node .\node_modules\wrangler\bin\wrangler.js deployments status --config .\wrangler.production.local.jsonc --json
node .\node_modules\wrangler\bin\wrangler.js deployments list --config .\wrangler.production.local.jsonc --json
```

La verificación de `status` coincide con el último registro de `list`:

| Dato | Resultado |
| --- | --- |
| Worker | `itad-telegram-bot` existente |
| Versión activa | `9eedc6a6-7599-4350-aaa9-3250e58e1cdb` |
| Tráfico | 100 % |
| Creación | `2026-11-02T12:35:26.659386Z` |
| Mensaje | `Deploy approved Rich display tweaks` |
| Trigger reportado en metadata | `deployment` |

No se modificaron variables/configuración, secretos, D1, migraciones, recursos
ni rutas. No se hizo stage/commit/push, rollback, OAuth, solicitud HTTP de
prueba, tick manual ni envío a Telegram. La comprobación de metadatos no
demuestra que el cron haya ejecutado, que una oferta real se procese o cómo se
vea en clientes Telegram; esos puntos siguen pendientes. No se cuantificó el
coste cloud.

## 20. Reautorizacion del usuario y revision de cierre — 2026-11-02

La reautorización y las lecturas siguientes son anteriores a la publicación
Unicode documentada al final de esta sección. La versión `613fede8-…` ya es
histórica; el estado D1 y el ciclo aquí observados no se reconsultaron tras
el nuevo deploy.

El usuario ejecutó parada, reautorización y reactivación. Su salida de OAuth
confirma `notifications wait_read coll_read` y escritura/lectura verificada.
La sesión pasó de versión 3 a 4, conservando la versión de clave.
El usuario desplegó su checkout con mensaje `Reauthorize with coll_read`.

Comprobaciones posteriores del asistente, exclusivamente de lectura:

- `check:prod --activate`: configuración local válida, no prueba remota.
- `deployments list`: versión `613fede8-8bc1-4967-bed8-ffcbb3dc9fbd`
  al 100 %, creada `2026-11-02T22:18:58.751Z` (registro de deployment).
- `versions view`: `LIVE_DELIVERY=enabled`, handlers `fetch, scheduled`,
  binding D1 y nombres de secretos necesarios presentes; no se leyeron valores.
- `d1 migrations list DB --remote`: ninguna migración pendiente.
- `tail --format json`, cerrado tras observación: cron `* * * * *`,
  versión anterior indicada, `bridge_cycle.ok=true`, 24 avisos listados,
  sin errores/advertencias ni envíos en el ciclo observado.
- SELECT agregados D1: 3 partes confirmadas, ninguna pendiente/bloqueada,
  ningún detalle bloqueado ni flag; ambos baselines completos; sesión 4.
  Último poll observado `listed`, completado a las `22:27:33 UTC`.
  Próxima revisión de bundles programada para `22:35:25 UTC`, sujeta al gate
  de consultas y la ejecución real del cron.

La primera consulta agregada con UNION fue rechazada por el límite D1 de
compound SELECT. Se sustituyó por ocho SELECT separados, todos correctos,
con cero filas escritas. No hubo modificaciones remotas del asistente,
OAuth/refresh manual, tick forzado, envío de prueba ni despliegue.

Límites: no se comparó byte a byte el código remoto con el checkout. El ciclo
observado tenía `bundles.state=not_due`: no demuestra todavía lectura de
Colección. Una lista `collection=[]` persistida no distingue falta de scope,
fallo de consulta ni respuesta realmente vacía. Los planes antiguos no se
recalculan; el bundle 16765 conserva su snapshot sin marcas.
La próxima oferta y el render móvil real requieren un evento externo.

### Revision completa offline y correccion posterior

ITAD QA revisó el diff y el flujo completo sin editar ni acceder a producción.
La primera suite completa tuvo 710 aprobados y 2 fallidos: expectativas antiguas
de banner con Waitlist vacía, incompatibles con la decisión actual del usuario.
Además reprodujo un banner con surrogate aislado que generaba HTML mal formado;
era un caso sintético, no un fallo observado en producción.

ITAD Implementacion corrigió `safeImageUrl` para rechazar Unicode mal formado,
permitiendo usar el siguiente asset seguro o enviar sin imagen. Añadió cobertura
y reconciliación de expectativas de contratos oficiales.

- Suite completa final: **713 tests / 19 archivos aprobados**, exit 0.
- `npm run typecheck` y `git diff --check`: exit 0 tras las correcciones.
- `npm run test:d1` y `npm run test:cron`: exit 0 en QA; cron local drenó
  17 partes en 6 ticks (3/3/3/3/3/2).
- Ambos previews `--dry-run`, con y sin banner: exit 0 en QA.
- Warning SQLite experimental, sin afectar las pruebas.

La corrección de Unicode y sus tests son posteriores al despliegue del usuario;
se publicaron después con la autorización y evidencias siguientes.
Los cambios documentales permanecen locales. No se hizo commit/push.
Las pruebas simuladas no garantizan descarga/render real ni exactly-once ante
pérdida de recibos; los planes ya guardados no se recalculan.

### Publicación autorizada de la corrección Unicode — 2026-11-02

Permiso explícito del usuario: «Súbela». Se publicó el checkout dirty aprobado
completo, sin revertir los cambios anteriores ya desplegados por el usuario,
sin commit/push ni cambios de aplicación durante esta operación.
El diff confirma `value.isWellFormed()` en `safeImageUrl`: rechaza surrogates
aislados, permitiendo el siguiente asset seguro o ausencia de imagen.
No aparecieron cambios inesperados ni diferencias de configuración,
dependencias o migraciones. No se leyó `claves.local.txt`.

Comandos desde la raíz (PowerShell, salida cloud capturada en memoria y
filtrada para omitir identidades y valores privados):

```powershell
git --no-pager status --short
git --no-pager diff --check
git --no-pager diff --cached --check
npm run check:prod -- --config .\wrangler.production.local.jsonc --activate
npm run typecheck
# $tmp exclusivo; eliminación en finally y comprobación de ausencia:
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) 'itad-prod-unicode-dryrun-cbfd1506-a09f-4b26-a566-ca381264c723'
node .\node_modules\wrangler\bin\wrangler.js deploy --dry-run --config .\wrangler.production.local.jsonc --autoconfig=false --outdir $tmp
node .\node_modules\wrangler\bin\wrangler.js deploy --config .\wrangler.production.local.jsonc --autoconfig=false --message "Fix malformed Unicode rejection in safeImageUrl banners"
node .\node_modules\wrangler\bin\wrangler.js deployments status --config .\wrangler.production.local.jsonc --json
node .\node_modules\wrangler\bin\wrangler.js deployments list --config .\wrangler.production.local.jsonc --json
node .\node_modules\wrangler\bin\wrangler.js versions view cfcd14fb-0843-4481-8217-d8484b138e63 --config .\wrangler.production.local.jsonc --json
```

Resultados verificados:

| Control | Evidencia |
| --- | --- |
| Diff/formato, check activo offline y typecheck | Exit 0; `production_config_valid_offline_only` |
| Suite completa | 713 tests / 19 archivos aprobados en la revisión anterior; **no repetida** en esta operación, sin cambios inesperados |
| Dry-run | Exit 0; 139,61 KiB / gzip 32,13 KiB; temporal indicado eliminado; hash de config intacto |
| Deploy | Exit 0; mismo tamaño; startup 2 ms, upload 6,68 s, triggers 2,97 s |
| Versión activa | `cfcd14fb-0843-4481-8217-d8484b138e63`, una sola versión al 100 % |
| Fecha de versión (`versions view`) | `2026-11-02T22:38:34.406885Z` |
| Deployment | `1e83d8d1-d946-4f16-8e1a-b3c267ab0727`, `2026-11-02T22:38:35.842788Z` |
| Status/list | Coinciden con el registro más reciente ordenado por fecha, mensaje autorizado y autor (redactado) |
| Trigger | Metadata `deployment`; salida del deploy confirma `schedule: * * * * *` |
| Configuración remota | Bindings completos y runtime idénticos a metadata de `613fede8-…`; handlers `fetch,scheduled` |
| Vars/D1 | `APP_MODE=production`, `LIVE_DELIVERY=enabled`, key version `k2`; vars públicas y DB ID coinciden con config local; callback, nombres de bindings/secretos y base D1 preservados |

Worker y D1 existentes; `workers_dev=false`, `preview_urls=false`, sin rutas
en la configuración conservada. No se crearon recursos; coste nuevo
provisionado: ninguno. Consumo Workers/D1 sujeto al plan existente, no medido.
La comparación utilizó metadata, no valores de secretos ni descarga de código
remoto para comparación byte a byte.

No hubo OAuth/refresh manual, cambios de secretos, migraciones, consultas o
escrituras D1 directas, manipulación de cola/baselines/gates, tick forzado,
tail, requests HTTP de prueba ni mensajes de prueba. El cron natural permanece
habilitado y puede efectuar las operaciones normales del servicio.
No se observó en esta operación un tick funcional, lectura real de Colección,
render móvil, descarga de banner, entrega ni oferta natural sin correo.
Las comprobaciones D1/ciclo previas conservan únicamente su contexto anterior.
Sin rollback ni reintento de deploy. Operación remota terminada tras verificar
versión y configuración; solo README y este documento se actualizaron después.

## 21. Intento autorizado de publicar observability — 2026-11-02

Permiso explícito: «Sube el código», sobre el checkout actual y el Worker
existente `itad-telegram-bot`, con `wrangler.production.local.jsonc`.
Mensaje previsto: `Enable Workers Logs and invocation logging`.
**No se ejecutó el deploy:** la condición de detenerse ante un fallo se aplicó
al dry-run. No hay ID ni fecha de nueva versión o deployment.

### Evidencias locales ejecutadas

- `git status --short` y `git diff --stat`: 24 rutas tracked modificadas y
  `tests/bundle-banner-storage.test.ts` sin seguimiento; cambios anteriores
  preservados, sin modificaciones de aplicación durante esta operación.
- Diff revisado de `scripts/check-production.mjs`,
  `tests/production-config.test.mjs` y `wrangler.production.jsonc`:
  bloque opcional estricto de observability y su cobertura.
- `npm test -- tests/production-config.test.mjs`: **29 tests / 1 archivo**,
  exit 0, inicio local `2026-11-02 23:52:49` (Europe/Madrid).
- `npm run check:prod -- --config .\wrangler.production.local.jsonc --activate`:
  exit 0, `production_config_valid_offline_only`.
- `git diff --check` y `git diff --cached --check`: exit 0 antes del dry-run.
- Inspección filtrada de config local: `LIVE_DELIVERY=enabled`,
  cron `* * * * *`, binding `DB`, superficie pública desactivada;
  `logs.enabled=true`, `logs.invocation_logs=true`, `traces.enabled=false`.
- Runtime instalado: Node `v24.14.1`, Wrangler `4.153.0`; sin instalación.
  Suite completa anterior de 713 tests no repetida.

### Dry-run fallido y limpieza

Se eligió un temporal exclusivo, comprobado inexistente antes de arrancar:

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) 'itad-prod-observability-dryrun-6249de90-1a2f-45a5-bbdc-d46c2228f563'
$env:WRANGLER_SEND_METRICS = 'false'
$env:CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
# Comando ejecutado, fallido; no usar como receta de arranque:
node .\node_modules\wrangler\bin\wrangler.js deploy --dry-run --config .\wrangler.production.local.jsonc --autoconfig=false --env-file (Join-Path $tmp 'absent.env') --outdir $tmp
```

Wrangler instalado carga por defecto archivos `.env` también en su entrada
global; se intentó evitar esa lectura seleccionando una ruta inexistente.
Node rechazó esa ruta con `not found`, exit **1**. La captura PowerShell con
`ErrorActionPreference=Stop` interrumpió el bloque; `finally` confirmó
`temporary_directory_absent=True` y `config_hash_unchanged=true`.
No hay evidencia de bundle completado ni de dry-run válido.

No se ejecutaron deploy, consultas remotas de metadata, status/list, cron,
D1, tail, OAuth, migraciones, cambios de secretos, manipulación de cola,
envíos manuales ni ticks. No se leyeron `claves.local.txt` ni `.env`.
Solo README y este documento se editaron después; sin commit/push.

La última versión confirmada en la operación anterior es
`cfcd14fb-0843-4481-8217-d8484b138e63`, al 100 % entonces,
creada `2026-11-02T22:38:34.406885Z`; **no reconsultada ahora**.
Cron, vars, bindings, callback y versión de clave locales no se modificaron.
Observability remoto **no confirmado**: únicamente config local validada,
sin deploy en este intento. No se crearon recursos ni se midieron costes;
el consumo natural del Worker/D1 existente continúa sujeto a su plan.

### Continuacion del mismo encargo autorizado

El fallo local se resolvió omitiendo el argumento de archivo inexistente,
con `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false` y métricas desactivadas.
Dry-run exit 0; directorio temporal exclusivo eliminado en `finally`.
No se alteraron los ajustes aprobados ni se requirió una nueva operación OAuth.

Deploy autorizado con mensaje `Enable Workers Logs and invocation logging`:
exit 0, trigger `* * * * *`. `deployments status --json` confirma la versión
`aff935c5-b085-49e2-975d-8691e328490f` al 100 % y el deployment
`2026-11-02T22:54:08.025238Z`. Se publicó el bloque local con logs e invocaciones
activados y trazas desactivadas. No se comprobó por separado la ingesta en el panel.
Sin cambios de secretos, OAuth, migraciones o cola, sin mensajes manuales,
rollback ni commit/push.

## 22. Publicación autorizada de ajustes Rich bundles — 2026-11-03

El usuario autorizó comprobar y publicar el checkout validado en el Worker
existente. Se revisó el diff completo antes de actuar: había **8 archivos
modificados**, uno más que los 7 indicados inicialmente por la petición; el
octavo (`docs/ejemplos-oficiales-preview.md`) documenta las mismas mediciones
y expectativas del cambio visual. No se encontraron cambios ajenos al ajuste,
y no se descartó ni sobrescribió ninguno.

Cambios publicados en `src/bundles.ts`: se elimina el pie decorativo con el
título del juego del banner y se añade `<hr/>` entre bloques de juegos,
incluidas continuaciones dentro de un tier. Pruebas y documentación de preview
actualizadas; los juegos, marcas, enlaces y límites de división se conservan.

### Comprobaciones y despliegue

Comandos desde la raíz en PowerShell:

```powershell
git diff --check
git diff --cached --check
npm run check:prod -- --config .\wrangler.production.local.jsonc --activate
npm test -- --no-file-parallelism
npm run typecheck
# $tmp: directorio temporal exclusivo, eliminado en finally y comprobado ausente.
node .\node_modules\wrangler\bin\wrangler.js deploy --dry-run --config .\wrangler.production.local.jsonc --autoconfig=false --outdir $tmp
node .\node_modules\wrangler\bin\wrangler.js deploy --config .\wrangler.production.local.jsonc --autoconfig=false --message "Deploy approved bundle Rich formatting adjustments"
node .\node_modules\wrangler\bin\wrangler.js deployments status --config .\wrangler.production.local.jsonc --json
node .\node_modules\wrangler\bin\wrangler.js deployments list --config .\wrangler.production.local.jsonc --json
node .\node_modules\wrangler\bin\wrangler.js versions view 272da3c6-6e39-4c09-ac42-a300de85a141 --config .\wrangler.production.local.jsonc --json
```

Resultados observados:

| Comprobación | Resultado |
| --- | --- |
| `git diff --check`, `git diff --cached --check` | Exit 0 antes del deploy |
| `check:prod --activate` | Exit 0, `production_config_valid_offline_only`; no es validación remota |
| Suite completa | **735/735 tests, 19 archivos**, exit 0 |
| `npm run typecheck` | Exit 0 |
| Dry-run | Exit 0; Wrangler 4.153.0; **139.60 KiB / gzip 32.14 KiB** |
| Temporal y configuración | Temporal exclusivo eliminado; hash de `wrangler.production.local.jsonc` intacto |
| Deploy | Exit 0; startup 3 ms; triggers `schedule: * * * * *` |
| Versión activa | `272da3c6-6e39-4c09-ac42-a300de85a141`, **100 %** |
| Creación de versión | `2026-11-03T20:52:38.280082Z` |
| Deployment | `89d005e2-df9f-4318-8125-17db479d34c2`, `2026-11-03T20:52:39.546785Z` |
| Status y listado | Coinciden con el deployment más reciente y su versión al 100 % |
| Configuración/cron | Worker `itad-telegram-bot`, `LIVE_DELIVERY=enabled`, superficie `workers_dev`/preview desactivada; cron `* * * * *`. Salida de triggers y metadata de bindings/runtime confirman los valores conservados |

La comparación de metadata de bindings/runtime con la versión anterior
`aff935c5-b085-49e2-975d-8691e328490f` dio igualdad; no se imprimieron valores
privados. No se leyeron valores de secretos ni se cambió la configuración local,
D1, migraciones, OAuth, colas, preferencias de correo o recursos. Sin commit/push,
rollback, tick forzado, petición de prueba o mensaje enviado. No se crearon
recursos ni se midió coste; el consumo del Worker/D1 existente depende del plan.

La publicación **no acredita** render móvil, entrega a Telegram, oferta real,
salud de OAuth, ni el comportamiento de Waitlist con el correo desactivado.
Esas comprobaciones siguen pendientes y requieren autorización/acción manual
separada; no se debe desactivar Waitlist para hacerlas.
