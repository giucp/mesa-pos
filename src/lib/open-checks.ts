import { fiscalTotals } from "@/lib/fiscal";
import { confirmedPaymentUsd } from "@/lib/payment-status";

export const OPEN_CHECK_STATUSES = ["OPEN", "SENT", "PARTIAL"] as const;
export type OpenCheckStatus = (typeof OPEN_CHECK_STATUSES)[number];

export const CHECK_STATUS_LABEL: Record<string, string> = {
  OPEN: "Abierta",
  SENT: "En cocina",
  PARTIAL: "Pago parcial",
  PAID: "Cobrada",
  CLOSED: "Cerrada",
  VOID: "Anulada",
};

export const CHANNEL_GROUPS = ["table", "barra", "takeaway", "delivery"] as const;
export type ChannelGroup = (typeof CHANNEL_GROUPS)[number];

export const CHANNEL_GROUP_LABEL: Record<ChannelGroup, string> = {
  table: "Mesas",
  barra: "Barra",
  takeaway: "Para llevar",
  delivery: "Delivery",
};

const ABANDONED_MS = 4 * 60 * 60 * 1000;

export function startOfBusinessDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isOpenCheckStatus(status: string): status is OpenCheckStatus {
  return (OPEN_CHECK_STATUSES as readonly string[]).includes(status);
}

export function isBarraZone(zone?: string | null) {
  return (zone ?? "").trim().toLowerCase() === "barra";
}

export function isFloorTableZone(zone?: string | null) {
  return Boolean(zone && !isBarraZone(zone));
}

export function channelGroupOf(input: {
  channel: string;
  table?: { number?: string; zone?: string | null } | null;
}): ChannelGroup {
  const channel = input.channel.toUpperCase();
  if (channel === "BARRA" || channel === "BAR" || isBarraZone(input.table?.zone)) return "barra";
  if (channel === "TAKEAWAY" || channel === "PARA_LLEVAR") return "takeaway";
  if (channel === "DELIVERY" || channel === "ONLINE") return "delivery";
  if (input.table?.number && isFloorTableZone(input.table.zone)) return "table";
  if (channel === "LOCAL" && input.table?.number) return "table";
  if (channel === "LOCAL") return "table";
  return "takeaway";
}

export function isFloorOpenCheck(input: {
  channel: string;
  table?: { number?: string; zone?: string | null } | null;
}) {
  return channelGroupOf(input) === "table";
}

export function checkPlaceLabel(input: {
  channel: string;
  table?: { number: string; zone?: string | null } | null;
}) {
  const group = channelGroupOf(input);
  if (group === "table" && input.table?.number) return `Mesa ${input.table.number}`;
  if (group === "barra") {
    return input.table?.number ? `Barra ${input.table.number}` : "Barra";
  }
  if (group === "takeaway") return "Para llevar";
  if (group === "delivery") return "Delivery";
  return input.table?.number ? `Mesa ${input.table.number}` : CHANNEL_GROUP_LABEL[group];
}

function asTime(value?: Date | string | null) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Activity that resets abandoned: new item, send to kitchen, or partial pay. */
export function lastActivityAt(input: {
  createdAt: Date | string;
  sentAt?: Date | string | null;
  lines?: { createdAt?: Date | string | null; sentAt?: Date | string | null; status?: string }[];
  payments?: { createdAt?: Date | string | null }[];
}) {
  const times = [
    asTime(input.sentAt),
    ...(input.lines ?? [])
      .filter((l) => l.status !== "VOID")
      .flatMap((l) => [asTime(l.createdAt), asTime(l.sentAt)]),
    ...(input.payments ?? []).map((p) => asTime(p.createdAt)),
  ].filter((t): t is number => t != null);
  if (!times.length) return new Date(input.createdAt);
  return new Date(Math.max(...times));
}

export function isInactiveLong(
  input: Parameters<typeof lastActivityAt>[0],
  now = Date.now(),
) {
  return now - lastActivityAt(input).getTime() >= ABANDONED_MS;
}

export function isAbandonedOpenCheck(
  input: Parameters<typeof lastActivityAt>[0],
  now = new Date(),
) {
  const activity = lastActivityAt(input);
  if (activity.getTime() < startOfBusinessDay(now).getTime()) return true;
  return now.getTime() - activity.getTime() >= ABANDONED_MS;
}

