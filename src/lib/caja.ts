import { formatUsd, formatVes, usdToVesCents, vesToUsdCents } from "@/lib/money";
import { DIGITAL_TENDERS } from "@/lib/pagos";

export const CASH_METHODS = ["CASH_USD", "CASH_VES"] as const;

export function isCashMethod(key: string) {
  return key === "CASH_USD" || key === "CASH_VES";
}

export function isDigitalMethod(key: string) {
  return (DIGITAL_TENDERS as readonly string[]).includes(key);
}

/** Digital methods stay pending until caja marks verified. Cash defaults verified. */
export function paymentIsConfirmed(input: { methodKey: string; verified?: boolean }) {
  if (isDigitalMethod(input.methodKey)) return input.verified === true;
  return input.verified !== false;
}

export function isReceivedPayment(p: { confirmed: boolean }) {
  return p.confirmed === true;
}

export function settleNote(input: {
  tenderedCents: number;
  changeCents: number;
  idempotencyKey?: string;
  extra?: string | null;
}) {
  const parts = [`SETTLE t=${Math.round(input.tenderedCents)} c=${Math.round(input.changeCents)}`];
  if (input.idempotencyKey) parts.push(`k=${input.idempotencyKey}`);
  if (input.extra) parts.push(input.extra);
  return parts.join(" | ");
}

export function formatNative(currency: string, cents: number) {
  return currency === "VES" ? formatVes(cents) : formatUsd(cents);
}

/** Display-only: handed / applied / change / drawer net. Does not change settle math. */
export function describePaymentSettle(p: {
  currency: string;
  amountCents: number;
  confirmed?: boolean;
  note?: string | null;
}) {
  const settle = parseSettleNote(p.note);
  const handedCents = settle.tenderedCents ?? p.amountCents;
  const appliedCents = p.amountCents;
  const changeCents = settle.changeCents;
  const confirmed = p.confirmed === true;
  const cajaNetCents = confirmed ? appliedCents : 0;
  const registeredCents = appliedCents;
  return {
    handedCents,
    appliedCents,
    registeredCents,
    changeCents,
    cajaNetCents,
    confirmed,
    coversBalance: confirmed,
    handedLabel: formatNative(p.currency, handedCents),
    appliedLabel: formatNative(p.currency, appliedCents),
    registeredLabel: formatNative(p.currency, registeredCents),
    appliedToBalanceLabel: confirmed
      ? formatNative(p.currency, appliedCents)
      : "no aplicado al saldo",
    changeLabel: formatNative(p.currency, changeCents),
    cajaNetLabel: confirmed ? formatNative(p.currency, cajaNetCents) : "no entra a caja",
  };
}

export function parseSettleNote(note?: string | null) {
  if (!note || !note.includes("SETTLE")) {
    return { tenderedCents: null as number | null, changeCents: 0, idempotencyKey: null as string | null };
  }
  const tendered = /t=(\d+)/.exec(note);
  const change = /c=(\d+)/.exec(note);
  const key = /k=([A-Za-z0-9-]+)/.exec(note);
  return {
    tenderedCents: tendered ? Number(tendered[1]) : null,
    changeCents: change ? Number(change[1]) : 0,
    idempotencyKey: key?.[1] ?? null,
  };
}

export type TenderSettle = {
  tenderedCents: number;
  appliedCents: number;
  appliedUsd: number;
  appliedVes: number;
  changeCents: number;
  changeUsd: number;
  changeVes: number;
  tenderedUsd: number;
};

