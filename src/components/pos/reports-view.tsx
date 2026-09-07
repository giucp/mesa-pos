"use client";

import { useState, useTransition } from "react";
import {
  exportCajaFiscalCsv,
  exportLibroVentasCsv,
  recordCorteAction,
  type CorteResult,
} from "@/actions/fiscal";
import { recordArqueoAction } from "@/actions/payments";
import { DualMoney } from "@/components/pos/money-label";
import { FiscalBanner } from "@/components/pos/fiscal-banner";
import { OpenChecksList, type OpenCheckRow } from "@/components/pos/open-checks-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatUsd, formatVes, parseAmountToCents } from "@/lib/money";
import { CHANNEL_LABEL, FISCAL_COPY, type Channel } from "@/lib/fiscal";
import { sourceLabel } from "@/lib/bcv-label";
import { openChannelCheckAction } from "@/actions/tables";
import { useRouter } from "next/navigation";
import { paths } from "@/lib/paths";

export function ReportsView({
  rate,
  rateSource,
  summary,
  canVoid = false,
}: {
  rate: number;
  rateSource?: string;
  summary: {
    salesUsd: number;
    ivaUsd: number;
    tipUsd: number;
    igtfUsd: number;
    voids: number;
    voidUsd: number;
    discounts: number;
    courtesies: number;
    openTables: number;
    openUsd: number;
    expectedVes?: number;
    collectedVes?: number;
    rateDeltaVes?: number;
    cashUsd?: number;
    cashVes?: number;
    pendingUsd?: number;
    byMethod: {
      key: string;
      label: string;
      count: number;
      usd: number;
      ves: number;
      nativeUsd?: number;
      nativeVes?: number;
      igtfUsd: number;
      verified?: number;
      pendingCount?: number;
      pendingUsd?: number;
    }[];
    byCurrency: { currency: string; count: number; native: number; usd: number }[];
    byChannel: { channel: string; count: number; usd: number }[];
    openChecks?: OpenCheckRow[];
    staff?: { id: string; name: string }[];
  };
  canVoid?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [corte, setCorte] = useState<CorteResult | null>(null);
  const [countUsd, setCountUsd] = useState("");
  const [countVes, setCountVes] = useState("");
  const [arqueoMsg, setArqueoMsg] = useState<string | null>(null);
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const [openList, setOpenList] = useState(false);
  const openChecks = summary.openChecks ?? [];
  const staff = summary.staff ?? [];

  function downloadCsv(filename: string, csv: string) {
    const withBom = csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
    const blob = new Blob([withBom], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Caja y reportes</h1>
          <p className="text-sm text-muted-foreground">
            Ventas cobradas · BCV {rate.toFixed(2)}
            {rateSource ? ` · ${sourceLabel(rateSource)}` : ""} · arqueo por método y moneda.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="pos-touch" onClick={() => router.push(paths.turno)}>
            Turno de caja
          </Button>
          <Button
            variant="secondary"
            className="pos-touch"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await recordCorteAction("X");
                if ("kind" in res) setCorte(res);
                else setCsvNote(res.error ?? "Sin permiso para el corte.");
              })
            }
          >
            Corte X
          </Button>
          <Button
            className="pos-touch"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await recordCorteAction("Z");
                if ("kind" in res) setCorte(res);
                else setCsvNote(res.error ?? "Sin permiso para el corte.");
              })
            }
          >
            Corte Z
          </Button>
          <Button
            variant="secondary"
            className="pos-touch"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await openChannelCheckAction("TAKEAWAY");
                if (res.checkId) router.push(paths.cuenta(res.checkId));
              })
            }
          >
            Para llevar
          </Button>
          <div className="flex flex-col">
            <Button variant="secondary" className="pos-touch opacity-60" disabled>
              Delivery
            </Button>
            <p className="max-w-[12rem] text-[11px] text-muted-foreground">
              Delivery no está disponible en esta fase.
            </p>
          </div>
          <Button
            variant="secondary"
            className="pos-touch"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await exportLibroVentasCsv("ALL");
                if ("filename" in res) {
                  downloadCsv(res.filename, res.csv);
                  setCsvNote(res.note);
                  return;
                }
                setCsvNote(res.error ?? "No se pudo exportar.");
              })
            }
          >
            {FISCAL_COPY.bookTitle}
          </Button>
          <Button
            variant="secondary"
            className="pos-touch"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await exportCajaFiscalCsv();
                if ("filename" in res) {
                  downloadCsv(res.filename, res.csv);
                  setCsvNote(res.note);
                  return;
                }
                setCsvNote(res.error ?? "No se pudo exportar.");
              })
            }
          >
            Caja CSV
          </Button>
        </div>
      </div>

      <FiscalBanner />
      <p className="text-xs text-muted-foreground">{FISCAL_COPY.bookHelp}</p>
      {csvNote ? (
        <p className="text-xs text-muted-foreground">{csvNote} UTF-8 con BOM para Excel.</p>
      ) : null}

      {corte ? (
        <Alert>
          <AlertTitle>{corte.label}</AlertTitle>
          <AlertDescription>
            {corte.disclaimer} Ventas {formatUsd(corte.salesUsd)} · IVA {formatUsd(corte.ivaUsd)} · IGTF{" "}
            {formatUsd(corte.igtfUsd)} · {corte.documents} documentos · {corte.payments} pagos.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-xs text-muted-foreground">
          Corte X: snapshot del turno. Corte Z: cierre del día en Mesa (documentos, IVA, IGTF y caja).
          Si el local usa una máquina fiscal física, su reporte Z es independiente.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat title="Ventas netas" usd={summary.salesUsd} rate={rate} />
        <Stat title="IVA" usd={summary.ivaUsd} rate={rate} />
        <Stat title="IGTF" usd={summary.igtfUsd} rate={rate} />
        <Stat title="Propinas" usd={summary.tipUsd} rate={rate} />
        <button
          type="button"
          className="text-left"
          onClick={() => setOpenList(true)}
        >
          <Card className="h-full transition hover:border-primary/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Cuentas abiertas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums">{summary.openTables}</div>
              <p className="text-xs text-muted-foreground">
                {formatUsd(summary.openUsd)} pendientes · todos los canales · toca para ver
              </p>
            </CardContent>
          </Card>
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por método</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.byMethod.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay cobros hoy.</p>
            ) : (
              summary.byMethod.map((m) => (
                <div key={m.key} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.count} ops · IGTF {formatUsd(m.igtfUsd)}
                      {m.nativeUsd ? ` · caja ${formatUsd(m.nativeUsd)}` : ""}
                      {m.nativeVes || m.ves ? ` · caja ${formatVes(m.nativeVes ?? m.ves)}` : ""}
                      {typeof m.verified === "number" ? ` · verif. ${m.verified}` : ""}
                      {m.pendingCount ? ` · pendiente ${m.pendingCount} (${formatUsd(m.pendingUsd ?? 0)})` : ""}
                    </div>
                  </div>
                  <DualMoney usdCents={m.usd} rate={rate} size="sm" />
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Moneda · canal · ajustes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.byCurrency.map((c) => (
              <div key={c.currency} className="flex items-center justify-between">
                <div className="text-sm font-medium">{c.currency === "VES" ? "Bolívares" : "Dólares"}</div>
                <div className="text-right text-sm tabular-nums">
                  {c.currency === "VES" ? formatVes(c.native) : formatUsd(c.native)}
                  <div className="text-xs text-muted-foreground">= {formatUsd(c.usd)}</div>
                </div>
              </div>
            ))}
            {summary.byChannel.map((c) => (
              <div key={c.channel} className="flex justify-between text-sm">
                <span>{CHANNEL_LABEL[c.channel as Channel] ?? c.channel}</span>
                <span>
                  {c.count} · {formatUsd(c.usd)}
                </span>
              </div>
            ))}
            {typeof summary.expectedVes === "number" ? (
              <div className="rounded-xl bg-secondary/60 p-3 text-sm">
                Conciliación tasa: libros {formatVes(summary.expectedVes)} · cobrado Bs{" "}
                {formatVes(summary.collectedVes ?? 0)} · Δ tickets {formatVes(summary.rateDeltaVes ?? 0)}
              </div>
            ) : null}
            <div className="rounded-xl bg-destructive/10 p-3 text-sm">
              Anulaciones {summary.voids} · {formatUsd(summary.voidUsd)} · descuentos {summary.discounts} ·
              cortesías {summary.courtesies}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arqueo de efectivo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Sistema · efectivo USD</span>
              <span className="tabular-nums">{formatUsd(summary.cashUsd ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Sistema · efectivo Bs</span>
              <span className="tabular-nums">{formatVes(summary.cashVes ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Pendiente por verificar</span>
              <span className="tabular-nums">{formatUsd(summary.pendingUsd ?? 0)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Efectivo = cobros verificados menos vuelto. Pago Móvil / Zelle sin verificar no entra
              como recibido. Cobro automático bancario no está disponible en esta fase.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Contado USD</Label>
            <Input className="min-h-11" value={countUsd} onChange={(e) => setCountUsd(e.target.value)} />
            <Label>Contado Bs</Label>
            <Input className="min-h-11" value={countVes} onChange={(e) => setCountVes(e.target.value)} />
            {countUsd || countVes ? (
              <p className="text-xs text-muted-foreground">
                Δ USD {formatUsd((parseAmountToCents(countUsd) ?? 0) - (summary.cashUsd ?? 0))} · Δ Bs{" "}
                {formatVes((parseAmountToCents(countVes) ?? 0) - (summary.cashVes ?? 0))}
              </p>
            ) : null}
            <Button
              className="min-h-11 w-full"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await recordArqueoAction({
                    countedUsdCents: parseAmountToCents(countUsd) ?? 0,
                    countedVesCents: parseAmountToCents(countVes) ?? 0,
                  });
                  if (res.ok) setArqueoMsg("Arqueo guardado en bitácora.");
                })
              }
            >
              Guardar arqueo
            </Button>
            {arqueoMsg ? <p className="text-xs text-muted-foreground">{arqueoMsg}</p> : null}
          </div>
        </CardContent>
      </Card>
      <Dialog open={openList} onOpenChange={setOpenList}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cuentas abiertas</DialogTitle>
            <DialogDescription>
              Caja cuenta todas las cuentas con ítems y saldo (mesas, barra, para llevar,
              delivery). Salón solo cuenta mesas de salón/terraza. Abandonada: 4 horas sin
              movimiento o del día anterior.
            </DialogDescription>
          </DialogHeader>
          <OpenChecksList
            checks={openChecks}
            rate={rate}
            grouped
            manager
            canVoid={canVoid}
            staff={staff}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ title, usd, rate }: { title: string; usd: number; rate: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DualMoney usdCents={usd} rate={rate} size="lg" align="start" />
      </CardContent>
    </Card>
  );
}
