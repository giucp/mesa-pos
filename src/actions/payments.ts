"use server";

import { prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import {
  confirmPaymentOp,
  findOpenShift,
  findPaymentByOpId,
  lookupPaymentOp,
  reopenCheckOp,
} from "@/lib/ops";
import { requireMotivo } from "@/lib/permissions";
import { getBcvRate } from "@/lib/bcv";
import { usdToVesCents } from "@/lib/money";
import {
  fiscalTotals,
  igtfOn,
  resolveIgtfRate,
} from "@/lib/fiscal";
import { getRestaurant } from "@/lib/queries";
import { writeAudit, auditDetails } from "@/lib/audit";
import { revalidatePos } from "@/lib/revalidate";
import { normalizeRateSource } from "@/lib/bcv-label";
import { DIGITAL_TENDERS } from "@/lib/pagos";
import { paymentIsConfirmed, settleNote, settleTender } from "@/lib/caja";
import { normalizePaymentOpId } from "@/lib/payment-status";
import { reconcileCheckPayments } from "@/lib/payment-reconciliation";

async function replayPayment(checkId: string, payment: {
  id: string;
  igtfUsd: number;
  igtfRate: number;
}) {
  const current = await prisma.check.findUnique({
    where: { id: checkId },
    include: { lines: true, payments: true },
  });
  if (!current) return { error: "Cuenta no encontrada." };
  const restaurant = await getRestaurant();
  const frozen = current.bcvRateUsed || (await getBcvRate()).usdToVes;
  const totals = fiscalTotals(
    current.lines,
    current.tipUsd,
    restaurant.ivaRate,
    frozen,
    restaurant.tipInTaxableBase,
  );
  const paid = current.payments.reduce(
    (sum, row) => sum + (row.confirmed ? row.amountUsd : 0),
    0,
  );
  const remaining = Math.max(0, totals.totalUsd - paid);
  return {
    ok: true as const,
    paymentId: payment.id,
    remainingUsd: remaining,
    igtfUsd: payment.igtfUsd,
    igtfRate: payment.igtfRate,
    changeUsd: Math.max(0, paid - totals.totalUsd),
    changeVes: usdToVesCents(Math.max(0, paid - totals.totalUsd), frozen),
    closed: remaining <= 2,
    duplicate: true as const,
  };
}

export async function setTipAction(checkId: string, tipUsd: number) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  await prisma.check.update({
    where: { id: checkId },
    data: { tipUsd: Math.max(0, Math.round(tipUsd)) },
  });
  revalidatePos();
}

export async function setPayerProfileAction(
  checkId: string,
  payerProfile: string,
  customRate = 0,
) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  await prisma.check.update({
    where: { id: checkId },
    data: { payerProfile, igtfCustomRate: Math.max(0, customRate) },
  });
  revalidatePos();
}

export async function setBuyerAction(checkId: string, input: {
  buyerName?: string;
  buyerRif?: string;
  buyerCi?: string;
}) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  await prisma.check.update({
    where: { id: checkId },
    data: {
      buyerName: input.buyerName?.trim() || null,
      buyerRif: input.buyerRif?.trim() || null,
      buyerCi: input.buyerCi?.trim() || null,
    },
  });
}

