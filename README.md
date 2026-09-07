# Mesa (POS VE)

Punto de venta táctil para restaurantes en Venezuela. Next.js App Router, TypeScript, Tailwind, shadcn/ui y Prisma.

Producto: **Mesa**. Copia en español (Venezuela). Un local. IA bloqueada de Sistemas Rest.

**Producción:** Postgres de **Supabase** (persistente).  
**Local:** SQLite (`prisma/mesa.db`) o la misma URI de Supabase.

## Cómo correrlo (local, SQLite)

```bash
cp .env.example .env
# Completa SESSION_SECRET con una clave aleatoria de al menos 32 caracteres.
npm install
npm run db:push
npm run db:seed
npm run dev
```

Abre [http://127.0.0.1:43147](http://127.0.0.1:43147).

## Evidencia Fase 2 (entorno aislado)

No uses producción Café Ávila (`https://mesa-pos-olive.vercel.app`) para ventas demo.

URL aislada (Postgres persistente `isolated_fase6`, folios estables, sin SSO de Vercel): [https://mesa-pos-fase2-demo.vercel.app/evidencia](https://mesa-pos-fase2-demo.vercel.app/evidencia)

PIN 1111. Folios `P2-A-USD`, `P2-B-VES`, `P2-C-MIX`. Comprobante interno.

`/evidencia` desglosa por cobro: entregado bruto, **importe registrado pendiente**, **importe confirmado aplicado al saldo**, vuelto y neto de caja. Un Pago Móvil pendiente no se muestra como aplicado al saldo. En P2-A el pendiente es Bs 100,00 originales y el vuelto real es 0. `/auditoria` (PIN 1111) muestra acciones en lenguaje claro (p. ej. «Salida de efectivo · Bs 500,00»); códigos, JSON y céntimos van en un detalle plegable. `/turno` abre y cierra la gaveta (Fase 4). El chip de estado (Fase 5) distingue Sin conexión / Sincronizando / Al día / Error de sincronización. `/inventario` (Fase 6, solo demo aislado) controla producto terminado: Cachapa con Queso sale con existencias; el resto del menú se vende como hoy. Anular después de enviar a cocina no devuelve comida preparada. **No está publicado en olive.**

Si `prisma/mesa.db` ya existe y `.env` tiene `DATABASE_URL="file:./mesa.db"`, basta `npm install && npm run dev`.

## Acceso y seguridad

En despliegues normales se entra con correo y contraseña. Los botones demo y los PIN
compartidos solo funcionan con `MESA_ISOLATED_DEMO=1`, reservado al entorno aislado.
No actives ese flag para recuperar acceso en producción: también habilita datos demo.

`SESSION_SECRET` es obligatorio: al menos 32 caracteres aleatorios. Genera uno con
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
No se acepta la clave de ejemplo ni la antigua firma pública de desarrollo.
Rotar la clave invalida las sesiones existentes.

Antes de desplegar esta corrección en olive: configura la clave y establece una
contraseña privada para el administrador mediante el procedimiento de administración
de la base de datos. Las contraseñas compartidas del seed son públicas y deben cambiarse;
esta corrección no modifica usuarios ni contraseñas de producción.

`npm run test:auth` (Node 22.3+ con module mocks) verifica las acciones de login,
usuarios inactivos, identidad estable, aislamiento demo y validación de sesiones.

## Usuarios demo (solo entorno aislado)

Clave de todos: `mesa123`. PIN de 4 dígitos en el login.

| Rol | Correo | PIN | Entra a |
| --- | --- | --- | --- |
| Administración | `admin@mesa.ve` | `1111` | `/floor` |
| Cajero | `cajero@mesa.ve` | `2222` | `/floor` |
| Mesero | `mesero@mesa.ve` | `3333` | `/floor` |
| Cocina | `cocina@mesa.ve` | `4444` | `/kds` |

## Origin (código)

Repositorio: [giucp/mesa-pos](https://github.com/giucp/mesa-pos).

## Persistencia en Vercel: Supabase Postgres

El SQLite en `/tmp` de Vercel **ya no se usa**. Los cobros y el menú viven en Supabase.

### Dónde copiar las URI (Supabase)

1. Abre el proyecto en [supabase.com/dashboard](https://supabase.com/dashboard).
2. **Project Settings** (engranaje) → **Database**.
3. **Connect** (o **Connection string** / URI).
4. Elige el formato **URI**.

Copia **dos** cadenas:

| Qué ves en Supabase | Puerto | Variable en Vercel |
| --- | --- | --- |
| **Connection pooling** → modo **Transaction** (a veces “Prisma”) | **6543** · host `*.pooler.supabase.com` · usuario `mesa_runtime.<ref>` o `postgres.<ref>` | `DATABASE_URL` |
| **Direct connection** | **5432** · host `db.<ref>.supabase.co` · usuario `mesa_runtime` o `postgres` | `DIRECT_URL` |

Si la URI del pooler no trae `pgbouncer=true`, añádelo:

`...?pgbouncer=true`

En UIs nuevas: botón **Connect** → pestaña **ORMs** → **Prisma** ya muestra `DATABASE_URL` (6543) y `DIRECT_URL` (5432).

### Variables exactas (Vercel → mesa-pos)

Proyecto: `mesa-pos` (`prj_1EfEQgIlnxe7haVme6Jjz1zUP3Ck`).  
**Settings → Environment Variables** (Production y Preview):

| Nombre | Obligatorio | Valor |
| --- | --- | --- |
| `DATABASE_URL` | Sí, producción | URI **pooler** Supabase, puerto **6543**, `pgbouncer=true` |
| `DIRECT_URL` | Sí, para `prisma migrate deploy` | URI **directa** Supabase, puerto **5432** |
| `SESSION_SECRET` | Sí | Al menos 32 caracteres aleatorios |
| `BCV_RATE_URL` | No | JSON de tasa BCV |

Alias aceptados (por si pegas nombres viejos de Vercel Postgres): `POSTGRES_PRISMA_URL` / `POSTGRES_URL` como pooler; `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING` como directa. El código **prefiere** `DATABASE_URL` + `DIRECT_URL`.

No hace falta Neon Marketplace.

### Después de pegar las URI

1. **Redeploy** de producción (el build corre `prisma migrate deploy` y el seed idempotente).
2. Si `migrate deploy` falla, el despliegue se detiene para evitar publicar código contra un esquema incompleto. Corrige `DIRECT_URL` y vuelve a desplegar.
3. Si `DATABASE_URL` aún no está, la home muestra un mensaje en español (no un crash opaco). El PIN no entra hasta que exista la URI.

### Local contra Supabase

En `.env` (no commitear):

```bash
DATABASE_URL="postgresql://postgres.xxxx:CLAVE@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.xxxx:CLAVE@db.xxxx.supabase.co:5432/postgres"
```

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

## Scripts de base

| Script | Qué hace |
| --- | --- |
| `npm run db:generate` | `prisma generate` (schema Postgres o SQLite según la URI) |
| `npm run db:push` | `db push` (útil en SQLite local) |
| `npm run db:migrate` | `prisma migrate deploy` (Postgres / Vercel) |
| `npm run db:seed` | Semilla Café Ávila (no pisa un local ya sembrado) |
| `npm run db:reset` | Push force-reset + seed (**borra datos**) |
| `npm run test:phase3` | Roles + bitácora en `prisma/mesa-phase3.db` (no toca demo Fase 2 ni producción) |
| `npm run test:phase4` | Apertura única, cierre inmutable, motivo y traspaso en `prisma/mesa-phase4.db` |
| `npm run test:phase5` | Cola, conflictos y cobro recuperable en `prisma/mesa-phase5.db` |
| `npm run test:phase6` | Inventario producto terminado en `prisma/mesa-phase6.db` (no toca olive) |
| `npm run test:phase6:persist` | Misma lógica en Postgres `isolated_fase6` (demo aislado; deja un movimiento en Cachapa) |

El `build` de Vercel: generate → `migrate deploy` si hay Postgres real → seed → `next build`.

## Rutas MVP

**Salón:** `/floor` · `/table/:id` · `/menu` · `/check/:id` · `/pay/:id` · `/split/:id`  
**Cocina:** `/kds` · `/kds/:station`  
**Admin:** `/menu/admin` (Administrar menú) · `/reports/day` (Caja y reportes) · `/staff` · `/auditoria` · `/settings`

## Fase 3 — roles y bitácora

Cada mutación de servidor comprueba el rol. Ocultar un botón no basta.

| Rol | Puede | No puede |
| --- | --- | --- |
| Salón (`3333`) | Pedidos FOH (mesa, ítems, enviar cocina) | Cocina, cobro, anular, descuentos, menú, ajustes |
| Cocina (`4444`) | Preparar, bump, recuperar | Pedidos, cobro, anular, config |
| Caja (`2222`) | Cobrar, confirmar pagos, reportes/fiscal | Anular, descuentos/cortesías, precio/IVA, reabrir, menú |
| Administración (`1111`) | Config + ops sensibles | — |

Ops sensibles (precio/IVA, anulación, descuento, cortesía, reabrir cuenta cobrada) exigen **Administración + motivo** (≥3 caracteres). Quedan en `/auditoria` (solo lectura, append-only). Las confirmaciones de pago también.

`npm run test:phase3` prueba cada rol y que un rechazo directo no muta datos.

## Recorrido caliente

1. Mesero: mesa libre → 2 platos + 1 extra → **ENVIAR COCINA** (≤4 toques).
2. Cajero: **Cuenta** → **Cobrar** → método → confirmar → comprobante interno → cerrada.
3. Cocina: ticket ≤2 s · listo / **Recuperar pedido** 1 toque.
4. Platos no disponibles se ocultan en salón; en cocina sale badge.
5. Admin (`/menu/admin`, PIN 1111): **Nuevo plato**, **Editar** o **Nueva categoría**.

## Deploy Vercel

**URL:** https://mesa-pos-olive.vercel.app  
Alias: https://mesa-pos-giucp-s-projects.vercel.app  
SSO de Vercel desactivado para el demo.

Hasta que `DATABASE_URL` + `DIRECT_URL` estén en el proyecto, producción no puede persistir (ni sembrar) en Postgres. Pega las URI y haz Redeploy.

## Qué no está listo (a propósito)

- **Pagos VE**: dual USD+Bs, mixto, vuelto, tasa BCV. Sin cobro automático bancario.
- **Fiscal**: comprobante interno con RIF, IVA, IGTF y BCV. No es documento fiscal SENIAT. Máquina fiscal / impresora digital no conectadas.
- **Menú**: crear, editar y marcar no disponible.
- **Impresión**: comanda cocina + recibo/precuenta en cola del navegador. No es máquina fiscal.
- **Cola offline (parcial, Fase 5)**: pedidos, mesas, cocina, cobro con id estable e impresión. Chip Sin conexión / Sincronizando / Al día / Error de sincronización. Confirmar pago digital y cerrar turno **no** se confirman sin servidor. No es un modo offline completo.

## Stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind v4 + shadcn/ui · PWA
- Prisma 6 + **Supabase Postgres** (prod) / SQLite (local)
- Sesión local (cookie HMAC)
