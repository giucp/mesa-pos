/**
 * Isolated Phase 2 sales. Never points at production Postgres.
 * Stable folios so Giucp can reopen the same tickets.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fiscalTotals } from "../src/lib/fiscal";
import { formatUsd, formatVes, usdToVesCents } from "../src/lib/money";
import { FASE2_FOLIOS, FASE2_PENDING_REF } from "../src/lib/isolated-demo";
import {
  parseSettleNote,
  paymentIsConfirmed,
  settleNote,
  settleTender,
  summarizePayments,
} from "../src/lib/caja";
import { isolatedPrisma } from "./isolated-target";

const prisma = isolatedPrisma("phase2-sales");

async function main() {
  const [waiter, restaurant, item, cashUsd, cashVes, pagoMovil] = await Promise.all([
    prisma.user.findFirst({ where: { role: "ADMIN" } }),
    prisma.restaurant.findFirst(),
    prisma.item.findFirst({ where: { name: "Arepa Reina Pepiada", available: true } }),
    prisma.paymentMethod.findUnique({ where: { key: "CASH_USD" } }),
    prisma.paymentMethod.findUnique({ where: { key: "CASH_VES" } }),
    prisma.paymentMethod.findUnique({ where: { key: "PAGO_MOVIL" } }),
  ]);
  assert.ok(waiter && restaurant && item && cashUsd && cashVes && pagoMovil);
  const rate = restaurant.bcvRate || 148.52;

  await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: { name: "Café Ávila · DEMO FASE 2 (aislado)" },
  });

  const stale = await prisma.check.findMany({
    where: { folio: { in: Object.values(FASE2_FOLIOS) } },
    select: { id: true },
  });
  if (stale.length) {
    await prisma.check.deleteMany({ where: { id: { in: stale.map((c) => c.id) } } });
  }

  async function sale(folio: string, invoice: string, pay: (checkId: string, remainingUsd: number) => Promise<void>) {
    const check = await prisma.check.create({
      data: {
        folio,
        channel: "TAKEAWAY",
        status: "OPEN",
        waiterId: waiter!.id,
        guestCount: 1,
        bcvRateUsed: rate,
        bcvSource: "seed",
        bcvFetchedAt: new Date(),
      },
    });
    await prisma.orderLine.create({
      data: {
        checkId: check.id,
        itemId: item!.id,
        name: item!.name,
        qty: 1,
        priceUsd: item!.priceUsd,
        modifiers: "[]",
        status: "HELD",
        stationId: item!.stationId,
        taxCode: item!.taxCode,
        ivaRate: item!.ivaRate,
      },
    });
    const held = await prisma.orderLine.findMany({ where: { checkId: check.id, status: "HELD" } });
    await prisma.orderLine.updateMany({
      where: { id: { in: held.map((l) => l.id) } },
      data: { status: "FIRED", sentAt: new Date() },
    });
    const fired = await prisma.orderLine.findMany({ where: { checkId: check.id, status: "FIRED" } });
    assert.equal(fired.length, 1);
    assert.equal(fired[0].stationId, item!.stationId);
    await prisma.orderLine.updateMany({
      where: { checkId: check.id, stationId: item!.stationId, status: "FIRED" },
      data: { status: "BUMPED", bumpedAt: new Date() },
    });
    const lines = await prisma.orderLine.findMany({ where: { checkId: check.id } });
    const totals = fiscalTotals(lines, 0, restaurant!.ivaRate, rate, restaurant!.tipInTaxableBase);
    await pay(check.id, totals.totalUsd);
    const closed = await prisma.check.findUnique({
      where: { id: check.id },
      include: { lines: true, payments: true, fiscal: true },
    });
    assert.ok(closed);
    const after = fiscalTotals(closed.lines, closed.tipUsd, restaurant!.ivaRate, rate, restaurant!.tipInTaxableBase);
    const paidUsd = closed.payments.reduce((s, p) => s + p.amountUsd, 0);
    assert.ok(after.totalUsd - paidUsd <= 2, `${folio} remaining ${after.totalUsd - paidUsd}`);
    if (!closed.fiscal) {
      await prisma.fiscalDraft.create({
        data: {
          checkId: closed.id,
          documentType: "BORRADOR_FISCAL",
          ticketType: "TICKET_INTERNO",
          emitterRif: restaurant!.rif,
          invoiceNumber: invoice,
          customerName: "Consumidor final",
          customerRif: "V-00000000-0",
          channel: "TAKEAWAY",
          ivaRate: restaurant!.ivaRate,
          ivaBreakdown: JSON.stringify(after.breakdown),
          subtotalUsd: after.subtotalUsd,
          ivaUsd: after.ivaUsd,
          tipUsd: 0,
          igtfUsd: closed.payments.reduce((s, p) => s + p.igtfUsd, 0),
          totalUsd: after.totalUsd,
          subtotalVes: after.subtotalVes,
          ivaVes: after.ivaVes,
          tipVes: 0,
          igtfVes: 0,
          totalVes: after.totalVes,
          usdRef: `USD ${(after.totalUsd / 100).toFixed(2)}`,
          bcvRate: rate,
          bcvSource: "seed",
          homologation: "internal",
        },
      });
    }
    await prisma.check.update({
      where: { id: check.id },
      data: { status: "PAID", closedAt: new Date() },
    });
    const final = await prisma.check.findUnique({
      where: { id: check.id },
      include: { lines: true, payments: true, fiscal: true },
    });
    assert.ok(final?.fiscal);
    assert.deepEqual(
      final.lines.filter((l) => l.status !== "VOID").map((l) => l.name),
      [item!.name],
    );
    assert.equal(final.fiscal.bcvRate, rate);
    return final;
  }

  async function recordPay(input: {
    checkId: string;
    method: { key: string; label: string; currency: string };
    tenderedCents: number;
    remainingUsd: number;
    verified?: boolean;
    reference?: string;
    idem?: string;
  }) {
    const settle = settleTender({
      tenderedCents: input.tenderedCents,
      currency: input.method.currency,
      remainingUsd: input.remainingUsd,
      rate,
    });
    return prisma.payment.create({
      data: {
        checkId: input.checkId,
        methodKey: input.method.key,
        methodLabel: input.method.label,
        currency: input.method.currency,
        amountCents: settle.appliedCents,
        amountUsd: settle.appliedUsd,
        amountVes: settle.appliedVes,
        bcvRate: rate,
        bcvSource: "seed",
        igtfUsd: 0,
        reference: input.reference ?? null,
        confirmed: paymentIsConfirmed({ methodKey: input.method.key, verified: input.verified }),
        note: settleNote({
          tenderedCents: settle.tenderedCents,
          changeCents: settle.changeCents,
          idempotencyKey: input.idem,
        }),
      },
    });
  }

  const a = await sale(FASE2_FOLIOS.A, "MESA-P2-A", async (checkId, remaining) => {
    await recordPay({
      checkId,
      method: cashUsd!,
      tenderedCents: remaining,
      remainingUsd: remaining,
      verified: true,
      idem: `a-${checkId}`,
    });
  });

  const b = await sale(FASE2_FOLIOS.B, "MESA-P2-B", async (checkId, remaining) => {
    await recordPay({
      checkId,
      method: cashVes!,
      tenderedCents: usdToVesCents(remaining, rate),
      remainingUsd: remaining,
      verified: true,
    });
  });

  const c = await sale(FASE2_FOLIOS.C, "MESA-P2-C", async (checkId, remaining) => {
    const half = Math.round(remaining / 2);
    await recordPay({
      checkId,
      method: cashUsd!,
      tenderedCents: half,
      remainingUsd: remaining,
      verified: true,
    });
    const vesOver = usdToVesCents(remaining, rate) + 50000;
    const second = await recordPay({
      checkId,
      method: cashVes!,
      tenderedCents: vesOver,
      remainingUsd: remaining - half,
      verified: true,
    });
    assert.ok(second.amountCents < vesOver);
  });

  const pending = await recordPay({
    checkId: a.id,
    method: pagoMovil!,
    tenderedCents: 10000,
    remainingUsd: 10000,
    verified: false,
    reference: FASE2_PENDING_REF,
  });
  assert.equal(pending.confirmed, false);
  assert.equal(pending.amountCents, 10000, "P2-A Pago Móvil keeps original Bs 100");
  assert.equal(pending.amountVes, 10000);
  const pendingSettle = parseSettleNote(pending.note);
  assert.equal(pendingSettle.tenderedCents, 10000);
  assert.equal(pendingSettle.changeCents, 0, "pending P2-A has no real vuelto");

  const retry = await prisma.payment.findFirst({
    where: { checkId: a.id, note: { contains: `k=a-${a.id}` } },
  });
  assert.ok(retry);
  const countACash = await prisma.payment.count({
    where: { checkId: a.id, methodKey: "CASH_USD" },
  });
  assert.equal(countACash, 1);

  const allPays = [...a.payments, pending, ...b.payments, ...c.payments];
  const caja = summarizePayments(
    allPays.map((p) => ({
      methodKey: p.methodKey,
      methodLabel: p.methodLabel,
      currency: p.currency,
      amountCents: p.amountCents,
      amountUsd: p.amountUsd,
      amountVes: p.amountVes,
      igtfUsd: p.igtfUsd,
      confirmed: p.confirmed,
    })),
    rate,
  );

  const aTot = fiscalTotals(a.lines, 0, restaurant.ivaRate, rate, restaurant.tipInTaxableBase);
  const bTot = fiscalTotals(b.lines, 0, restaurant.ivaRate, rate, restaurant.tipInTaxableBase);
  const cTot = fiscalTotals(c.lines, 0, restaurant.ivaRate, rate, restaurant.tipInTaxableBase);
  const cUsd = c.payments.find((p) => p.methodKey === "CASH_USD");
  const cVes = c.payments.find((p) => p.methodKey === "CASH_VES");
  const cSettle = settleTender({
    tenderedCents: usdToVesCents(aTot.totalUsd, rate) + 50000,
    currency: "VES",
    remainingUsd: aTot.totalUsd - Math.round(aTot.totalUsd / 2),
    rate,
  });

  const evidence = {
    isolated: true,
    productionTouched: false,
    item: item.name,
    rate,
    rateSource: "seed",
    sales: [
      {
        id: "A",
        folio: a.folio,
        checkId: a.id,
        invoice: a.fiscal?.invoiceNumber,
        totalUsd: aTot.totalUsd,
        totalLabel: formatUsd(aTot.totalUsd),
        payments: a.payments.map((p) => ({
          method: p.methodLabel,
          confirmed: p.confirmed,
          applied: formatUsd(p.amountUsd),
        })),
        pendingUsd: 0,
        vueltoUsd: 0,
        expectedCaja: { cashUsd: aTot.totalUsd, cashVes: 0 },
        actualAppliedUsd: a.payments.reduce((s, p) => s + p.amountUsd, 0),
      },
      {
        id: "B",
        folio: b.folio,
        checkId: b.id,
        invoice: b.fiscal?.invoiceNumber,
        totalUsd: bTot.totalUsd,
        totalLabel: formatUsd(bTot.totalUsd),
        payments: b.payments.map((p) => ({
          method: p.methodLabel,
          confirmed: p.confirmed,
          applied: formatVes(p.amountCents),
        })),
        pendingUsd: 0,
        vueltoUsd: 0,
        expectedCaja: { cashUsd: 0, cashVes: b.payments[0].amountCents },
        actualAppliedUsd: b.payments.reduce((s, p) => s + p.amountUsd, 0),
      },
      {
        id: "C",
        folio: c.folio,
        checkId: c.id,
        invoice: c.fiscal?.invoiceNumber,
        totalUsd: cTot.totalUsd,
        totalLabel: formatUsd(cTot.totalUsd),
        payments: c.payments.map((p) => ({
          method: p.methodLabel,
          confirmed: p.confirmed,
          applied: p.currency === "VES" ? formatVes(p.amountCents) : formatUsd(p.amountUsd),
        })),
        pendingUsd: 0,
        vueltoUsd: cSettle.changeUsd,
        vueltoVes: cSettle.changeCents,
        expectedCaja: {
          cashUsd: cUsd?.amountUsd ?? 0,
          cashVes: cVes?.amountCents ?? 0,
        },
        actualAppliedUsd: c.payments.reduce((s, p) => s + p.amountUsd, 0),
      },
    ],
    pendingPagoMovil: {
      folio: a.folio,
      reference: pending.reference,
      confirmed: pending.confirmed,
      amountUsd: pending.amountUsd,
      countsAsReceived: false,
    },
    caja: {
      cashUsd: caja.cashUsd,
      cashVes: caja.cashVes,
      pendingUsd: caja.pendingUsd,
      receivedUsd: caja.receivedUsd,
    },
    duplicatePay: {
      folio: a.folio,
      cashUsdRows: countACash,
      result: "no duplicate",
    },
  };

  assert.equal(caja.pendingUsd, pending.amountUsd);
  assert.equal(caja.cashUsd, aTot.totalUsd + Math.round(cTot.totalUsd / 2));

  const out = path.join(process.cwd(), "prisma", "fase2-evidence.json");
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log("phase2 sales ok", JSON.stringify(evidence, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
