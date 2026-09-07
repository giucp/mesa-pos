import { enqueueJob } from "@/lib/offline-queue";
import { displayControlNumber, FISCAL_COPY } from "@/lib/fiscal";
import { checkPlaceLabel } from "@/lib/open-checks";
import { formatUsd, lineNetUsd, safeModifiers } from "@/lib/money";

export type PrintKind = "comanda" | "recibo" | "precuenta";

export type PrintLine = {
  qty: number;
  name: string;
  extras?: string;
  notes?: string | null;
  priceLabel?: string;
};

export type PrintTicket = {
  type: PrintKind;
  folio: string;
  table?: string;
  station?: string;
  lines: PrintLine[];
  footer?: string;
  totalLabel?: string;
};

function ticketHtml(ticket: PrintTicket) {
  const title =
    ticket.type === "comanda"
      ? "COMANDA COCINA"
      : ticket.type === "recibo"
        ? FISCAL_COPY.headerInternal
        : "PRECUENTA";
  const rows = ticket.lines
    .map((l) => {
      const extras = l.extras ? `<div class="muted">${escapeHtml(l.extras)}</div>` : "";
      const notes = l.notes ? `<div class="note">${escapeHtml(l.notes)}</div>` : "";
      const price = l.priceLabel ? `<span>${escapeHtml(l.priceLabel)}</span>` : "";
      return `<div class="row"><div><strong>${l.qty}× ${escapeHtml(l.name)}</strong>${extras}${notes}</div>${price}</div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${escapeHtml(ticket.folio)}</title>
<style>
  body{font-family:ui-monospace,monospace;width:280px;margin:12px auto;color:#111}
  h1{font-size:16px;margin:0 0 8px}
  .muted,.note{font-size:11px;color:#444}
  .note{font-style:italic}
  .row{display:flex;justify-content:space-between;gap:8px;margin:6px 0;font-size:13px}
  .foot{margin-top:12px;border-top:1px dashed #999;padding-top:8px;font-size:12px}
</style></head><body>
<h1>${title}</h1>
<div class="muted">${escapeHtml(ticket.folio)}${ticket.table ? ` · ${escapeHtml(ticket.table)}` : ""}${ticket.station ? ` · ${escapeHtml(ticket.station)}` : ""}</div>
${rows}
<div class="foot">${escapeHtml(ticket.totalLabel ?? "")}<div>${escapeHtml(ticket.footer ?? FISCAL_COPY.footerInternal)}</div></div>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),400)}</script>
</body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function printTicketNow(ticket: PrintTicket) {
  const html = ticketHtml(ticket);
  const popup = window.open("", "_blank", "width=360,height=640");
  if (!popup) {
    window.print();
    return { ok: false, error: "El navegador bloqueó la ventana de impresión." };
  }
  popup.document.write(html);
  popup.document.close();
  return { ok: true };
}

export function ticketFromCheck(
  type: PrintKind,
  check: {
    folio: string;
    channel?: string;
    table?: { number: string; zone?: string | null } | null;
    lines: Array<{
      qty: number;
      name: string;
      modifiers: string;
      notes?: string | null;
      status: string;
      priceUsd: number;
      discountUsd?: number | null;
      courtesy?: boolean | null;
    }>;
    fiscal?: { controlNumber: string; invoiceNumber: string; homologation?: string } | null;
  },
  extras?: { totalLabel?: string; footer?: string },
): PrintTicket {
  const lines = check.lines
    .filter((l) => l.status !== "VOID")
    .map((l) => ({
      qty: l.qty,
      name: l.name,
      extras: safeModifiers(l.modifiers)
        .map((m) => m.name)
        .join(" · "),
      notes: l.notes,
      priceLabel: type === "comanda" ? undefined : formatUsd(lineNetUsd(l)),
    }));
  const control = displayControlNumber(check.fiscal?.homologation, check.fiscal?.controlNumber);
  const invoice = check.fiscal?.invoiceNumber;
  const fiscalLine = invoice
    ? `${invoice}${control ? ` · N° control ${control}` : ""}`
    : null;
  const footer =
    extras?.footer ??
    (type === "recibo"
      ? `${fiscalLine ? `${fiscalLine}. ` : ""}${FISCAL_COPY.footerInternal}`
      : type === "precuenta"
        ? `Precuenta · ${FISCAL_COPY.statusInternal}`
        : "Comanda cocina · cola de impresión Mesa.");
  return {
    type,
    folio: check.folio,
    table: checkPlaceLabel({
      channel: check.channel ?? "LOCAL",
      table: check.table ?? null,
    }),
    lines,
    totalLabel: extras?.totalLabel,
    footer,
  };
}

export async function queueAndPrint(ticket: PrintTicket) {
  await enqueueJob({
    kind: "print",
    action: "print",
    payload: ticket as unknown as Record<string, unknown>,
  });
  return printTicketNow(ticket);
}
