# Mesa — IA y módulos

Capa: **FOH** / **KDS** / **ADMIN**. Un local. Copia VE.

## Rutas

| Área | Ruta | Qué hay |
| --- | --- | --- |
| Salón | `/floor` | Grid por zona. Estados libre / ocupada / cuenta / reservada. Footer: búsqueda, abiertas, espera cocina. |
| Mesa | `/table/:id` | Izquierda cuenta · derecha menú denso · **ENVIAR COCINA** sticky. 86 ocultos. |
| Menú FOH | `/menu` | Consulta. Sin 86. Sin agregar sin mesa. |
| Cuenta | `/check/:id` | Precuenta → Cobrar / Separar. |
| Cobro | `/pay/:id` | Totales USD+Bs, propina, PaymentMethodSlot, FiscalDocumentSlot, **Cobrar y generar comprobante**. |
| Split | `/split/:id` | Separar ítems. Parcial = otro pago en `/pay`. |
| KDS | `/kds`, `/kds/:station` | Poll 2 s. Bump / Recall 1 toque. Badge 86. |
| 86 | `/menu/admin` | Crear plato/categoría, agotar (86), precio e IVA. |
| Turno | `/turno` | Apertura de gaveta (USD+Bs), entradas/salidas, cierre interno Mesa (no reporte fiscal). |
| Día | `/reports/day` | Caja por método y moneda + arqueo de efectivo + conciliación de tasa + documentos fiscales. |
| Equipo | `/staff` | Usuarios y PIN demo. |
| Ajustes | `/settings` | RIF, IVA, IGTF (configurable), BCV obligatorio para Bs, propina vs servicio (Regl. LIVA art. 39). |

## Slots

- **PaymentMethodSlot** — efectivo USD/Bs, Pago Móvil (P2C manual + C2P stub), transferencia, Biopago, Zelle, Zinli, Cashea (off), crédito casa, propina (chips). Mixto + vuelto + ref + verificado. Mercantil/Megasoft/SDKs = stub.
- **FxRateSlot** — BCV pluggable (turepo preferido). Persistido por ticket: rate + source (turepo\|manual\|other) + fetched_at. Redondeo half-up 2 dp. Override admin + bitácora. Nunca TRM. Nunca reescribe histórico.
- **FiscalDocumentSlot / TaxLineSlot** — Fase 1: registra/prepara datos (IVA 16% default, 8 / 31 / exento; IGTF configurable; Bs al BCV del ticket). El PDF de Mesa es **comprobante interno**, no documento fiscal SENIAT. N° de control solo si lo asigna un medio autorizado (0141 MF, 000102 digital). Export «libro de ventas (desde Mesa)» para el contador, no libro legal definitivo. Retenciones IVA no disponibles en esta fase.

## Hot path

1. Mesero ≤4 toques tras abrir: 2 ítems + 1 extra + enviar. Sin confirm. Targets ≥44px.
2. Cajero: Cuenta → Cobrar → método → confirm → documento → closed.
3. Cocina ≤2 s; bump/recall 1 toque.
4. 86 hide FOH + badge KDS.

## Offline e impresión (stubs)

- **Cola IndexedDB** (`mesa-offline` / `jobs`): pedidos, abrir mesa, bump/recall KDS, cobro, impresión. Chip Toast/Square: En línea / Sin conexión / Sincronizando N.
- **Impresión**: comanda cocina al enviar o marcar listo; precuenta en cuenta; comprobante interno al cerrar. Popup del navegador + cola. No es documento fiscal SENIAT.

## Fuera de MVP

Guest apps, loyalty, inventario profundo, multi-local, nómina. Medios SENIAT (0141 / 000102) son conexiones, no un interruptor global de validez.

Fuentes fiscales (copia de producto, **no dictamen**): Fase 1 registra datos; Mesa sola no emite factura fiscal. Cite 0071, 0141, 000102. No citar 000121 como vigente (derogado por 000084). Propinas: Regl. LIVA art. 39 (configurable). Retenciones IVA no disponibles. IGTF % y BCV son ajustes operativos.