export function settleTender(input: {
  tenderedCents: number;
  currency: string;
  remainingUsd: number;
  rate: number;
}): TenderSettle {
  const tenderedCents = Math.max(0, Math.round(input.tenderedCents));
  const remainingUsd = Math.max(0, Math.round(input.remainingUsd));
  // VES tenders stay in Bs. Do not invent vuelto by converting the already-
  // rounded USD book amount back to Bs (that produced the P2-A "Bs 0,49").
  const remainingVes = usdToVesCents(remainingUsd, input.rate);
  const appliedCents =
    input.currency === "VES"
      ? Math.min(tenderedCents, remainingVes)
      : Math.min(tenderedCents, remainingUsd);
  const changeCents = Math.max(0, tenderedCents - appliedCents);
  const appliedUsd =
    input.currency === "VES" ? vesToUsdCents(appliedCents, input.rate) : appliedCents;
  const appliedVes =
    input.currency === "VES" ? appliedCents : usdToVesCents(appliedUsd, input.rate);
  const changeUsd =
    input.currency === "VES" ? vesToUsdCents(changeCents, input.rate) : changeCents;
  const changeVes =
    input.currency === "VES" ? changeCents : usdToVesCents(changeUsd, input.rate);
  const tenderedUsd =
    input.currency === "VES" ? vesToUsdCents(tenderedCents, input.rate) : tenderedCents;
  return {
    tenderedCents,
    appliedCents,
    appliedUsd,
    appliedVes,
    changeCents,
    changeUsd,
    changeVes,
    tenderedUsd,
  };
}

export type CajaPayment = {
  methodKey: string;
  methodLabel: string;
  currency: string;
  amountCents: number;
  amountUsd: number;
  amountVes: number;
  igtfUsd: number;
  confirmed: boolean;
  changeCents?: number | null;
  tenderedCents?: number | null;
  bcvRate?: number | null;
};

export function summarizePayments(
  payments: CajaPayment[],
  ticketRate: number,
) {
  const methodMap = new Map<
    string,
    {
      key: string;
      label: string;
      count: number;
      usd: number;
      ves: number;
      nativeUsd: number;
      nativeVes: number;
      igtfUsd: number;
      verified: number;
      pendingCount: number;
      pendingUsd: number;
    }
  >();
  const currMap = new Map<string, { currency: string; count: number; native: number; usd: number }>();
  let cashUsd = 0;
  let cashVes = 0;
  let receivedUsd = 0;
  let pendingUsd = 0;
  let igtfUsd = 0;
  let rateDeltaVes = 0;
  let collectedVes = 0;

  for (const p of payments) {
    const m = methodMap.get(p.methodKey) ?? {
      key: p.methodKey,
      label: p.methodLabel,
      count: 0,
      usd: 0,
      ves: 0,
      nativeUsd: 0,
      nativeVes: 0,
      igtfUsd: 0,
      verified: 0,
      pendingCount: 0,
      pendingUsd: 0,
    };
    m.count += 1;
    if (!isReceivedPayment(p)) {
      m.pendingCount += 1;
      m.pendingUsd += p.amountUsd;
      pendingUsd += p.amountUsd;
      methodMap.set(p.methodKey, m);
      continue;
    }
    m.usd += p.amountUsd;
    m.igtfUsd += p.igtfUsd;
    m.verified += 1;
    igtfUsd += p.igtfUsd;
    receivedUsd += p.amountUsd;
    if (p.currency === "VES") {
      m.ves += p.amountCents;
      m.nativeVes += p.amountCents;
      collectedVes += p.amountCents;
    } else {
      m.nativeUsd += p.amountCents;
    }
    rateDeltaVes += p.amountVes - usdToVesCents(p.amountUsd, p.bcvRate || ticketRate);
    methodMap.set(p.methodKey, m);

    const cur = currMap.get(p.currency) ?? { currency: p.currency, count: 0, native: 0, usd: 0 };
    cur.count += 1;
    cur.native += p.amountCents;
    cur.usd += p.amountUsd;
    currMap.set(p.currency, cur);

    if (p.methodKey === "CASH_USD") cashUsd += p.amountCents;
    if (p.methodKey === "CASH_VES") cashVes += p.amountCents;
  }

  return {
    methodMap,
    currMap,
    cashUsd,
    cashVes,
    receivedUsd,
    pendingUsd,
    igtfUsd,
    rateDeltaVes,
    collectedVes,
  };
}
