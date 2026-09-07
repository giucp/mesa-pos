/**
 * Isolated Fase 4 demo shift. Refuses production. Does not confirm P2-A pending.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FASE2_FOLIOS, FASE2_PENDING_REF, FASE4_SHIFT } from "../src/lib/isolated-demo";
import { closeShiftOp, findOpenShift, openShiftOp, recordCashMoveOp } from "../src/lib/ops";
import { paymentIsConfirmed, settleNote, settleTender } from "../src/lib/caja";
import { summarizeShift } from "../src/lib/shift";
import type { SessionUser } from "../src/lib/roles";

import { isolatedPrisma } from "./isolated-target";

const prisma = isolatedPrisma("phase4-isolated");

function asSession(user: { id: string; email: string; name: string; role: string }): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
  };
}

async function main() {
  const [cajaRow, restaurant, item] = await Promise.all([
    prisma.user.findFirst({ where: { role: "CAJERO" } }),
    prisma.restaurant.findFirst(),
    prisma.item.findFirst({ where: { name: "Arepa Reina Pepiada", available: true } }),
  ]);
  assert.ok(cajaRow && restaurant && item);
  const caja = asSession(cajaRow);
  const rate = restaurant.bcvRate || 148.52;

  const stale = await prisma.check.findUnique({ where: { folio: FASE4_SHIFT.folio } });
  if (stale) await prisma.check.delete({ where: { id: stale.id } });
  await prisma.cashShift.deleteMany({ where: { drawerKey: "CAJA-1" } });

  const opened = await openShiftOp(prisma, caja, { openingUsd: 5000, openingVes: 200000 });
  assert.equal(opened.ok, true);
  const shiftId = opened.ok ? opened.shiftId : "";

  const check = await prisma.check.create({
    data: {
      folio: FASE4_SHIFT.folio,
      channel: "TAKEAWAY",
      status: "OPEN",
      waiterId: caja.id,
      guestCount: 1,
      bcvRateUsed: rate,
      bcvSource: "seed",
      notes: "Venta de prueba Fase 4 — no es folio P2",
    },
  });
  await prisma.orderLine.create({
    data: {
      checkId: check.id,
      itemId: item.id,
      name: item.name,
      qty: 1,
      priceUsd: item.priceUsd,
      modifiers: "[]",
      status: "HELD",
      stationId: item.stationId,
      taxCode: item.taxCode,
      ivaRate: item.ivaRate,
    },
  });
  const settle = settleTender({ tenderedCents: 2000, currency: "USD", remainingUsd: 754, rate });
  await prisma.payment.create({
    data: {
      checkId: check.id,
      methodKey: "CASH_USD",
      methodLabel: "Efectivo USD",
      currency: "USD",
      amountCents: settle.appliedCents,
      amountUsd: settle.appliedUsd,
      amountVes: settle.appliedVes,
      confirmed: paymentIsConfirmed({ methodKey: "CASH_USD", verified: true }),
      shiftId,
      note: settleNote({ tenderedCents: settle.tenderedCents, changeCents: settle.changeCents }),
    },
  });
  await prisma.check.update({
    where: { id: check.id },
    data: { status: "PAID", closedAt: new Date() },
  });

  assert.equal(
    (await recordCashMoveOp(prisma, caja, {
      type: "IN",
      currency: "USD",
      amountCents: 1000,
      concept: FASE4_SHIFT.inConcept,
      reason: "Entrada aislada Fase 4",
    })).ok,
    true,
  );
  assert.equal(
    (await recordCashMoveOp(prisma, caja, {
      type: "OUT",
      currency: "VES",
      amountCents: 50000,
      concept: FASE4_SHIFT.outConcept,
      reason: "Salida aislada Fase 4",
    })).ok,
    true,
  );

  const liveShift = await findOpenShift(prisma);
  assert.ok(liveShift);
  const pays = await prisma.payment.findMany({ where: { shiftId: liveShift.id } });
  const live = summarizeShift({
    openingUsd: liveShift.openingUsd,
    openingVes: liveShift.openingVes,
    payments: pays,
    movements: liveShift.movements,
  });
  const countedUsd = live.expected.usd - 100;
  const closed = await closeShiftOp(prisma, caja, {
    countedUsd,
    countedVes: live.expected.ves,
    reason: FASE4_SHIFT.closeReason,
    transferToNext: true,
  });
  assert.equal(closed.ok, true);

  const pendingA = await prisma.payment.findFirst({
    where: { reference: FASE2_PENDING_REF },
  });
  assert.ok(pendingA);
  assert.equal(pendingA.confirmed, false, "P2-A pending stays unconfirmed");
  const p2 = await prisma.check.findMany({ where: { folio: { in: Object.values(FASE2_FOLIOS) } } });
  assert.equal(p2.length, 3);

  const next = await openShiftOp(prisma, caja, { openingUsd: 3000, openingVes: 100000 });
  assert.equal(next.ok, true);
  const nextShift = await findOpenShift(prisma);
  assert.ok(nextShift);
  const nextPays = await prisma.payment.findMany({ where: { shiftId: nextShift.id } });
  assert.equal(nextPays.length, 0);

  const evidence = {
    isolated: true,
    productionTouched: false,
    folio: FASE4_SHIFT.folio,
    expected: closed.ok ? closed.summary.expected : null,
    counted: closed.ok ? closed.summary.counted : null,
    difference: closed.ok ? closed.summary.difference : null,
    differenceLabel: closed.ok ? closed.summary.differenceLabel : null,
    salesRevenueUsd: closed.ok ? closed.summary.salesRevenueUsd : null,
    nextShiftPriorCobros: nextPays.length,
    p2aStillPending: pendingA.confirmed === false,
  };
  fs.writeFileSync(path.join(process.cwd(), "prisma", "fase4-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("phase4-isolated: OK", JSON.stringify(evidence, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
