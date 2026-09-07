# Fase 6 — inventario de producto terminado (solo demo aislado)

**No publicado en olive.** Esperando revisión de Giucp. No se inició Fase 7.

**Despliegue aislado:** `dpl_5kSEkiAyJ5tEyui7ze9dNQnoQCwK` (Postgres `isolated_fase6`, no `/tmp` SQLite). PIN 1111.

## Persistencia (pendiente 1)

El SQLite de `/tmp` en Vercel **ya no se usa** en este demo. Stock, reservas e historial viven en Postgres:

| Pieza | Valor |
| --- | --- |
| Cluster | Mismo proyecto Supabase `pos nuevo` (límite de 2 proyectos Free: no se creó uno nuevo) |
| Schema | `isolated_fase6` (no `public`) |
| Rol | `mesa_isolated` (no `mesa_runtime`) |
| Olive / Café Ávila | Intocable. `public` no tiene `StockMovement` ni columnas de stock en `Item` |

El overlay de deploy (`mesa_isolated` + `schema=isolated_fase6`) se inyecta en install. No va en git. Recargar, otra sesión u otra instancia de Vercel leen la misma base.

Plato con control: **Cachapa con Queso** (apertura 8 un, alerta 2). El resto del menú se vende como hoy.

## Cómo ver el movimiento persistente (pendiente 2)

1. Abre https://mesa-pos-fase2-demo.vercel.app e entra con PIN **1111**.
2. Ve a [/inventario](https://mesa-pos-fase2-demo.vercel.app/inventario) o a [/evidencia#fase6](https://mesa-pos-fase2-demo.vercel.app/evidencia#fase6).
3. Elige **Cachapa con Queso**. En **Historial** debe aparecer  
   **«Entrada persistente Giucp — verifica recarga»** (+2 un, `clientOpId` `p6-giucp-persist-entrada`).
4. Recarga la página o abre otra ventana: el movimiento y las existencias siguen (no vuelven a 8 un de un SQLite de `/tmp`).

Existencias esperadas de Cachapa tras la entrada persistente: **10 un** si no se vendió después (8 de apertura + 2). Si vendiste o mermas en el demo, el historial de esa entrada no desaparece.

## Qué cubre

Producto terminado solamente. Sin recetas, insumos, proveedores ni compras.

| Regla | Implementación |
| --- | --- |
| Control opcional | `stockControlled`, `stockQty`, `stockUnit`, `stockMinAlert`. Sin control = igual que hoy. |
| Entrada / ajuste / merma | Cantidad, motivo, responsable, auditoría e historial. No son ventas. Reintento con el mismo `clientOpId` no suma dos veces. |
| Un momento de reserva | Al **agregar** el plato el servidor descuenta y reserva. `clientOpId` evita doble descuento. |
| Liberar reserva | Quitar línea HELD, bajar cantidad, o anular **antes** de ENVIAR COCINA. |
| Anular después de preparar | FIRED/BUMPED: la comida no vuelve sola al inventario. |
| 86 vs sin existencias | 86 = apagado manual (`available`). Sin existencias = cantidad 0. Stock bajo = ≤ mínimo. |
| Oversell | `updateMany` atómico: dos sesiones no se llevan la última unidad. |
| Offline | Plato controlado exige servidor. No hay promesa de stock sin conexión. |

## Pruebas

`npm run test:phase6` — SQLite dedicado `prisma/mesa-phase6.db`. No toca olive ni el demo persistente.

`npm run test:phase6:persist` — Postgres `isolated_fase6`. Dos sesiones por la última unidad; reintento tras “reload” (nuevo `PrismaClient`, mismo `clientOpId`); deja **un** movimiento en Cachapa.

| Caso | Esperado | Actual |
| --- | --- | --- |
| Entrada 8 (sqlite) | stock 8 | 8 |
| Venta (reserva) | 7 | 7 |
| Anular antes de preparar | vuelve a 7 | 7 |
| Enviar cocina + anular después | se queda 6 | 6 |
| Merma 1 | 5 | 5 |
| Última unidad, dos sesiones | 1 gana, 1 pierde | cumple (sqlite y persistente) |
| Reintento mismo `clientOpId` | no descuenta dos veces | 1 línea |
| Reintento tras recarga (persistente) | no descuenta dos veces | cumple |
| Entrada persistente Giucp | 1 movimiento, +2 un | `p6-giucp-persist-entrada` |
| Plato sin control | se vende igual | Arepa sin cambio de stock |
| Offline + control | bloquea, no encola | `planMutation` → block |

## Olive

`https://mesa-pos-olive.vercel.app/inventario` responde **404** (código publicado: Fases 1–5, commit `f510b8c`). No se corrió `20260907060000_phase6_stock` en `public`. No desplegar este `main` a `mesa-pos`.

Notas de acceso con RLS off: [OLIVE-DATA-ACCESS.md](./OLIVE-DATA-ACCESS.md).
