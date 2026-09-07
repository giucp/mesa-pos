"use server";

import { allowAction } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { startOfBusinessDay } from "@/lib/queries";
import { formatUsd, formatVes } from "@/lib/money";
import { writeAudit } from "@/lib/audit";
import {
  CHANNEL_LABEL,
  FISCAL_COPY,
  documentKindLabel,
  documentStatusLabel,
  type Channel,
} from "@/lib/fiscal";

function csvEscape(rows: (string | number)[][]) {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? "")
            .replaceAll("\r", " ")
            .replaceAll("\n", " ")
            .replaceAll('"', '""');
          return `"${s}"`;
        })
        .join(","),
    )
    .join("\r\n");
}

function csvFile(rows: (string | number)[][]) {
  return `\uFEFF${csvEscape(rows)}`;
}

export type CsvExport = { filename: string; csv: string; note: string };
export type CorteResult = {
  kind: "X" | "Z";
  label: string;
  disclaimer: string;
  salesUsd: number;
  ivaUsd: number;
  igtfUsd: number;
  totalUsd: number;
  documents: number;
  payments: number;
};

export async function exportLibroVentasCsv(
  channel?: Channel | "ALL",
): Promise<CsvExport | { error: string }> {
  const auth = await allowAction("fiscal");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const from = startOfBusinessDay();
  const drafts = await prisma.fiscalDraft.findMany({
    where: {
      createdAt: { gte: from },
      ...(channel && channel !== "ALL" ? { channel } : {}),
    },
    include: { check: { include: { table: true, payments: true } } },
    orderBy: { createdAt: "asc" },
  });

  const restaurant = await prisma.restaurant.findFirst();
  const header = [
    "fecha",
    "canal",
    "folio",
    "n_control",
    "n_factura",
    "tipo_documento",
    "ticket",
    "estado",
    "maquina_fiscal",
    "impresora_digital",
    "rif_emisor",
    "rif_cliente",
    "ci_cliente",
    "razon_social",
    "base_usd",
    "iva_desglose",
    "iva_usd",
    "propina_usd",
    "igtf_usd",
    "total_usd",
    "tasa_bcv",
    "fuente_bcv",
    "base_bs",
    "iva_bs",
    "igtf_bs",
    "total_bs",
    "ref_usd",
    "mesa",
    "retencion",
  ];

  const rows = drafts.map((d) => [
    d.createdAt.toISOString(),
    CHANNEL_LABEL[d.channel as Channel] ?? d.channel,
    d.check.folio,
    d.controlNumber,
    d.invoiceNumber,
    documentKindLabel(d.documentType, d.ticketType, d.homologation),
    d.ticketType,
    documentStatusLabel(d.homologation),
    d.adapterMf,
    d.adapterDigital,
    d.emitterRif || restaurant?.rif || "",
    d.customerRif ?? "",
    d.customerCi ?? "",
    d.customerName ?? "",
    (d.subtotalUsd / 100).toFixed(2),
    d.ivaBreakdown,
    (d.ivaUsd / 100).toFixed(2),
    (d.tipUsd / 100).toFixed(2),
    (d.igtfUsd / 100).toFixed(2),
    (d.totalUsd / 100).toFixed(2),
    d.bcvRate.toFixed(4),
    d.bcvSource,
    (d.subtotalVes / 100).toFixed(2),
    (d.ivaVes / 100).toFixed(2),
    (d.igtfVes / 100).toFixed(2),
    (d.totalVes / 100).toFixed(2),
    d.usdRef ?? "",
    d.check.table?.number ?? "",
    d.withholdingNote,
  ]);

  const scope = channel && channel !== "ALL" ? channel.toLowerCase() : "todos";
  await writeAudit({
    action: "EXPORT_LIBRO_VENTAS",
    reason: `Export CSV canal ${scope}`,
    userId: user.id,
    details: JSON.stringify({ count: drafts.length, channel: scope }),
  });

  return {
    filename: `libro-ventas-${scope}-${from.toISOString().slice(0, 10)}.csv`,
    csv: csvFile(
      drafts.length
        ? [header, ...rows]
        : [header, header.map((_, i) => (i === 2 ? "sin documentos en el día" : ""))],
    ),
    note: `${FISCAL_COPY.bookTitle} (${scope}). ${drafts.length} operaciones. ${formatUsd(
      drafts.reduce((s, d) => s + d.totalUsd, 0),
    )} / ${formatVes(drafts.reduce((s, d) => s + d.totalVes, 0))}. ${FISCAL_COPY.bookHelp}`,
  };
}

