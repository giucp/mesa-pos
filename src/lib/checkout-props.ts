import { prisma } from "@/lib/db";
import { getBcvRate } from "@/lib/bcv";
import { getCheck, getRestaurant } from "@/lib/queries";

export async function loadCheckout(checkId: string) {
  const [check, restaurant, rate, methods] = await Promise.all([
    getCheck(checkId),
    getRestaurant(),
    getBcvRate(),
    prisma.paymentMethod.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  if (!check) return null;
  return {
    rate: rate.usdToVes,
    rateSource: rate.source,
    rateAt: rate.fetchedAt.toISOString(),
    restaurant: {
      name: restaurant.name,
      ivaRate: restaurant.ivaRate,
      igtfBancarizadoRate: restaurant.igtfBancarizadoRate,
      igtfForexRate: restaurant.igtfForexRate,
      tipInTaxableBase: restaurant.tipInTaxableBase,
      rif: restaurant.rif,
      fiscalAdapterMf: restaurant.fiscalAdapterMf,
      fiscalAdapterDigital: restaurant.fiscalAdapterDigital,
    },
    methods,
    check: {
      id: check.id,
      folio: check.folio,
      status: check.status,
      tipUsd: check.tipUsd,
      channel: check.channel,
      payerProfile: check.payerProfile,
      igtfCustomRate: check.igtfCustomRate,
      bcvRateUsed: check.bcvRateUsed,
      bcvSource: check.bcvSource,
      bcvFetchedAt: check.bcvFetchedAt?.toISOString() ?? null,
      buyerName: check.buyerName,
      buyerRif: check.buyerRif,
      buyerCi: check.buyerCi,
      table: check.table ? { id: check.table.id, number: check.table.number } : null,
      lines: check.lines,
      payments: check.payments,
      fiscal: check.fiscal
        ? {
            controlNumber: check.fiscal.controlNumber,
            invoiceNumber: check.fiscal.invoiceNumber,
            documentType: check.fiscal.documentType,
            ticketType: check.fiscal.ticketType,
            homologation: check.fiscal.homologation,
            customerName: check.fiscal.customerName,
            customerRif: check.fiscal.customerRif,
            customerCi: check.fiscal.customerCi,
            ivaBreakdown: check.fiscal.ivaBreakdown,
            ivaUsd: check.fiscal.ivaUsd,
            igtfUsd: check.fiscal.igtfUsd,
            totalUsd: check.fiscal.totalUsd,
            bcvRate: check.fiscal.bcvRate,
            bcvSource: check.fiscal.bcvSource,
            emitterRif: check.fiscal.emitterRif,
          }
        : null,
    },
  };
}
