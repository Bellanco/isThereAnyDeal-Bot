# Instrucciones del proyecto

- Leer [README.md](../README.md) antes de trabajar. Es la referencia de alcance,
  decisiones pendientes y criterios de aceptacion.
- Responder en espanol. Mantener nombres tecnicos y contratos externos originales.
- El objetivo es trasladar notificaciones oficiales IsThereAnyDeal -> Telegram
  mediante consultas OAuth cada cinco minutos, no leer correo ni rastrear precios.
  ITAD conserva sus reglas y seleccion; preservar todos los juegos/ofertas y la
  agrupacion por aviso. Dividir solo por longitud, sin truncar datos ni enlaces.
  La primera sincronizacion registra historicos sin enviarlos; no repetirla tras
  reinicios. Conservar el webhook mock local, no publicarlo como entrada real.
- No elegir lenguaje, framework, base de datos o alojamiento sin confirmar las
  decisiones que condicionen la implementacion con el usuario.
- Verificar contratos con fuentes oficiales. No inventar campos, cabeceras,
  firmas, reintentos o capacidades de IsThereAnyDeal.
- No afirmar que desactivar el correo conserva los avisos hasta comprobarlo;
  distinguir el canal de correo de la generacion de notificaciones de Waitlist.
- Mantener dependencias y arquitectura simples. Reutilizar patrones existentes
  cuando haya codigo. Evitar abstracciones y funcionalidades fuera del alcance.
- Guardar secretos fuera del repositorio y no mostrarlos en registros, URL
  publicadas, ejemplos ni respuestas. Usar placeholders en la documentacion.
- Validar entradas externas y limitar el envio al chat configurado. No tratar
  identificadores o cabeceras sin garantia documentada como autenticacion.
- No registrar una entrega como completada antes de confirmar el resultado.
  Explicitar las limitaciones de deduplicacion y los fallos parciales.
- No modificar enlaces de ofertas ni eliminar parametros de afiliado.
- Las pruebas deben simular servicios externos por defecto. No autorizar OAuth,
  renovar tokens reales, enviar mensajes, cambiar ajustes ni desplegar recursos
  reales sin autorizacion especifica. El usuario introduce los secretos.
- Ejecutar las comprobaciones pertinentes y actualizar la documentacion
  directamente relacionada. No inventar comandos de build o pruebas.
- Informar archivos cambiados, validaciones ejecutadas y limitaciones pendientes.
