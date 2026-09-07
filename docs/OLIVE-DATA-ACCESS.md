# Acceso a datos olive (Café Ávila) — RLS desactivado a propósito

**Proyecto Supabase:** `pos nuevo` (`scysseeqgxpoqmcmhvmh`).  
**App:** https://mesa-pos-olive.vercel.app  
**No activar RLS** en `public` sin políticas pensadas para Prisma `mesa_runtime`. Eso tumbaría el POS.

## Cómo llega la app a Postgres

| Camino | Qué hay |
| --- | --- |
| Servidor | Prisma 6, `src/lib/db.ts` con `import "server-only"`. Mutaciones en `"use server"` (`src/actions/*`). |
| Overlay de deploy | `src/lib/runtime-dsn.ts` (null en git). En olive el install inyecta URIs de **`mesa_runtime`**, no `anon`. |
| Cliente (navegador) | No hay `@supabase/supabase-js`. No hay `NEXT_PUBLIC_SUPABASE_*`. El HTML público no incluye JWT anon ni service_role. |
| API HTTP propia | No hay `src/app/api`. El browser solo habla con Server Actions autenticadas por cookie HMAC. |

Credenciales que **sí** ve el browser: `NEXT_PUBLIC_APP_NAME` (y, en el demo aislado, el flag `MESA_ISOLATED_DEMO`). Nada de claves de Supabase.

Rol de la app olive: **`mesa_runtime`** en el pooler `:6543` / directa `:5432`. No usa la clave `anon` ni `service_role`.

## Por qué RLS sigue apagado

Todas las tablas de `public` tienen RLS **deshabilitado**. `mesa_runtime` no es dueño de las tablas de un modo que bypass automático de RLS sea seguro. Activar RLS sin `POLICY` para ese rol haría que Prisma devolviera 0 filas o permission denied y el login/PIN dejaría de funcionar.

La protección actual es **GRANT**, no RLS:

- `anon` y `authenticated` no tienen SELECT/INSERT/UPDATE/DELETE en las tablas de `public`.
- PostgREST con JWT anon responde **401** / `42501 permission denied` en `User`, `Item`, `Restaurant`, `Check`, `Payment`, `AuditLog`.
- PATCH/POST anónimos al REST también 401.

Verificado (cliente no autorizado, clave anon de proyecto, sin cookie Mesa): GET y mutaciones REST denegadas. `has_table_privilege('anon', '"User"', 'SELECT')` = false. `mesa_runtime` sí puede SELECT.

## Default privileges (ajuste hecho)

`pg_default_acl` dejaba `{anon=arwdDxt…}` para objetos futuros creados por `postgres`. Eso se revocó para el rol actual:

- `REVOKE ALL ON ALL TABLES/SEQUENCES IN SCHEMA public FROM anon, authenticated`
- `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES/SEQUENCES FROM anon, authenticated`

No se pudo cambiar `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` (42501). Si alguien crea tablas como `supabase_admin`, hay que volver a revisar grants. **No** correr `prisma migrate deploy` de Fase 6 contra `public`: añadiría `StockMovement` y columnas de stock al POS en vivo.

## Demo aislado (no mezclar)

El inventario persistente de Fase 6 vive en el **mismo cluster** pero en schema **`isolated_fase6`**, rol **`mesa_isolated`**.

- `mesa_isolated` no tiene USAGE/SELECT en `public` (Café Ávila).
- `anon` / `authenticated` / `mesa_runtime` no leen `isolated_fase6."Item"` ni `StockMovement`.
- PostgREST no expone `isolated_fase6` (API REST = schema `public`).

El build aislado aborta si la URI parece olive (`mesa_runtime` o el ref sin `isolated_fase6`). El build olive aborta si el overlay es `mesa_isolated`.

## Qué no hacer

- No `ENABLE ROW LEVEL SECURITY` en `public` sin un plan de policies que incluya `mesa_runtime`.
- No pegar `anon` / `service_role` en `NEXT_PUBLIC_*`.
- No publicar Fase 6 a `mesa-pos` / olive hasta que Giucp lo pida.
