# isThereAnyDeal -> Telegram

Proyecto para recibir en Telegram las ofertas de la Waitlist de IsThereAnyDeal,
sin utilizar el correo como intermediario.

## I7: preparacion operativa (no desplegado)

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
GET. La prueba fue puntual; no verifico continuidad durante dias. No quedan
tokens almacenados. Sigue pendiente observar un aviso nuevo con el correo
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
cada tick. Un aviso de 20 partes se entrega en 7 ticks (~6 min) en vez de 7
ciclos de 5 min. Ver [I5](docs/I5.md#i6-tick-cada-minuto-y-compuerta-durable-de-consultas-itad).
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
No se ha desplegado ni enviado ningun mensaje real a Telegram.

Base ejecutable local. El flujo mock heredado y el cliente OAuth de aplicacion
siguen sin llamadas externas; D1 se prueba solo mediante un Worker temporal de
QA local. Decisiones confirmadas:
TypeScript estricto, HTTP nativo de Cloudflare Workers sin framework, Wrangler
para desarrollo local, Vitest para pruebas y Cloudflare D1 para persistencia.
No hay bindings ni recursos D1 cloud.

El cliente Telegram y el modo `production` existen pero fallan cerrados sin
`LIVE_DELIVERY=enabled` y secretos; nunca se han ejecutado contra servicios
reales. La CLI OAuth/operador existe pero no se ha ejecutado. No hay frontend,
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
20 partes. `npm run dev:cron` y `npm run db:local:migrate`
permiten repetirlo a mano (ver [I5](docs/I5.md)).

`npm run test:d1` aplica [migrations/0001_i4_storage.sql](migrations/0001_i4_storage.sql),
[migrations/0002_i5_delivery.sql](migrations/0002_i5_delivery.sql),
[migrations/0003_i6_detail_claims.sql](migrations/0003_i6_detail_claims.sql) y
[migrations/0004_i6_poll_gate.sql](migrations/0004_i6_poll_gate.sql)
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
mensaje si cabe. Incluye titulo de juego, tienda, precio/moneda/descuento,
enlace intacto y, cuando existen, cupon, caducidad, DRM/plataformas y precios
de referencia; diferencia precio habitual, anterior y minimos. Tambien muestra
fechas e indicador ITAD sin inventar reglas de seleccion. Es texto plano, no
una copia visual del correo. Cada parte lleva ID del aviso y contador `parte N/M`
si hay varias; todo, incluidos encabezados, cabe en 4096 unidades UTF-16.
No rompe pares Unicode ni divide/trunca/normaliza enlaces, incluidos afiliados.
Una URL que no cabe con encabezado se rechaza antes de cualquier envio.

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

### Pendiente despues de I5

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

## Configuracion futura real

- Bot creado con BotFather y token de Telegram almacenado como secreto.
- Chat de destino autorizado; para un chat privado, el usuario debe iniciar
  primero una conversacion con el bot.
- Worker con cron (I6 local: cada minuto, consultas ITAD cada cinco minutos por la
  compuerta durable) y acceso HTTPS a ITAD y Telegram. Aplicar la migracion 0004.
- OAuth con permiso `notifications`; refresh real se comprobo en I3. En I4 se
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
