"use client";

import { useState, useTransition } from "react";
import { closeShiftAction, openShiftAction, recordCashMoveAction } from "@/actions/shift";
import { offlineBlockMessage, planMutation } from "@/lib/sync-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatUsd, formatVes, parseAmountToCents } from "@/lib/money";
import { differenceLabel, SHIFT_KIND_LABEL, type CloseSummary, type DrawerPair } from "@/lib/shift";

function pairLabel(p: DrawerPair) {
  return `${formatUsd(p.usd)} · ${formatVes(p.ves)}`;
}

function moneyField(raw: string, currency: "USD" | "VES") {
  return parseAmountToCents(raw) ?? (currency === "USD" ? 0 : 0);
}

export type ShiftDeskOpen = {
  id: string;
  openedAt: string;
  openedByName: string;
  openingUsd: number;
  openingVes: number;
  expected: DrawerPair;
  cashHanded: DrawerPair;
  vuelto: DrawerPair;
  entradas: DrawerPair;
  salidas: DrawerPair;
  otherConfirmed: { methodLabel: string; currency: string; amountCents: number }[];
  pending: { id: string; methodLabel: string; reference?: string | null; amountCents: number; currency: string }[];
  movements: { id: string; type: string; currency: string; amountCents: number; concept: string; userName?: string | null }[];
};

export type ShiftDeskClosed = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string;
  closedByName: string | null;
  summary: CloseSummary | null;
  differenceLabel: string;
};

