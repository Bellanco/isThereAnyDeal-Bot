# Instrucciones del proyecto

## Contexto y alcance

- Leer [README.md](../README.md) antes de trabajar: estado actual y secciones
  pertinentes a la tarea. Las entradas historicas no sustituyen el estado actual.
  Consultar documentos y codigo relacionados, no todo el historial por defecto.
- Responder en espanol; conservar nombres tecnicos y contratos externos.
- Stack acordado: TypeScript estricto, Cloudflare Workers HTTP nativo sin
  framework, Wrangler, Vitest y D1. No volver a elegirlo ni introducir otro
  stack/alojamiento sin una necesidad y decision explicita del usuario.
- Avisos oficiales: OAuth `GET /notifications/v1` y detalle Waitlist cada cinco
  minutos por compuerta durable D1. El tick de un minuto tambien drena pendientes;
  no confundir frecuencia de tick con frecuencia de consultas.
- ITAD conserva las reglas y seleccion de sus avisos. No leer correo, rastrear
  precios ni reproducir sus filtros. Preservar todos los juegos/ofertas y la
  agrupacion por aviso; dividir solo por longitud, sin truncar datos ni enlaces.
- Bundles es un flujo separado: feed oficial `/bundles/v1` cada sesenta minutos,
  pais ES y `mature=true`, cruzado con Waitlist; Coleccion aporta marcas best
  effort. No presentarlo como notificaciones oficiales de bundles. Respetar
  habilitacion, permisos y degradacion existentes; no descartar juegos o niveles.
- Conservar baselines independientes de avisos y bundles: registrar historicos
  sin enviarlos y no repetir la inicializacion tras reinicios.
- Telegram Rich y planes antiguos de texto deben seguir siendo compatibles.
  Respetar las decisiones visuales vigentes: omitir un campo en presentacion no
  autoriza borrarlo de validacion, payload o persistencia.
- El webhook heredado es exclusivamente mock local. No publicarlo, registrarlo
  en ITAD ni convertirlo en la entrada de produccion.

## Correccion y permisos

- Verificar contratos con fuentes oficiales enlazadas en el README. No inventar
  campos, firmas, cabeceras, limites, reintentos ni capacidades de ITAD/Telegram.
- Validar entradas externas y limitar el envio al chat configurado. No extraer
  destino/credenciales de payloads ni tratar IDs o cabeceras no garantizadas
  como autenticacion. No modificar enlaces ni eliminar parametros de afiliado.
- Confirmar entregas solo despues de un recibo valido. Preservar reservas CAS,
  planes y recibos durables; explicitar errores parciales y riesgo de duplicados
  si se pierde una confirmacion. No prometer entrega exactamente una vez.
- Tratar errores explicitamente, con registros sanitizados y sin falsos exitos.
  No silenciar fallos requeridos ni convertirlos en datos vacios; distinguirlos
  de degradaciones opcionales documentadas.
- Secretos fuera del repositorio; no leer archivos locales de claves para una
  revision rutinaria ni mostrarlos en chat, logs, URLs, ejemplos o capturas.
  El usuario los introduce localmente o en el gestor del proveedor.
- Las pruebas simulan servicios externos por defecto. Implementar o ejecutar
  pruebas locales NO autoriza OAuth/refresh reales, mensajes, cambios de cuenta,
  lecturas remotas operativas, migraciones, recursos ni despliegues. Exigir
  autorizacion especifica para cada alcance externo y devolver bloqueos al padre.
- No afirmar que desactivar correo conserva la generacion de avisos sin evidencia.
  Separar el canal de correo de los ajustes de notificacion de Waitlist.

## Eficiencia y entrega

- Reutilizar patrones y dependencias existentes; cambios precisos y completos,
  sin refactors ajenos. Respetar cambios previos del worktree.
- Leer [package.json](../package.json) y los arneses pertinentes antes de ejecutar
  comandos. Empezar por pruebas afectadas y escalar solo con motivo; no inventar
  comandos, instalar herramientas por rutina ni dejar procesos de QA activos.
- En Windows usar PowerShell y rutas nativas para comandos; no asumir sintaxis
  Unix ni matar procesos por nombre. Limpiar solo temporales propios identificados.
- Actualizar documentacion directamente relacionada sin reescribir antecedentes.
  Entregar archivos cambiados, comandos/resultados, criterios no verificados y
  permisos pendientes. Diferenciar pruebas simuladas, D1 local, dry-run,
  despliegue y entrega/render reales; una preview no prueba Telegram.