export async function exportLibroComprasCsv(): Promise<CsvExport | { error: string }> {
  const auth = await allowAction("fiscal");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const from = startOfBusinessDay();
  const rows = await prisma.purchaseStub.findMany({
    where: { date: { gte: from } },
    orderBy: { date: "asc" },
  });
  const header = ["fecha", "proveedor", "rif", "descripcion", "base_bs", "iva_pct", "iva_bs", "total_bs"];
  const body = rows.map((p) => [
    p.date.toISOString(),
    p.supplierName,
    p.supplierRif,
    p.description,
    (p.baseVes / 100).toFixed(2),
    p.ivaRate.toFixed(2),
    (p.ivaVes / 100).toFixed(2),
    (p.totalVes / 100).toFixed(2),
  ]);
  await writeAudit({
    action: "EXPORT_LIBRO_COMPRAS",
    reason: "Export libro de compras (no disponible en esta fase)",
    userId: user.id,
    details: JSON.stringify({ count: rows.length }),
  });
  return {
    filename: `libro-compras-${from.toISOString().slice(0, 10)}.csv`,
    csv: csvFile(body.length ? [header, ...body] : [header]),
    note: `Libro de compras no está disponible en esta fase. ${rows.length} asientos de demostración. No es libro SENIAT.`,
  };
}

export async function exportRetencionesCsv(): Promise<CsvExport | { error: string }> {
  const auth = await allowAction("fiscal");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  await writeAudit({
    action: "EXPORT_RETENCIONES",
    reason: "Export retenciones IVA (no disponible en esta fase)",
    userId: user.id,
    details: "{}",
  });
  const header = ["fecha", "folio", "rif_sujeto", "base_usd", "iva_usd", "retenido_usd", "nota"];
  return {
    filename: `retenciones-iva-${startOfBusinessDay().toISOString().slice(0, 10)}.csv`,
    csv: csvFile([
      header,
      [
        new Date().toISOString(),
        "",
        "",
        "0.00",
        "0.00",
        "0.00",
        "Retenciones IVA no disponibles en esta fase — sin cálculo automático",
      ],
    ]),
    note: "Retenciones IVA no están disponibles en esta fase. No se aplican en caja.",
  };
}

export async function exportCajaFiscalCsv(): Promise<CsvExport | { error: string }> {
  const auth = await allowAction("fiscal");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const from = startOfBusinessDay();
  const payments = await prisma.payment.findMany({
    where: { createdAt: { gte: from } },
    include: { check: true },
    orderBy: { createdAt: "asc" },
  });
  const header = [
    "fecha",
    "folio",
    "canal",
    "metodo",
    "moneda",
    "monto_moneda",
    "monto_usd",
    "monto_bs",
    "tasa_bcv",
    "igtf_pct",
    "igtf_usd",
    "referencia",
    "verificado",
  ];
  const rows = payments.map((p) => [
    p.createdAt.toISOString(),
    p.check.folio,
    p.check.channel,
    p.methodLabel,
    p.currency,
    (p.amountCents / 100).toFixed(2),
    (p.amountUsd / 100).toFixed(2),
    (p.amountVes / 100).toFixed(2),
    p.bcvRate.toFixed(4),
    p.igtfRate.toFixed(2),
    (p.igtfUsd / 100).toFixed(2),
    p.reference ?? "",
    p.confirmed ? "si" : "pendiente",
  ]);
  await writeAudit({
    action: "EXPORT_CAJA_FISCAL",
    reason: "Reporte diario caja/fiscal por método",
    userId: user.id,
    details: JSON.stringify({ count: payments.length }),
  });
  return {
    filename: `caja-fiscal-${from.toISOString().slice(0, 10)}.csv`,
    csv: csvFile(rows.length ? [header, ...rows] : [header]),
    note: `${payments.length} pagos del día.`,
  };
}

export async function recordCorteAction(kind: "X" | "Z"): Promise<CorteResult | { error: string }> {
  const auth = await allowAction("reports");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const from = startOfBusinessDay();
  const drafts = await prisma.fiscalDraft.findMany({
    where: { createdAt: { gte: from } },
  });
  const payments = await prisma.payment.findMany({
    where: { createdAt: { gte: from } },
  });
  const salesUsd = drafts.reduce((s, d) => s + d.subtotalUsd, 0);
  const ivaUsd = drafts.reduce((s, d) => s + d.ivaUsd, 0);
  const igtfUsd = payments.filter((p) => p.confirmed).reduce((s, p) => s + p.igtfUsd, 0);
  const totalUsd = drafts.reduce((s, d) => s + d.totalUsd, 0);
  await writeAudit({
    action: kind === "X" ? "CORTE_X" : "CORTE_Z",
    reason:
      kind === "X"
        ? "Consulta Corte X (snapshot, no cierra)"
        : "Cierre del día en Mesa (libros del POS)",
    userId: user.id,
    details: JSON.stringify({ salesUsd, ivaUsd, igtfUsd, totalUsd, drafts: drafts.length }),
  });
  return {
    kind,
    label: kind === "X" ? "Corte X (turno)" : "Corte Z (cierre del día)",
    disclaimer:
      kind === "Z"
        ? "Cierre del día en Mesa: comprobantes, IVA, IGTF y caja. No sustituye el reporte Z de una máquina fiscal (SNAT/2018/0141) si tu local la usa."
        : "Snapshot del turno. No cierra el día.",
    salesUsd,
    ivaUsd,
    igtfUsd,
    totalUsd,
    documents: drafts.length,
    payments: payments.length,
  };
}