export async function addPaymentAction(input: {
  checkId: string;
  methodKey: string;
  amountCents: number;
  currency: string;
  reference?: string;
  customerName?: string;
  customerRif?: string;
  customerCi?: string;
  payerProfile?: string;
  igtfCustomRate?: number;
  verified?: boolean;
  idempotencyKey?: string;
}) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const idempotencyKey = normalizePaymentOpId(input.idempotencyKey);
  if (!idempotencyKey) {
    return { error: "El cobro no tiene un identificador de operación válido. Recarga e intenta de nuevo." };
  }
  const replay = await findPaymentByOpId(prisma, input.checkId, idempotencyKey);
  if (replay) return replayPayment(input.checkId, replay);

  const [check, method, restaurant, rate] = await Promise.all([
    prisma.check.findUnique({
      where: { id: input.checkId },
      include: { lines: true, payments: true, fiscal: true },
    }),
    prisma.paymentMethod.findUnique({ where: { key: input.methodKey } }),
    getRestaurant(),
    getBcvRate(),
  ]);

  if (!check) return { error: "Cuenta no encontrada." };
  if (!method || !method.enabled) return { error: "Método de pago no activo." };
  if (!["OPEN", "SENT", "PARTIAL"].includes(check.status)) {
    return { error: "Esta cuenta no se puede cobrar." };
  }
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    return { error: "El monto debe ser mayor a cero." };
  }
  if ((input.currency !== "USD" && input.currency !== "VES") || input.currency !== method.currency) {
    return { error: "La moneda no corresponde al método de pago." };
  }

  const needsRef = (DIGITAL_TENDERS as readonly string[]).includes(method.key);
  if (needsRef && !input.reference?.trim()) {
    return { error: "Ingresa la referencia o confirmación manual." };
  }

  const frozenRate = check.bcvRateUsed || rate.usdToVes;
  const frozenSource = normalizeRateSource(check.bcvSource || rate.source);
  const frozenAt = check.bcvFetchedAt || rate.fetchedAt;
  const totalsBefore = fiscalTotals(
    check.lines,
    check.tipUsd,
    restaurant.ivaRate,
    frozenRate,
    restaurant.tipInTaxableBase,
  );
  const paidBefore = check.payments.reduce((s, p) => s + (p.confirmed ? p.amountUsd : 0), 0);
  const remainingUsd = Math.max(0, totalsBefore.totalUsd - paidBefore);
  if (remainingUsd <= 2) {
    return { error: "Esta cuenta ya está cubierta. No se registró otro pago." };
  }

  const settle = settleTender({
    tenderedCents: input.amountCents,
    currency: input.currency,
    remainingUsd,
    rate: frozenRate,
  });
  if (settle.appliedUsd <= 0) {
    return { error: "El monto debe cubrir al menos un céntimo del saldo." };
  }

  const recentTwin = await prisma.payment.findFirst({
    where: {
      checkId: check.id,
      methodKey: method.key,
      amountCents: settle.appliedCents,
      reference: input.reference?.trim() || null,
      createdAt: { gte: new Date(Date.now() - 4000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recentTwin) {
    return { error: "Ese cobro ya se registró. Revisa la lista de pagos." };
  }

  const profile = input.payerProfile || check.payerProfile;
  const igtfRate = resolveIgtfRate({
    methodProfile: method.igtfProfile,
    checkProfile: profile,
    customRate: input.igtfCustomRate ?? check.igtfCustomRate,
    bancarizadoRate: restaurant.igtfBancarizadoRate,
    forexRate: restaurant.igtfForexRate,
  });
  const igtfUsd = igtfOn(settle.appliedUsd, igtfRate);
  const confirmed = paymentIsConfirmed({ methodKey: method.key, verified: input.verified });
  const openShift = await findOpenShift(prisma);

  let payment;
  try {
    payment = await prisma.payment.create({
      data: {
        checkId: check.id,
        methodKey: method.key,
        methodLabel: method.label,
        currency: input.currency,
        amountCents: settle.appliedCents,
        amountUsd: settle.appliedUsd,
        amountVes: settle.appliedVes,
        shiftId: openShift?.id ?? null,
        bcvRate: frozenRate,
        bcvSource: frozenSource,
        bcvFetchedAt: frozenAt,
        igtfRate,
        igtfUsd,
        igtfVes: usdToVesCents(igtfUsd, frozenRate),
        reference: input.reference?.trim() || null,
        confirmed,
        clientOpId: idempotencyKey,
        note: settleNote({
          tenderedCents: settle.tenderedCents,
          changeCents: settle.changeCents,
          idempotencyKey,
          extra: needsRef ? "Registro manual / confirmación" : settle.changeCents ? "Vuelto descontado del efectivo" : null,
        }),
      },
    });
  } catch (e) {
    const existing = await findPaymentByOpId(prisma, input.checkId, idempotencyKey);
    if (existing) return replayPayment(input.checkId, existing);
    return { error: e instanceof Error ? e.message : "No se pudo registrar el pago." };
  }
  if (confirmed && (DIGITAL_TENDERS as readonly string[]).includes(method.key)) {
    await writeAudit({
      action: "PAYMENT_CONFIRM",
      reason: "Caja confirmó el pago al cobrar",
      userId: user.id,
      checkId: check.id,
      details: auditDetails({
        entity: "payment",
        entityId: payment.id,
        folio: check.folio,
        from: { confirmed: false, method: method.key, reference: input.reference ?? null },
        to: { confirmed: true },
      }),
    });
  }

  await prisma.check.update({
    where: { id: check.id },
    data: {
      payerProfile: profile,
      igtfCustomRate: input.igtfCustomRate ?? check.igtfCustomRate,
      ...(check.bcvRateUsed
        ? {}
        : {
            bcvRateUsed: frozenRate,
            bcvSource: frozenSource,
            bcvFetchedAt: frozenAt,
          }),
      buyerName: input.customerName?.trim() || check.buyerName,
      buyerRif: input.customerRif?.trim() || check.buyerRif,
      buyerCi: input.customerCi?.trim() || check.buyerCi,
    },
  });

  const reconciled = await reconcileCheckPayments(check.id, user);
  if (!reconciled.ok) return { error: reconciled.error };
  const remaining = reconciled.remaining;

  revalidatePos();

  return {
    ok: true as const,
    paymentId: payment.id,
    remainingUsd: Math.max(0, remaining),
    igtfUsd,
    igtfRate,
    changeUsd: settle.changeUsd,
    changeVes: settle.changeVes,
    closed: remaining <= 2,
  };
}

export async function overrideTicketRateAction(checkId: string, rate: number, reason: string) {
  const auth = await allowAction("adjust");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const motivo = requireMotivo(reason);
  if (!motivo.ok) return { error: motivo.error };
  if (!Number.isFinite(rate) || rate <= 0) return { error: "Tasa BCV inválida." };
  const check = await prisma.check.findUnique({
    where: { id: checkId },
    include: { payments: true },
  });
  if (!check) return { error: "Cuenta no encontrada." };
  if (check.payments.length) {
    return { error: "No se reescribe la tasa de un ticket con pagos." };
  }
  const from = check.bcvRateUsed;
  await prisma.check.update({
    where: { id: checkId },
    data: {
      bcvRateUsed: rate,
      bcvSource: "manual",
      bcvFetchedAt: new Date(),
    },
  });
  await writeAudit({
    action: "BCV_TICKET_OVERRIDE",
    reason: motivo.reason,
    userId: user.id,
    checkId,
    details: auditDetails({ entity: "check", entityId: checkId, from, to: rate }),
  });
  revalidatePos();
  return { ok: true };
}

export async function recordArqueoAction(input: {
  countedUsdCents: number;
  countedVesCents: number;
  note?: string;
}) {
  const auth = await allowAction("reports");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  await writeAudit({
    action: "ARQUEO_CAJA",
    reason: input.note?.trim() || "Arqueo de efectivo del turno",
    userId: user.id,
    details: JSON.stringify({
      countedUsdCents: input.countedUsdCents,
      countedVesCents: input.countedVesCents,
    }),
  });
  revalidatePos();
  return { ok: true };
}

export async function closePaidCheckAction(checkId: string) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  const check = await prisma.check.findUnique({ where: { id: checkId } });
  if (!check || check.status !== "PAID") return { error: "La cuenta no está pagada." };
  await prisma.check.update({
    where: { id: checkId },
    data: { status: "CLOSED", closedAt: check.closedAt ?? new Date() },
  });
  revalidatePos();
  return { ok: true };
}

export async function verifyPaymentStatusAction(checkId: string, opId: string) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error, status: "unknown" as const };
  const found = await lookupPaymentOp(prisma, checkId, opId);
  return { ok: true as const, ...found };
}

export async function confirmPaymentAction(paymentId: string) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { checkId: true } });
  if (!payment) return { error: "Pago no encontrado." };
  const res = await confirmPaymentOp(prisma, auth.user, paymentId);
  if (!res.ok) return { error: res.error };
  const reconciled = await reconcileCheckPayments(payment.checkId, auth.user);
  if (!reconciled.ok) return { error: reconciled.error };
  revalidatePos();
  return { ok: true, closed: reconciled.closed, remainingUsd: Math.max(0, reconciled.remaining) };
}

export async function reopenCheckAction(checkId: string, reason: string) {
  const auth = await allowAction("void");
  if (!auth.ok) return { error: auth.error };
  const res = await reopenCheckOp(prisma, auth.user, checkId, reason);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}
