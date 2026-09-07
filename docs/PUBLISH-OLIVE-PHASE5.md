# Informe de publicación — olive (Fases 1–5)

**Producción:** https://mesa-pos-olive.vercel.app  
**Proyecto Vercel:** `mesa-pos` (`prj_1EfEQgIlnxe7haVme6Jjz1zUP3Ck`)  
**Despliegue publicado:** `dpl_GRPMjTXsjgo1VJbRDyqSBGk78a7w` (reemplaza `dpl_74WFx1hqhnuamQ5txoZ8pwpLpBBB`)  
**Alcance:** Fases 1–5 validadas. **No** incluye Fase 6 (inventario).

El primer publish (`dpl_74…`) servía el login pero el PIN fallaba: el tarball no inyectó el overlay `mesa_runtime` y Prisma usó la URI `postgres.<ref>` del pooler (P1000). Se volvió a publicar **solo Fase 5** (commit `f510b8c`) con el overlay en el install. Login PIN 1111 entra a `/floor`. `/inventario` sigue en 404.

## Qué se publicó

- Canales, dinero/caja, Pago Móvil pendiente fuera de caja (Fase 2).
- Roles y auditoría en lenguaje claro (Fase 3).
- Turno de caja: apertura única (`openLock`), entradas/salidas con motivo, cierre interno (Fase 4).
- Chip de sync Sin conexión / Sincronizando / Al día / Error de sincronización; cola recuperable; cobro idempotente; confirmar pago y cerrar turno son solo servidor (Fase 5).
- `/evidencia` en olive **no** muestra ventas demo: «Esta pantalla solo existe en el entorno aislado. Producción Café Ávila no corre estas ventas demo.»

**No se copió:** ventas P2/P3/P4, usuarios de prueba extra, botones de test, `MESA_ISOLATED_DEMO=1`, ni folios de evidencia.

## Respaldo y rollback

| Pieza | Dónde / cómo |
| --- | --- |
| Datos | Instantánea local `prisma/olive-backup-20260907.json` (gitignored). Antes de migrar: 4 usuarios (Ana/Carlos/María/José), Café Ávila, 24 platos, 16 mesas, 2 cuentas abiertas vacías `A-0002` (DELIVERY) y `A-0003` (TAKEAWAY), folioSeq 3, 0 folios P2. |
| Código | Promover de nuevo `dpl_2Vkr6jWeU8a3mG36Nd2s5hcHLYot` (`isRollbackCandidate: true`). |
| Esquema | Solo aditivo (CashShift, CashMovement, `Payment.shiftId`, `OrderLine.clientOpId`, `openLock`). No borrar tablas/columnas al revertir código. |

**Estado del rollback:** no se usó. No hubo regresión material que exigiera volver atrás.

## Migración

`_prisma_migrations` tenía solo `20260906190000_init`. El `prisma migrate deploy` del build de Vercel falló con P1000 (usuario del pooler `:6543`). El build siguió a propósito para no tumbar el login.

Se aplicó el DDL de Fase 4 y 5 como `mesa_runtime` (GRANT temporal → SET ROLE → migraciones → REVOKE). Checksums:

- `20260907030000_cash_shift` = `696a9437bb2446a0024e2d8558218b2de9b67c1cb4a6a2c2c1227382cccbbb45`
- `20260907040000_phase5_sync` = `0fb8eab11877cb6c4504a6f9f19b53c386145924640eea1ad29d4c778657059f`

Después: CashShift y CashMovement existen; 4 usuarios, 24 platos, 16 mesas, 2 cuentas, 0 folios P2. El seed es idempotente: si el restaurante existe, no crea ventas.

**Recomendación:** `DIRECT_URL` en Vercel debe ser `mesa_runtime` en `:5432` para que el próximo `migrate deploy` no falle. No imprimir URI.

**RLS:** las tablas públicas siguen sin RLS. No activar sin políticas (bloquearía Prisma).

## Verificación en olive

Sin ventas ficticias. No se abrieron mesas ni se cobró.

| Esperado | Resultado |
| --- | --- |
| Login PIN 1111 (Ana) / 2222 / 3333 / 4444 | Cumple tras el redeploy con overlay. Chip **Al día**. Ana Rivas · Administración en `/floor`. Sin enlaces P2. |
| `/evidencia` bloqueada, sin montos P2-A | Cumple. |
| `/floor` `/menu` `/kds` `/reports/day` sin sesión | 307 al login (no 500). |
| `/turno` `/auditoria` sin sesión | 200 HTML de carga / guarda, no 500. |
| `/inventario` | **404** — Fase 6 no se publicó. |
| Runtime 2h | 0 errores agrupados. Códigos 200 en las rutas tocadas. |

Los platos existentes «Cachapa agente» y «Tequeños de prueba» se **conservaron**; no se borraron.

## Estado

Publicación Fase 1–5 en olive **lista para uso**. Fase 6 no se publica aquí.
