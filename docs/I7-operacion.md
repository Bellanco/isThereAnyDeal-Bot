# I7 — Preparacion de produccion; I8–I9 MANUALES y pendientes

**No desplegado. No cuentas, OAuth, migraciones remotas ni Telegram ejecutados
en I7.** Alojamiento acordado: Cloudflare Workers + D1; TypeScript, HTTP nativo,
sin nuevas dependencias. La capacidad cloud sigue sin verificar.

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
| `DB` | binding D1 con las cuatro migraciones |
| `OAUTH_CLIENT_ID` | var: Client ID publico de la app compatible |
| `OAUTH_REDIRECT_URI` | var: callback EXACTO registrado, HTTP `127.0.0.1` con puerto explicito, sin query/fragmento/credenciales |
| `OAUTH_TOKEN_KEY_VERSION` | var: identificador de clave, 1–32 caracteres `[A-Za-z0-9._-]` |
| `OAUTH_TOKEN_KEY` | Workers secret: AES de 32 bytes, Base64 estandar; nunca D1 ni var |
| `TELEGRAM_BOT_TOKEN` | Workers secret; token del bot, nunca URL mostrada |
| `TELEGRAM_CHAT_ID` | Workers secret por privacidad: entero positivo de chat privado, <= 2^52 |

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
`0003_i6_detail_claims.sql`, `0004_i6_poll_gate.sql`, en orden. `list` muestra
PENDIENTES, no todas las aplicadas. No ejecutar las cuatro SQL manualmente:
`ALTER TABLE` de 0002/0003 no es repetible. Un fallo revierte la migracion
fallida, no las anteriores; revisar antes de reintentar.

## 5. I8 — provisioning y reautorizacion OAuth local

Existe `npm run oauth:operator`, pero **no se ha ejecutado**. Es una herramienta
opt-in: sin `--live`, configuracion production local sin placeholders y una
confirmacion interactiva exacta, falla sin iniciar OAuth ni acceder a D1.
Solo admite OAuth public PKCE y el callback registrado exacto en
`127.0.0.1:8765`; no implementa `client_secret`, endpoint publico, despliegue,
Telegram ni importacion SQL.

Precondiciones operativas que la herramienta no puede demostrar por si sola:

- D1 remota creada y migraciones 0001–0004 aplicadas; Cloudflare autenticado con
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
solo los tres secretos previstos en el entorno Worker; extras tambien pueden
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
23). Desde ese punto los IDs nuevos se guardan aunque tengan `read=true`.
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
`pollGate`, `nextPollInSeconds`, `calls`, `queue`, categorias e indicadores.
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

## 14. Validacion I7 local realizada

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
