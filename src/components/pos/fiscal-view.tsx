"use client";

import { useState, useTransition } from "react";
import { exportCajaFiscalCsv, exportLibroVentasCsv } from "@/actions/fiscal";
import { DualMoney } from "@/components/pos/money-label";
import { FiscalBanner } from "@/components/pos/fiscal-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CHANNEL_LABEL,
  documentKindLabel,
  documentStatusLabel,
  FISCAL_COPY,
  isInternalFiscalDoc,
  WITHHOLDING_NOTE,
  type Channel,
} from "@/lib/fiscal";

type Draft = {
  id: string;
  documentType: string;
  ticketType: string;
  homologation: string;
  controlNumber: string;
  invoiceNumber: string;
  customerName: string | null;
  customerRif: string | null;
  customerCi: string | null;
  channel: string;
  totalUsd: number;
  totalVes: number;
  ivaUsd: number;
  igtfUsd: number;
  ivaBreakdown: string;
  bcvRate: number;
  usdRef: string | null;
  createdAt: string;
  check: { folio: string; table: { number: string } | null };
};

function download(filename: string, csv: string) {
  const withBom = csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
  const blob = new Blob([withBom], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FiscalView({ drafts, rate }: { drafts: Draft[]; rate: number }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel | "ALL">("ALL");

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">{FISCAL_COPY.headerInternal}</h1>
        <p className="text-sm text-muted-foreground">
          {FISCAL_COPY.statusInternal} RIF, comprador, IVA, IGTF y tasa BCV del ticket. El N° de
          control solo aparece si lo asignó un medio autorizado.
        </p>
      </div>

      <FiscalBanner />

      <div className="flex flex-wrap gap-2">
        {(["ALL", "LOCAL", "BARRA", "TAKEAWAY", "DELIVERY"] as const).map((c) => (
          <Button
            key={c}
            variant={channel === c ? "default" : "secondary"}
            className="pos-touch"
            onClick={() => setChannel(c)}
          >
            {c === "ALL" ? "Todos los canales" : CHANNEL_LABEL[c]}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="pos-touch"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await exportLibroVentasCsv(channel);
              if ("filename" in res) {
                download(res.filename, res.csv);
                setNote(res.note);
                return;
              }
              setNote(res.error ?? "No se pudo exportar.");
            })
          }
        >
          {FISCAL_COPY.bookTitle}
        </Button>
        <Button
          variant="secondary"
          className="pos-touch"
          disabled
          title="Libro de compras no está disponible en esta fase."
        >
          Libro de compras
        </Button>
        <Button
          variant="secondary"
          className="pos-touch"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await exportCajaFiscalCsv();
              if ("filename" in res) {
                download(res.filename, res.csv);
                setNote(res.note);
                return;
              }
              setNote(res.error ?? "No se pudo exportar.");
            })
          }
        >
          Caja / fiscal por método
        </Button>
        <Button
          variant="secondary"
          className="pos-touch"
          disabled
          title="Retenciones de IVA no están disponibles en esta fase."
        >
          Retenciones IVA
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Libro de compras y retenciones de IVA no están disponibles en esta fase. No se muestran como
        listos.
      </p>

      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      <p className="text-xs text-muted-foreground">{WITHHOLDING_NOTE}</p>

      {drafts.filter((d) => channel === "ALL" || d.channel === channel).length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Cobra una cuenta para generar el primer comprobante interno del día.
        </div>
      ) : (
        <div className="space-y-2">
          {drafts
            .filter((d) => channel === "ALL" || d.channel === channel)
            .map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">
                    {documentKindLabel(d.documentType, d.ticketType, d.homologation)}{" "}
                    {d.invoiceNumber}
                    {!isInternalFiscalDoc(d.homologation) && d.controlNumber
                      ? ` · N° control ${d.controlNumber}`
                      : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {d.check.folio}
                    {d.check.table ? ` · Mesa ${d.check.table.number}` : ""} · {d.customerName} ·{" "}
                    {d.customerRif}
                    {d.customerCi ? ` · CI ${d.customerCi}` : ""} ·{" "}
                    {CHANNEL_LABEL[d.channel as Channel] ?? d.channel} · IVA {formatIgtf(d.ivaUsd)} ·
                    IGTF {formatIgtf(d.igtfUsd)}
                    {d.usdRef ? ` · ${d.usdRef}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{documentStatusLabel(d.homologation)}</Badge>
                  <DualMoney usdCents={d.totalUsd} rate={d.bcvRate || rate} size="sm" />
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function formatIgtf(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