export function hasOpenItems(lines?: { status: string }[]) {
  return Boolean(lines?.some((l) => l.status !== "VOID"));
}

export function remainingUsdOf(
  check: {
    tipUsd: number;
    lines: {
      qty: number;
      priceUsd: number;
      modifiers: string;
      status: string;
      ivaRate?: number | null;
      taxCode?: string | null;
      discountUsd?: number | null;
      courtesy?: boolean | null;
    }[];
    payments: { amountUsd: number; confirmed: boolean }[];
  },
  ivaRate: number,
) {
  const totals = fiscalTotals(check.lines, check.tipUsd, ivaRate);
  const paid = confirmedPaymentUsd(check.payments);
  return Math.max(0, totals.totalUsd - paid);
}

/** Open = ≥1 item (draft or sent) on a table/channel, balance ≠ 0. */
export function isOpenCheck(
  check: {
    status: string;
    tipUsd: number;
    lines: {
      qty: number;
      priceUsd: number;
      modifiers: string;
      status: string;
      ivaRate?: number | null;
      taxCode?: string | null;
      discountUsd?: number | null;
      courtesy?: boolean | null;
    }[];
    payments: { amountUsd: number; confirmed: boolean }[];
  },
  ivaRate: number,
) {
  if (!isOpenCheckStatus(check.status)) return false;
  if (!hasOpenItems(check.lines)) return false;
  return remainingUsdOf(check, ivaRate) > 0;
}

export type OpenCheck = {
  id: string;
  folio: string;
  status: string;
  channel: string;
  channelGroup: ChannelGroup;
  remainingUsd: number;
  abandoned: boolean;
  inactiveLong: boolean;
  waiterName: string | null;
  waiterId: string | null;
  tableNumber: string | null;
  tableZone: string | null;
  updatedAt: string;
  placeLabel: string;
};

type OpenCheckSource = {
  id: string;
  folio: string;
  status: string;
  channel: string;
  tipUsd: number;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  sentAt?: Date | string | null;
  table: { number: string; zone?: string | null } | null;
  waiter: { id?: string; name: string } | null;
  lines: {
    qty: number;
    priceUsd: number;
    modifiers: string;
    status: string;
    createdAt?: Date | string | null;
    sentAt?: Date | string | null;
    ivaRate?: number | null;
    taxCode?: string | null;
    discountUsd?: number | null;
    courtesy?: boolean | null;
  }[];
  payments: { amountUsd: number; confirmed: boolean; createdAt?: Date | string | null }[];
};

export function toOpenCheck(check: OpenCheckSource, ivaRate: number): OpenCheck | null {
  if (!isOpenCheck(check, ivaRate)) return null;
  const group = channelGroupOf(check);
  return {
    id: check.id,
    folio: check.folio,
    status: check.status,
    channel: check.channel,
    channelGroup: group,
    remainingUsd: remainingUsdOf(check, ivaRate),
    abandoned: isAbandonedOpenCheck(check),
    inactiveLong: isInactiveLong(check),
    waiterName: check.waiter?.name ?? null,
    waiterId: check.waiter?.id ?? null,
    tableNumber: check.table?.number ?? null,
    tableZone: check.table?.zone ?? null,
    updatedAt: lastActivityAt(check).toISOString(),
    placeLabel: checkPlaceLabel({ channel: check.channel, table: check.table }),
  };
}

/** @deprecated use toOpenCheck — kept for call sites during the rename */
export const toOpenCheckRow = toOpenCheck;

export function listOpenChecks(checks: OpenCheckSource[], ivaRate: number): OpenCheck[] {
  return checks
    .map((c) => toOpenCheck(c, ivaRate))
    .filter((c): c is OpenCheck => Boolean(c))
    .sort((a, b) => (a.abandoned === b.abandoned ? 0 : a.abandoned ? -1 : 1));
}

export function salonOpenChecks(checks: OpenCheck[]): OpenCheck[] {
  return checks.filter((c) => c.channelGroup === "table");
}

export function groupOpenChecks(checks: OpenCheck[]) {
  const abandoned = checks.filter((c) => c.abandoned);
  const active = checks.filter((c) => !c.abandoned);
  const byGroup = Object.fromEntries(
    CHANNEL_GROUPS.map((g) => [g, active.filter((c) => c.channelGroup === g)]),
  ) as Record<ChannelGroup, OpenCheck[]>;
  return { abandoned, active, byGroup };
}
