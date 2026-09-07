import { formatUsd, formatVes } from "@/lib/money";

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  SHIFT_OPEN: "Apertura de turno",
  SHIFT_IN: "Entrada de efectivo",
  SHIFT_OUT: "Salida de efectivo",
  SHIFT_CORRECTION: "Corrección de turno",
  SHIFT_CLOSE: "Cierre de turno",
  PAYMENT_CONFIRM: "Confirmación de pago",
  COURTESY: "Cortesía",
  DISCOUNT: "Descuento",
  VOID: "Anulación",
  PRICE_CHANGE: "Cambio de precio",
  TAX_CHANGE: "Cambio de IVA",
  REOPEN_CHECK: "Reapertura de cuenta",
  BCV_TICKET_OVERRIDE: "Tasa BCV del ticket",
  ARQUEO_CAJA: "Arqueo de caja",
  FISCAL_DOCUMENT: "Comprobante interno",
  STOCK_ENTRADA: "Entrada de inventario",
  STOCK_AJUSTE: "Ajuste de inventario",
  STOCK_MERMA: "Merma de inventario",
  STOCK_CONTROL: "Control de existencias",
};

export type AuditPayload = {
  entity?: string;
  entityId?: string;
  folio?: string | null;
  itemName?: string | null;
  from?: unknown;
  to?: unknown;
  type?: string;
  qty?: number;
  unit?: string;
  currency?: string;
  amountCents?: number;
  concept?: string;
  shiftId?: string;
  countedUsdCents?: number;
  countedVesCents?: number;
};

export function parseAuditDetails(raw: string | null | undefined): AuditPayload {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as AuditPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function moneyLabel(currency: string | undefined, cents: number | undefined) {
  if (cents == null || !Number.isFinite(cents)) return null;
  return currency === "VES" ? formatVes(cents) : formatUsd(cents);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pairLabel(pair: unknown) {
  const rec = asRecord(pair);
  if (!rec) return null;
  const usd = typeof rec.usd === "number" ? formatUsd(rec.usd) : null;
  const ves = typeof rec.ves === "number" ? formatVes(rec.ves) : null;
  return [usd, ves].filter(Boolean).join(" · ") || null;
}

function centsField(rec: Record<string, unknown> | null, key: string) {
  if (!rec) return null;
  const n = rec[key];
  return typeof n === "number" ? n : null;
}

/** Visible row: action + amounts. Codes, JSON and cents stay in the collapsible. */
export function auditHeadline(action: string, payload: AuditPayload) {
  const label = AUDIT_ACTION_LABEL[action] ?? action.replaceAll("_", " ");
  const bits: string[] = [label];

  const amount = moneyLabel(payload.currency, payload.amountCents);
  if (amount) bits.push(amount);
  if (payload.concept) bits.push(payload.concept);
  if (payload.folio) bits.push(payload.folio);
  if (payload.itemName) bits.push(payload.itemName);

  const to = asRecord(payload.to);
  const from = asRecord(payload.from);
  const openingUsd = centsField(to, "openingUsd");
  const openingVes = centsField(to, "openingVes");
  if (openingUsd != null) bits.push(formatUsd(openingUsd));
  if (openingVes != null) bits.push(formatVes(openingVes));

  const countedUsd = payload.countedUsdCents ?? centsField(to, "countedUsdCents");
  const countedVes = payload.countedVesCents ?? centsField(to, "countedVesCents");
  if (countedUsd != null) bits.push(`contado ${formatUsd(countedUsd)}`);
  if (countedVes != null) bits.push(formatVes(countedVes));

  const difference = pairLabel(to?.difference);
  if (difference) bits.push(difference);
  const expected = pairLabel(to?.expected);
  if (expected && action === "SHIFT_CLOSE") bits.push(`esperado ${expected}`);

  const fromPrice = centsField(from, "priceUsd");
  const toPrice = centsField(to, "priceUsd");
  if (fromPrice != null && toPrice != null) bits.push(`${formatUsd(fromPrice)} → ${formatUsd(toPrice)}`);

  const fromDisc = centsField(from, "discountUsd");
  const toDisc = centsField(to, "discountUsd");
  if (fromDisc != null && toDisc != null) bits.push(`${formatUsd(fromDisc)} → ${formatUsd(toDisc)}`);

  const fromStock = centsField(from, "stockQty");
  const toStock = centsField(to, "stockQty");
  if (fromStock != null && toStock != null) {
    bits.push(`${fromStock} → ${toStock}${payload.unit ? ` ${payload.unit}` : ""}`);
  } else if (payload.qty != null && action.startsWith("STOCK_")) {
    bits.push(`${payload.qty > 0 ? "+" : ""}${payload.qty}${payload.unit ? ` ${payload.unit}` : ""}`);
  }

  const fromTax = typeof from?.taxCode === "string" ? from.taxCode : null;
  const toTax = typeof to?.taxCode === "string" ? to.taxCode : null;
  if (fromTax && toTax) bits.push(`${fromTax} → ${toTax}`);

  const fromRate = typeof payload.from === "number" ? payload.from : null;
  const toRate = typeof payload.to === "number" ? payload.to : null;
  if (fromRate != null && toRate != null && !action.startsWith("STOCK_")) {
    bits.push(`${fromRate} → ${toRate} Bs/USD`);
  }

  return bits.join(" · ");
}

export function auditRawLines(action: string, payload: AuditPayload, raw: string) {
  const lines: string[] = [`código ${action}`];
  if (payload.entity) lines.push(`entidad ${payload.entity}${payload.entityId ? ` ${payload.entityId}` : ""}`);
  if (payload.shiftId) lines.push(`turno ${payload.shiftId}`);
  if (payload.amountCents != null) {
    lines.push(`céntimos internos ${payload.amountCents} (${payload.currency ?? "?"})`);
  }
  if (payload.from != null) lines.push(`de ${JSON.stringify(payload.from)}`);
  if (payload.to != null) lines.push(`→ ${JSON.stringify(payload.to)}`);
  lines.push(raw || "{}");
  return lines.join("\n");
}
