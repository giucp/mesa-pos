import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { FASE2_FOLIOS, FASE3_AUDIT, FASE4_SHIFT, FASE6_STOCK, ISOLATED_DEMO } from "@/lib/isolated-demo";
import { fiscalTotals } from "@/lib/fiscal";
import { formatUsd, formatVes } from "@/lib/money";
import { describePaymentSettle, formatNative, summarizePayments } from "@/lib/caja";
import { differenceLabel, type CloseSummary } from "@/lib/shift";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

function loadPhase3TestLog() {
  const candidates = [
    path.join(process.cwd(), "prisma", "fase3-test-log.txt"),
    path.join(process.cwd(), "prisma", "fase3-isolated-note.json"),
  ];
  const txt = candidates[0];
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ txt)) {
      return fs.readFileSync(/*turbopackIgnore: true*/ txt, "utf8");
    }
  } catch {
    /* ignore */
  }
  return null;
}

export default async function EvidenciaPage() {
  if (!ISOLATED_DEMO) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="text-lg font-semibold">Evidencia Fase 2</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta pantalla solo existe en el entorno aislado. Producción Café Ávila no corre estas ventas
          demo.
        </p>
      </div>
    );
  }

  const restaurant = await prisma.restaurant.findFirst();
  const checks = await prisma.check.findMany({
    where: { folio: { in: Object.values(FASE2_FOLIOS) } },
    include: { lines: true, payments: true, fiscal: true },
    orderBy: { folio: "asc" },
  });
  const rate = restaurant?.bcvRate ?? 148.52;
  const caja = summarizePayments(
    checks.flatMap((c) => c.payments),
    rate,
  );
  const auditCount = await prisma.auditLog.count({
    where: { reason: { in: [FASE3_AUDIT.confirmReason, FASE3_AUDIT.courtesyReason] } },
  });
  const testLog = loadPhase3TestLog();
  const lastClose = await prisma.cashShift.findFirst({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "desc" },
  });
  const persistMove = await prisma.stockMovement.findFirst({
    where: { clientOpId: FASE6_STOCK.persistOpId },
    include: { item: { select: { name: true, stockQty: true, stockUnit: true } } },
  });
  const cachapa = await prisma.item.findFirst({
    where: { name: FASE6_STOCK.itemName },
    select: { name: true, stockQty: true, stockUnit: true, stockControlled: true },
  });
  let closeSummary: CloseSummary | null = null;
  if (lastClose?.summaryJson) {
    try {
      closeSummary = JSON.parse(lastClose.summaryJson) as CloseSummary;
    } catch {
      closeSummary = null;
    }
  }
  let fase4Note: string | null = null;
  try {
    const p = path.join(process.cwd(), "prisma", "fase4-evidence.json");
    if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
      fase4Note = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
    }
  } catch {
    /* ignore */
  }
  let fase6Note: string | null = null;
  try {
    const p6 = path.join(process.cwd(), "prisma", "fase6-evidence.json");
    if (fs.existsSync(/*turbopackIgnore: true*/ p6)) {
      fase6Note = fs.readFileSync(/*turbopackIgnore: true*/ p6, "utf8");
    }
  } catch {
    /* ignore */
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Alert>
        <AlertTitle>Entorno aislado — no es producción</AlertTitle>
        <AlertDescription>
          {restaurant?.name ?? "Demo Fase 2"}. PIN 1111. Folios {FASE2_FOLIOS.A}, {FASE2_FOLIOS.B},{" "}
          {FASE2_FOLIOS.C}. Incluye Fase 6 (inventario de producto terminado). Comprobante interno —
          no es documento fiscal SENIAT.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link className="underline" href="/">
          Entrar al turno
        </Link>
        <Link className="underline" href="/reports/day">
          Caja y reportes
        </Link>
        <Link className="underline" href="/auditoria">
          Auditoría
        </Link>
        <Link className="underline" href="/turno">
          Turno
        </Link>
        <Link className="underline" href="/inventario">
          Inventario
        </Link>
        <Link className="underline" href="#fase6">
          Evidencia Fase 6
        </Link>
      </div>

      <div className="space-y-4">
        {checks.map((c) => {
          const tot = fiscalTotals(
            c.lines,
            c.tipUsd,
            restaurant?.ivaRate ?? 16,
            c.bcvRateUsed || rate,
            restaurant?.tipInTaxableBase ?? false,
          );
          const rows = c.payments.map((p) => ({ p, s: describePaymentSettle(p) }));
          const handed = new Map<string, number>();
          const pendingReg = new Map<string, number>();
          const confirmedApplied = new Map<string, number>();
          const change = new Map<string, number>();
          const cajaNet = new Map<string, number>();
          for (const { p, s } of rows) {
            handed.set(p.currency, (handed.get(p.currency) ?? 0) + s.handedCents);
            if (p.confirmed) {
              confirmedApplied.set(p.currency, (confirmedApplied.get(p.currency) ?? 0) + s.appliedCents);
            } else {
              pendingReg.set(p.currency, (pendingReg.get(p.currency) ?? 0) + s.registeredCents);
            }
            change.set(p.currency, (change.get(p.currency) ?? 0) + s.changeCents);
            cajaNet.set(p.currency, (cajaNet.get(p.currency) ?? 0) + s.cajaNetCents);
          }
          const byCcy = (m: Map<string, number>) =>
            ["USD", "VES"]
              .filter((ccy) => (m.get(ccy) ?? 0) > 0)
              .map((ccy) => formatNative(ccy, m.get(ccy) ?? 0))
              .join(" + ") || "—";
          return (
            <section key={c.id} className="rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">{c.folio}</h2>
                <Link className="text-sm underline" href={`/pay/${c.id}`}>
                  Ver cuenta
                </Link>
              </div>
              <p className="text-sm text-muted-foreground">
                Total {formatUsd(tot.totalUsd)} · tasa {(c.bcvRateUsed || rate).toFixed(2)} Bs/USD ·{" "}
                {c.fiscal?.invoiceNumber}
              </p>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">Entregado bruto</span>
                  <br />
                  {byCcy(handed)}
                </p>
                <p>
                  <span className="text-muted-foreground">Importe registrado pendiente</span>
                  <br />
                  {byCcy(pendingReg)}
                </p>
                <p>
                  <span className="text-muted-foreground">Importe confirmado aplicado al saldo</span>
                  <br />
                  {byCcy(confirmedApplied)}
                </p>
                <p>
                  <span className="text-muted-foreground">Vuelto por moneda</span>
                  <br />
                  {byCcy(change)}
                </p>
                <p>
                  <span className="text-muted-foreground">Movimiento neto de caja</span>
                  <br />
                  {byCcy(cajaNet)}
                </p>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                {rows.map(({ p, s }) => (
                  <div key={p.id} className="rounded-xl border border-border/70 px-3 py-2">
                    <div className="font-medium">
                      {p.methodLabel}
                      {p.reference ? ` · ${p.reference}` : ""} ·{" "}
                      {p.confirmed ? "verificado" : "pendiente"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.confirmed
                        ? `Entregó ${s.handedLabel} · aplicado al saldo ${s.appliedToBalanceLabel} · vuelto ${s.changeLabel} · caja ${s.cajaNetLabel}`
                        : `Registrado pendiente ${s.registeredLabel} · ${s.appliedToBalanceLabel} · no hay dinero recibido ni salida de caja`}
                    </div>
                  </div>
                ))}
              </div>
              {c.folio === FASE2_FOLIOS.A ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Pago Móvil {`REF-NO-CONFIRM`} es Bs 100,00 originales. El vuelto real es Bs 0,00:
                  no hubo devolución en efectivo. No se inventa vuelto reconvirtiendo el equivalente
                  USD (ya redondeado a 2 decimales) de vuelta a Bs. Mientras está pendiente no hay
                  dinero recibido ni salida de caja. Al confirmar, el banco sigue en Bs 100,00.
                </p>
              ) : null}
              {c.folio === FASE2_FOLIOS.C ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  En el Bs el cliente entregó más que el saldo (bruto = aplicado + vuelto). El USD
                  cubrió la mitad exacta. Caja neta = solo lo aplicado verificado.
                </p>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border p-4 text-sm">
        <p>
          Caja efectivo USD {formatUsd(caja.cashUsd)} · Bs {formatVes(caja.cashVes)}
        </p>
        <p>
          Pendiente por verificar {formatUsd(caja.pendingUsd)} — no entra como recibido.
        </p>
        <p className="mt-2 text-muted-foreground">
          Recarga esta página: los mismos folios y montos. Un segundo cobro en una cuenta P2 no
          duplica el pago. Folios P3-AUD-* son bitácora, no ventas P2.
        </p>
      </div>

      <div className="rounded-2xl border border-border p-4 text-sm">
        <h2 className="font-semibold">Auditoría de prueba (solo aislado)</h2>
        <p className="text-muted-foreground">
          {auditCount >= 2
            ? `${auditCount} filas de prueba listos en `
            : "Aún no están las filas de prueba. Revisa "}
          <Link className="underline" href="/auditoria">
            /auditoria
          </Link>
          : {FASE3_AUDIT.confirmReason} y {FASE3_AUDIT.courtesyReason}.
        </p>
        {testLog ? (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-[11px]">
            {testLog}
          </pre>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            test:phase3 se corre en el build aislado y se adjunta aquí.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-border p-4 text-sm">
        <h2 className="font-semibold">Fase 4 — turno de caja</h2>
        <p className="text-muted-foreground">
          Folio de prueba {FASE4_SHIFT.folio}. Fondo USD + Bs, venta con vuelto, entrada, salida y
          cierre con diferencia. El cierre es interno de Mesa, no un reporte fiscal.{" "}
          <Link className="underline" href="/turno">
            /turno
          </Link>
        </p>
        {closeSummary ? (
          <div className="mt-3 space-y-1">
            <p>
              Esperado {formatUsd(closeSummary.expected.usd)} · {formatVes(closeSummary.expected.ves)}
            </p>
            <p>
              Contado {formatUsd(closeSummary.counted.usd)} · {formatVes(closeSummary.counted.ves)}
            </p>
            <p>
              {differenceLabel(closeSummary.difference)} · ventas del turno{" "}
              {formatUsd(closeSummary.salesRevenueUsd)} (entradas/salidas no suman ventas)
            </p>
            <p className="text-xs text-muted-foreground">{closeSummary.kindLabel}</p>
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">Aún no hay un cierre Fase 4 en este demo.</p>
        )}
        {fase4Note ? (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-[11px]">
            {fase4Note}
          </pre>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border p-4 text-sm">
        <h2 className="font-semibold">Fase 5 — conexión y recuperación</h2>
        <p className="text-muted-foreground">
          El chip distingue Sin conexión / Sincronizando / Al día / Error de sincronización y muestra
          cuántas operaciones esperan al servidor. Tener internet no significa que el cambio ya
          quedó guardado.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Pedidos en cola: sobreviven recarga, llegan una vez, conservan mesa / plato / cantidad / nota.</li>
          <li>No se muestra «Enviado a cocina» hasta que el servidor confirma.</li>
          <li>Conflicto entre dos sesiones: se muestra y se resuelve; no se pisa en silencio.</li>
          <li>Cobro con respuesta perdida: se consulta el mismo id de operación antes de reenviar.</li>
          <li>Confirmar pago o cerrar turno sin conexión: no hay éxito falso.</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Límites: no es un POS offline completo. Abrir mesa, agregar plato, enviar cocina, cobro
          (con id estable) e impresión pueden quedar en cola. Confirmar Pago Móvil y cerrar turno
          exigen servidor. Cambiar cantidad o notas de un plato ya guardado no tiene cola propia.
        </p>
      </div>

      <div id="fase6" className="rounded-2xl border border-border p-4 text-sm">
        <h2 className="font-semibold">Fase 6 — inventario de producto terminado</h2>
        <p className="text-muted-foreground">
          Solo producto terminado. Sin recetas, insumos, proveedores ni compras.{" "}
          {FASE6_STOCK.itemName} sale con control ({FASE6_STOCK.openingQty} {FASE6_STOCK.unit} de
          apertura, alerta {FASE6_STOCK.alertMin}). El resto del menú se vende como hoy. La base es
          Postgres persistente (`isolated_fase6`), no el SQLite de `/tmp`.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Entrada, ajuste y merma piden cantidad, motivo y responsable. Quedan en el historial y en auditoría.</li>
          <li>La reserva ocurre al agregar el plato (el servidor confirma existencias). No hay promesa de stock sin conexión.</li>
          <li>Anular antes de ENVIAR COCINA libera la reserva. Anular después de preparar no devuelve comida al inventario.</li>
          <li>Agotado (86) es un apagado manual. Sin existencias es cantidad en cero. No se vende de más si el control está activo.</li>
        </ul>
        <div className="mt-3 rounded-xl bg-muted/50 p-3 text-sm">
          <p className="font-medium">Movimiento persistente para verificar recarga</p>
          {persistMove && cachapa ? (
            <p className="mt-1 text-muted-foreground">
              {persistMove.item.name}: {cachapa.stockQty} {cachapa.stockUnit}. Historial: «
              {persistMove.motivo}» (+{persistMove.qty} {persistMove.unit},{" "}
              {new Date(persistMove.createdAt).toLocaleString("es-VE")}). PIN 1111 →{" "}
              <Link className="underline" href="/inventario">
                /inventario
              </Link>{" "}
              → Cachapa → Historial. Recarga o abre otra sesión: el movimiento sigue.
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Aún no está el movimiento «{FASE6_STOCK.persistMotivo}». Corre{" "}
              <code>npm run test:phase6:persist</code> en el demo aislado.
            </p>
          )}
        </div>
        {fase6Note ? (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-[11px]">
            {fase6Note}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
