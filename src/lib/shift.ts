import { isCashMethod, parseSettleNote } from "@/lib/caja";
import { formatUsd, formatVes } from "@/lib/money";

export const DRAWER_KEY = "CAJA-1";
export const SHIFT_KIND_MESA = "MESA_INTERNO";
export const SHIFT_KIND_LABEL = "Cierre interno Mesa — no es reporte de máquina fiscal";

export type ShiftPayment = {
  id: string;
  methodKey: string;
  methodLabel: string;
  currency: string;
  amountCents: number;
  amountUsd: number;
  confirmed: boolean;
  note?: string | null;
  reference?: string | null;
  checkId?: string | null;
};

export type ShiftMove = {
  type: string;
  currency: string;
  amountCents: number;
};

export type DrawerPair = { usd: number; ves: number };

export function emptyPair(): DrawerPair {
  return { usd: 0, ves: 0 };
}

export function addToPair(pair: DrawerPair, currency: string, cents: number) {
  if (currency === "VES") pair.ves += cents;
  else pair.usd += cents;
}

export function drawerExpected(input: {
  opening: DrawerPair;
  cashHanded: DrawerPair;
  vuelto: DrawerPair;
  entradas: DrawerPair;
  salidas: DrawerPair;
}): DrawerPair {
  return {
    usd:
      input.opening.usd +
      input.cashHanded.usd -
      input.vuelto.usd +
      input.entradas.usd -
      input.salidas.usd,
    ves:
      input.opening.ves +
      input.cashHanded.ves -
      input.vuelto.ves +
      input.entradas.ves -
      input.salidas.ves,
  };
}

export function drawerDifference(expected: DrawerPair, counted: DrawerPair): DrawerPair {
  return { usd: counted.usd - expected.usd, ves: counted.ves - expected.ves };
}

export function hasDrawerDifference(diff: DrawerPair) {
  return diff.usd !== 0 || diff.ves !== 0;
}

export function differenceLabel(diff: DrawerPair) {
  const parts: string[] = [];
  for (const [ccy, n] of [
    ["USD", diff.usd],
    ["VES", diff.ves],
  ] as const) {
    if (!n) continue;
    const abs = ccy === "VES" ? formatVes(Math.abs(n)) : formatUsd(Math.abs(n));
    parts.push(`${n > 0 ? "Sobrante" : "Faltante"} ${abs}`);
  }
  return parts.length ? parts.join(" · ") : "Cuadra";
}

export function summarizeShift(input: {
  openingUsd: number;
  openingVes: number;
  payments: ShiftPayment[];
  movements: ShiftMove[];
}) {
  const opening = { usd: input.openingUsd, ves: input.openingVes };
  const cashHanded = emptyPair();
  const cashApplied = emptyPair();
  const vuelto = emptyPair();
  const entradas = emptyPair();
  const salidas = emptyPair();
  const otherConfirmed: {
    methodKey: string;
    methodLabel: string;
    currency: string;
    amountCents: number;
    amountUsd: number;
  }[] = [];
  const pending: ShiftPayment[] = [];

  for (const p of input.payments) {
    if (!p.confirmed) {
      pending.push(p);
      continue;
    }
    if (isCashMethod(p.methodKey)) {
      const settle = parseSettleNote(p.note);
      const handed = settle.tenderedCents ?? p.amountCents;
      addToPair(cashHanded, p.currency, handed);
      addToPair(cashApplied, p.currency, p.amountCents);
      addToPair(vuelto, p.currency, settle.changeCents);
    } else {
      otherConfirmed.push({
        methodKey: p.methodKey,
        methodLabel: p.methodLabel,
        currency: p.currency,
        amountCents: p.amountCents,
        amountUsd: p.amountUsd,
      });
    }
  }

  for (const m of input.movements) {
    if (m.type === "IN") addToPair(entradas, m.currency, m.amountCents);
    if (m.type === "OUT") addToPair(salidas, m.currency, m.amountCents);
  }

  const expected = drawerExpected({ opening, cashHanded, vuelto, entradas, salidas });
  return {
    opening,
    cashHanded,
    cashApplied,
    vuelto,
    entradas,
    salidas,
    expected,
    otherConfirmed,
    pending,
  };
}

export type CloseSummary = {
  kind: string;
  kindLabel: string;
  drawerKey: string;
  openedAt: string;
  closedAt: string;
  openedByName: string;
  closedByName: string;
  opening: DrawerPair;
  cashHanded: DrawerPair;
  cashApplied: DrawerPair;
  vuelto: DrawerPair;
  entradas: DrawerPair;
  salidas: DrawerPair;
  expected: DrawerPair;
  counted: DrawerPair;
  difference: DrawerPair;
  differenceLabel: string;
  otherConfirmed: {
    methodKey: string;
    methodLabel: string;
    currency: string;
    amountCents: number;
    amountUsd: number;
  }[];
  pendingTransferred: {
    id: string;
    methodLabel: string;
    reference?: string | null;
    amountCents: number;
    currency: string;
  }[];
  openChecksTransferred: { id: string; folio: string; status: string }[];
  paymentIds: string[];
  movementIds: string[];
  salesRevenueUsd: number;
};
