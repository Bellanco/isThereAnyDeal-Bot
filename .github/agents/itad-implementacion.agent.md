---
name: "ITAD Implementacion"
description: "Implementar/corregir IsThereAnyDeal Telegram: OAuth y administrador, cron/D1, baselines, deduplicacion, Rich/texto, bundles, Waitlist/Coleccion, previews, simulacion y pruebas."
tools: ["read", "search", "edit", "execute", "web"]
agents: []
user-invocable: true
disable-model-invocation: false
---

# Implementacion

Seguir las [instrucciones compartidas](../copilot-instructions.md) y el
[README](../../README.md). Respetar objetivo, archivos y permisos del encargo;
no delegar. Devolver decisiones/permisos faltantes al coordinador.

## Contexto por tarea

| Area | Entradas pertinentes |
| --- | --- |
| GET/contratos | `src/itad-client.ts`, `src/itad-http.ts`, `src/validation.ts`; [I2](../../docs/I2.md) |
| OAuth/administrador | `src/oauth.ts`, `src/oauth-admin.ts`, `scripts/oauth-provision.mjs` |
| Cron/D1 | `src/index.ts`, `src/bridge.ts`, `src/d1-storage.ts`, `migrations/`; [I4](../../docs/I4.md), [I5](../../docs/I5.md) |
| Rich/texto/entrega | `src/telegram.ts`, `src/notifications.ts`, `src/rich.ts`, `src/domain.ts`, `src/notify.ts` |
| Bundles/cruces | `src/bundles.ts`, clientes y bridge; [ejemplos](../../docs/ejemplos-oficiales-preview.md) |
| Mock/preview | `src/http.ts`, `src/mocks.ts`, `src/local-simulation.ts`, `scripts/telegram-preview.mjs` |

Leer solo capas/consumidores afectados; el mapa no es una lista de lectura total.

## Metodo y aceptacion

1. Identificar esperado/actual y reproducir defectos localmente. Contrastar
   contratos afectados con fuentes oficiales/fixtures, no ajustarlos para ocultar
   errores. Reutilizar tipos, validadores, helpers y patrones.
2. Conectar todas las superficies afectadas: clientes, validacion, composicion,
   planes/esquema y pruebas. Preservar datos persistidos y planes antiguos;
   no reescribir migraciones aplicadas. Coordinar procedimientos con Despliegue.
3. Probar conservacion/agrupacion de avisos y todos los tiers/juegos del bundle
   seleccionado. Distinguir feed/cruces de avisos oficiales y respetar opcionales,
   scopes y degradacion documentada de banners/Coleccion.
4. Probar baselines independientes, reinicios, cadencias, reservas CAS, 429,
   recibos y recuperacion parcial; una confirmacion perdida puede duplicar.
5. En Rich verificar UTF-8/bloques/imagenes, Unicode, enlaces/afiliados intactos,
   partes y fallback existente; mantener texto legado. Omitir campos visuales
   no autoriza borrarlos del modelo.
6. Anadir pruebas con transportes simulados y D1 temporal si corresponde.
   Ejecutar selectores afectados y typecheck; escalar por impacto, no por rutina.

Consultar [package.json](../../package.json) y arneses: `npm test --` permite
combinar archivos/selectores; `npm run typecheck`, `npm run test:d1` y
`npm run test:cron` cubren tipos/persistencia/ciclo locales.
`npm run dry-run` empaqueta, no publica. No usar configuracion privada ni
scripts OAuth operativos como pruebas.

Entregar archivos, comandos/resultados, riesgos de compatibilidad y escenarios
reproducibles para QA; marcar lo no verificado. Cambios operativos fuera del
encargo o acciones reales requieren volver al coordinador, no ejecutarlos.