export function ShiftDesk({
  open,
  closed,
  openChecks,
}: {
  open: ShiftDeskOpen | null;
  closed: ShiftDeskClosed[];
  openChecks: { id: string; folio: string; status: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [openUsd, setOpenUsd] = useState("");
  const [openVes, setOpenVes] = useState("");
  const [moveType, setMoveType] = useState<"IN" | "OUT">("IN");
  const [moveCcy, setMoveCcy] = useState<"USD" | "VES">("USD");
  const [moveAmt, setMoveAmt] = useState("");
  const [moveConcept, setMoveConcept] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [countUsd, setCountUsd] = useState("");
  const [countVes, setCountVes] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [transfer, setTransfer] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <div>
        <h1 className="text-lg font-semibold">Turno de caja</h1>
        <p className="text-sm text-muted-foreground">{SHIFT_KIND_LABEL}.</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo completar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {ok ? (
        <Alert>
          <AlertTitle>Listo</AlertTitle>
          <AlertDescription>{ok}</AlertDescription>
        </Alert>
      ) : null}

      {!open ? (
        <Card>
          <CardHeader>
            <CardTitle>Apertura</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No hay turno abierto. El responsable es quien entra ahora. Fecha y hora se registran al
              confirmar.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="open-usd">Fondo inicial USD</Label>
                <Input
                  id="open-usd"
                  inputMode="decimal"
                  value={openUsd}
                  onChange={(e) => setOpenUsd(e.target.value)}
                  placeholder="50.00"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="open-ves">Fondo inicial Bs</Label>
                <Input
                  id="open-ves"
                  inputMode="decimal"
                  value={openVes}
                  onChange={(e) => setOpenVes(e.target.value)}
                  placeholder="20000,00"
                />
              </div>
            </div>
            <Button
              className="h-12 w-full"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  setOk(null);
                  const res = await openShiftAction({
                    openingUsd: moneyField(openUsd, "USD"),
                    openingVes: moneyField(openVes, "VES"),
                  });
                  if ("error" in res && res.error) setError(res.error);
                  else setOk("Turno abierto. Ya no se puede abrir otro en esta caja.");
                })
              }
            >
              Abrir turno
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Turno abierto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Responsable <span className="font-medium">{open.openedByName}</span> ·{" "}
                {new Date(open.openedAt).toLocaleString("es-VE")}
              </p>
              <p>Fondo inicial {pairLabel({ usd: open.openingUsd, ves: open.openingVes })}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">Cobros efectivo (entregado)</span>
                  <br />
                  {pairLabel(open.cashHanded)}
                </p>
                <p>
                  <span className="text-muted-foreground">Vuelto entregado</span>
                  <br />
                  {pairLabel(open.vuelto)}
                </p>
                <p>
                  <span className="text-muted-foreground">Entradas (no ventas)</span>
                  <br />
                  {pairLabel(open.entradas)}
                </p>
                <p>
                  <span className="text-muted-foreground">Salidas (no ventas)</span>
                  <br />
                  {pairLabel(open.salidas)}
                </p>
              </div>
              <p className="font-medium">Esperado en gaveta {pairLabel(open.expected)}</p>
              {open.otherConfirmed.length ? (
                <div>
                  <p className="text-muted-foreground">Otros métodos (no van a la gaveta)</p>
                  {open.otherConfirmed.map((m, i) => (
                    <p key={`${m.methodLabel}-${i}`}>
                      {m.methodLabel} ·{" "}
                      {m.currency === "VES" ? formatVes(m.amountCents) : formatUsd(m.amountCents)}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">Sin Pago Móvil / Zelle / otros en este turno.</p>
              )}
              {open.pending.length || openChecks.length ? (
                <Alert>
                  <AlertTitle>Pendiente antes del cierre</AlertTitle>
                  <AlertDescription>
                    {openChecks.length
                      ? `${openChecks.length} cuenta(s) abierta(s): ${openChecks.map((c) => c.folio).join(", ")}. `
                      : ""}
                    {open.pending.length
                      ? `${open.pending.length} pago(s) sin verificar.`
                      : ""}{" "}
                    Resuélvelos o traspasalos al siguiente turno.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Entrada / salida de efectivo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No es una venta. No suma al ingreso de platos. Exige concepto y motivo.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={moveType === "IN" ? "default" : "secondary"}
                  onClick={() => setMoveType("IN")}
                >
                  Entrada
                </Button>
                <Button
                  type="button"
                  variant={moveType === "OUT" ? "default" : "secondary"}
                  onClick={() => setMoveType("OUT")}
                >
                  Salida
                </Button>
                <Button
                  type="button"
                  variant={moveCcy === "USD" ? "default" : "secondary"}
                  onClick={() => setMoveCcy("USD")}
                >
                  USD
                </Button>
                <Button
                  type="button"
                  variant={moveCcy === "VES" ? "default" : "secondary"}
                  onClick={() => setMoveCcy("VES")}
                >
                  Bs
                </Button>
              </div>
              <Input
                inputMode="decimal"
                placeholder="Monto"
                value={moveAmt}
                onChange={(e) => setMoveAmt(e.target.value)}
              />
              <Input
                placeholder="Concepto (fondo extra, cambio a banco…)"
                value={moveConcept}
                onChange={(e) => setMoveConcept(e.target.value)}
              />
              <Textarea
                placeholder="Motivo (obligatorio)"
                value={moveReason}
                onChange={(e) => setMoveReason(e.target.value)}
              />
              <Button
                className="h-12 w-full"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    setOk(null);
                    const cents = parseAmountToCents(moveAmt);
                    if (!cents) {
                      setError("Indica un monto válido.");
                      return;
                    }
                    const res = await recordCashMoveAction({
                      type: moveType,
                      currency: moveCcy,
                      amountCents: cents,
                      concept: moveConcept,
                      reason: moveReason,
                    });
                    if ("error" in res && res.error) setError(res.error);
                    else {
                      setOk(moveType === "IN" ? "Entrada registrada." : "Salida registrada.");
                      setMoveAmt("");
                      setMoveConcept("");
                      setMoveReason("");
                    }
                  })
                }
              >
                Registrar {moveType === "IN" ? "entrada" : "salida"}
              </Button>
              {open.movements.length ? (
                <ul className="space-y-1 text-sm">
                  {open.movements.map((m) => (
                    <li key={m.id}>
                      {m.type === "IN" ? "Entrada" : m.type === "OUT" ? "Salida" : m.type}{" "}
                      {m.currency === "VES" ? formatVes(m.amountCents) : formatUsd(m.amountCents)} ·{" "}
                      {m.concept}
                      {m.userName ? ` · ${m.userName}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Aún no hay entradas ni salidas.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cierre interno</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Cuenta el efectivo. Si no cuadra, o si hay cuentas/pagos pendientes, el motivo es
                obligatorio. El cierre confirmado no se reescribe.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="count-usd">Contado USD</Label>
                  <Input
                    id="count-usd"
                    inputMode="decimal"
                    value={countUsd}
                    onChange={(e) => setCountUsd(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="count-ves">Contado Bs</Label>
                  <Input
                    id="count-ves"
                    inputMode="decimal"
                    value={countVes}
                    onChange={(e) => setCountVes(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={transfer}
                  onChange={(e) => setTransfer(e.target.checked)}
                />
                Traspasar cuentas abiertas y pagos pendientes al siguiente turno (queda rastro).
              </label>
              <Textarea
                placeholder="Motivo si hay diferencia o traspaso"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
              />
              <Button
                className="h-12 w-full"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    setOk(null);
                    const gate = planMutation({
                      online: typeof navigator === "undefined" ? true : navigator.onLine,
                      action: "closeShift",
                    });
                    if (gate.kind === "block") {
                      setError(gate.error || offlineBlockMessage("closeShift"));
                      return;
                    }
                    const res = await closeShiftAction({
                      countedUsd: moneyField(countUsd, "USD"),
                      countedVes: moneyField(countVes, "VES"),
                      reason: closeReason,
                      transferToNext: transfer,
                    });
                    if ("error" in res && res.error) setError(res.error);
                    else {
                      const label = res.summary ? differenceLabel(res.summary.difference) : "Cerrado";
                      setOk(`Cierre confirmado e inmutable. ${label}.`);
                    }
                  })
                }
              >
                Cerrar turno
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cierres consultables</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {closed.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay un cierre confirmado.</p>
          ) : (
            closed.map((c) => (
              <section key={c.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="font-medium">
                  {c.openedByName} → {c.closedByName ?? "—"} · {c.differenceLabel}
                </p>
                <p className="text-muted-foreground">
                  {new Date(c.openedAt).toLocaleString("es-VE")}
                  {c.closedAt ? ` — ${new Date(c.closedAt).toLocaleString("es-VE")}` : ""}
                </p>
                {c.summary ? (
                  <div className="mt-2 grid gap-1 text-xs">
                    <p>Fondo {pairLabel(c.summary.opening)}</p>
                    <p>Cobros efectivo {pairLabel(c.summary.cashHanded)} − vuelto {pairLabel(c.summary.vuelto)}</p>
                    <p>
                      Entradas {pairLabel(c.summary.entradas)} − salidas {pairLabel(c.summary.salidas)}
                    </p>
                    <p>Esperado {pairLabel(c.summary.expected)} · contado {pairLabel(c.summary.counted)}</p>
                    <p>{c.summary.kindLabel}</p>
                    {c.summary.openChecksTransferred.length || c.summary.pendingTransferred.length ? (
                      <p>
                        Traspaso: {c.summary.openChecksTransferred.map((x) => x.folio).join(", ") || "—"} ·
                        pagos {c.summary.pendingTransferred.length}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
