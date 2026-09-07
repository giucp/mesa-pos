import "server-only";

import { prisma } from "@/lib/db";
import { getBcvRate } from "@/lib/bcv";
import { normalizeRateSource } from "@/lib/bcv-label";
import {
  documentKind,
  fiscalTotals,
  resolveFiscalDocStatus,
} from "@/lib/fiscal";
import { usdToVesCents } from "@/lib/money";
import { getRestaurant, nextControlAndInvoice } from "@/lib/queries";
import { auditDetails, writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/roles";

export async function reconcileCheckPayments(checkId: string, user: SessionUser) {
  const [check, restaurant, rate] = await Promise.all([
    prisma.check.findUnique({
      where: { id: checkId },
      include: { lines: true, payments: true, fiscal: true },
    }),
    getRestaurant(),
    getBcvRate(),
  ]);
  if (!check) return { ok: false as const, error: "Cuenta no encontrada." };

  const frozenRate = check.bcvRateUsed || rate.usdToVes;
  const frozenSource = normalizeRateSource(check.bcvSource || rate.source);
  const confirmed = check.payments.filter((payment) => payment.confirmed);
  const totals = fiscalTotals(
    check.lines,
    check.tipUsd,
    restaurant.ivaRate,
    frozenRate,
    restaurant.tipInTaxableBase,
  );
  const paidUsd = confirmed.reduce((sum, payment) => sum + payment.amountUsd, 0);
  const igtfPaid = confirmed.reduce((sum, payment) => sum + payment.igtfUsd, 0);
  const remaining = totals.totalUsd - paidUsd;

  if (remaining > 2) {
    const status = paidUsd > 0 ? "PARTIAL" : check.sentAt ? "SENT" : "OPEN";
    if (check.status !== status) {
      await prisma.check.update({ where: { id: check.id }, data: { status, closedAt: null } });
    }
    return { ok: true as const, remaining, paidUsd, igtfPaid, totals, closed: false as const };
  }

  await prisma.check.update({
    where: { id: check.id },
    data: { status: "PAID", closedAt: check.closedAt ?? new Date() },
  });
  if (check.tableId) {
    const otherOpen = await prisma.check.count({
      where: {
        tableId: check.tableId,
        id: { not: check.id },
        status: { in: ["OPEN", "SENT", "PARTIAL"] },
      },
    });
    if (!otherOpen) {
      await prisma.diningTable.update({ where: { id: check.tableId }, data: { status: "FREE" } });
    }
  }

  if (!check.fiscal) {
    const docStatus = resolveFiscalDocStatus({
      adapterMf: restaurant.fiscalAdapterMf,
      adapterDigital: restaurant.fiscalAdapterDigital,
    });
    const nums = await nextControlAndInvoice();
    const blendedIgtf = paidUsd > 0 ? Math.round((igtfPaid / paidUsd) * 10000) / 100 : 0;
    const buyerRif = check.buyerRif || "V-00000000-0";
    const kind = documentKind(buyerRif);
    await prisma.fiscalDraft.create({
      data: {
        checkId: check.id,
        documentType: kind.documentType,
        ticketType: kind.ticketType,
        emitterRif: restaurant.rif,
        controlNumber: "",
        invoiceNumber: nums.invoiceNumber,
        customerName: check.buyerName || "Consumidor final",
        customerRif: buyerRif,
        customerCi: check.buyerCi || null,
        channel: check.channel,
        ivaRate: restaurant.ivaRate,
        ivaBreakdown: JSON.stringify(totals.breakdown),
        subtotalUsd: totals.subtotalUsd,
        ivaUsd: totals.ivaUsd,
        tipUsd: totals.tipUsd,
        igtfUsd: igtfPaid,
        igtfRate: blendedIgtf,
        totalUsd: totals.totalUsd + igtfPaid,
        subtotalVes: totals.subtotalVes,
        ivaVes: totals.ivaVes,
        tipVes: totals.tipVes,
        igtfVes: usdToVesCents(igtfPaid, frozenRate),
        totalVes: totals.totalVes + usdToVesCents(igtfPaid, frozenRate),
        usdRef: `USD ${(totals.totalUsd / 100).toFixed(2)}`,
        bcvRate: frozenRate,
        bcvSource: frozenSource,
        homologation: docStatus,
        adapterMf: restaurant.fiscalAdapterMf,
        adapterDigital: restaurant.fiscalAdapterDigital,
        withholdingNote: "Retenciones IVA no disponibles en esta fase",
      },
    });
    await writeAudit({
      action: "FISCAL_DOCUMENT",
      reason:
        docStatus === "internal"
          ? "Cierre de cuenta — comprobante interno (no es documento fiscal SENIAT)"
          : "Cierre de cuenta — documento por medio autorizado",
      userId: user.id,
      checkId: check.id,
      details: auditDetails({
        entity: "check",
        entityId: check.id,
        folio: check.folio,
        extra: { invoice: nums.invoiceNumber, channel: check.channel },
      }),
    });
  }

  return { ok: true as const, remaining, paidUsd, igtfPaid, totals, closed: true as const };
}
