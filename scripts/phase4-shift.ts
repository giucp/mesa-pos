/**
 * Phase 4 shift tests. Dedicated prisma/mesa-phase4.db — never production.
 * Opening both currencies → sale with vuelto → entrada → salida → close with
 * difference → reload / repeat close → next shift does not re-count cobros.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  closeShiftOp,
  findOpenShift,
  openShiftOp,
  recordCashMoveOp,
  rewriteClosedShiftOp,
} from "../src/lib/ops";
import { paymentIsConfirmed, settleNote, settleTender } from "../src/lib/caja";
import { differenceLabel, hasDrawerDifference, summarizeShift } from "../src/lib/shift";
import { authorize, PERMISSION_ERROR } from "../src/lib/permissions";
import type { SessionUser } from "../src/lib/roles";

const envUrl = process.env.DATABASE_URL;
if (envUrl && !envUrl.startsWith("file:")) {
  console.error("phase4-shift refuses non-sqlite URLs (will not touch production).");
  process.exit(1);
}

const dbFile = path.join(process.cwd(), "prisma", "mesa-phase4.db");
const sqliteUrl = `file:${dbFile}`;
const demoDb = path.join(process.cwd(), "prisma", "mesa-demo.db");

if (fs.existsSync(demoDb)) {
  const before = fs.statSync(demoDb);
  process.on("exit", () => {
    const after = fs.statSync(demoDb);
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      console.error("ERROR: prisma/mesa-demo.db was modified.");
      process.exitCode = 1;
    }
  });
}

if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
execSync("npx prisma db push --schema prisma/schema.sqlite.prisma --accept-data-loss", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: sqliteUrl },
});

const prisma = new PrismaClient({ datasources: { db: { url: sqliteUrl } } });

function asSession(user: { id: string; email: string; name: string; role: string }): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
  };
}

async function main() {
  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Café Ávila · TEST FASE 4",
      rif: "J-50392847-1",
      ivaRate: 16,
      bcvRate: 148.52,
      bcvUpdatedAt: new Date(),
      bcvSource: "seed",
    },
  });
  const cajaRow = await prisma.user.create({
    data: { email: "cajero@mesa.ve", name: "Carlos Méndez", role: "CAJERO", passwordHash: "unused" },
  });
  const salonRow = await prisma.user.create({
    data: { email: "mesero@mesa.ve", name: "María Castillo", role: "MESERO", passwordHash: "unused" },
  });
  const adminRow = await prisma.user.create({
    data: { email: "admin@mesa.ve", name: "Ana Rivas", role: "ADMIN", passwordHash: "unused" },
  });
  const caja = asSession(cajaRow);
  const salon = asSession(salonRow);
  const admin = asSession(adminRow);
  const station = await prisma.station.create({ data: { name: "Plancha", slug: "plancha", sortOrder: 1 } });
  const category = await prisma.category.create({ data: { name: "Arepas", sortOrder: 1 } });
  const item = await prisma.item.create({
    data: {
      name: "Arepa Reina Pepiada",
      priceUsd: 650,
      categoryId: category.id,
      stationId: station.id,
      taxCode: "IVA16",
      ivaRate: 16,
      available: true,
      channels: "LOCAL,TAKEAWAY",
    },
  });

  assert.equal(authorize(salon, "checkout").error, PERMISSION_ERROR);
  const salonOpen = await openShiftOp(prisma, salon, { openingUsd: 5000, openingVes: 200000 });
  assert.equal(salonOpen.ok, false);

  const [opened, raced] = await Promise.all([
    openShiftOp(prisma, caja, { openingUsd: 5000, openingVes: 200000 }),
    openShiftOp(prisma, caja, { openingUsd: 5000, openingVes: 200000 }),
  ]);
  const openedOk = [opened, raced].filter((r) => r.ok);
  assert.equal(openedOk.length, 1, "reject two simultaneous openings for the same caja");
  const firstId = openedOk[0] && openedOk[0].ok ? openedOk[0].shiftId : "";
  const again = await openShiftOp(prisma, caja, { openingUsd: 100, openingVes: 100 });
  assert.equal(again.ok, false, "no two open shifts");

  const salonMove = await recordCashMoveOp(prisma, salon, {
    type: "IN",
    currency: "USD",
    amountCents: 100,
    concept: "no",
    reason: "mesero no puede",
  });
  assert.equal(salonMove.ok, false);

  const check = await prisma.check.create({
    data: {
      folio: "P4-SHIFT-SALE",
      channel: "TAKEAWAY",
      status: "OPEN",
      waiterId: caja.id,
      guestCount: 1,
      bcvRateUsed: restaurant.bcvRate,
      bcvSource: "seed",
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
      stationId: station.id,
      taxCode: item.taxCode,
      ivaRate: item.ivaRate,
    },
  });
  const settle = settleTender({
    tenderedCents: 2000,
    currency: "USD",
    remainingUsd: 754,
    rate: restaurant.bcvRate,
  });
  assert.equal(settle.appliedCents, 754);
  assert.equal(settle.changeCents, 1246);
  const pay = await prisma.payment.create({
    data: {
      checkId: check.id,
      methodKey: "CASH_USD",
      methodLabel: "Efectivo USD",
      currency: "USD",
      amountCents: settle.appliedCents,
      amountUsd: settle.appliedUsd,
      amountVes: settle.appliedVes,
      confirmed: paymentIsConfirmed({ methodKey: "CASH_USD", verified: true }),
      shiftId: firstId,
      note: settleNote({ tenderedCents: settle.tenderedCents, changeCents: settle.changeCents }),
    },
  });
  await prisma.check.update({
    where: { id: check.id },
    data: { status: "PAID", closedAt: new Date() },
  });

  const entrada = await recordCashMoveOp(prisma, caja, {
    type: "IN",
    currency: "USD",
    amountCents: 1000,
    concept: "Fondo extra",
    reason: "Refuerzo de gaveta",
  });
  assert.equal(entrada.ok, true);
  const salida = await recordCashMoveOp(prisma, caja, {
    type: "OUT",
    currency: "VES",
    amountCents: 50000,
    concept: "Cambio a banco",
    reason: "Retiro de efectivo Bs",
  });
  assert.equal(salida.ok, true);

  const liveShift = await findOpenShift(prisma);
  assert.ok(liveShift);
  const pays = await prisma.payment.findMany({ where: { shiftId: liveShift.id } });
  const live = summarizeShift({
    openingUsd: liveShift.openingUsd,
    openingVes: liveShift.openingVes,
    payments: pays,
    movements: liveShift.movements,
  });
  const expectedUsd = liveShift.openingUsd + 2000 - 1246 + 1000;
  const expectedVes = liveShift.openingVes - 50000;
  assert.equal(live.expected.usd, expectedUsd);
  assert.equal(live.expected.ves, expectedVes);
  assert.equal(live.cashApplied.usd, 754);
  const salesUsd = pays.reduce((s, p) => s + p.amountUsd, 0);
  assert.equal(salesUsd, 754, "entradas/salidas must not increase sales");

  const blocked = await closeShiftOp(prisma, caja, {
    countedUsd: expectedUsd - 100,
    countedVes: expectedVes,
  });
  assert.equal(blocked.ok, false, "difference requires motivo");

  const closed = await closeShiftOp(prisma, caja, {
    countedUsd: expectedUsd - 100,
    countedVes: expectedVes,
    reason: "Faltante de un dólar en el arqueo",
  });
  assert.equal(closed.ok, true);
  assert.ok(closed.ok && hasDrawerDifference(closed.summary.difference));
  assert.equal(closed.ok && closed.summary.difference.usd, -100);
  assert.equal(closed.ok && differenceLabel(closed.summary.difference).includes("Faltante"), true);
  assert.match(closed.ok ? closed.summary.kindLabel : "", /máquina fiscal/i);

  const snapshot = closed.ok ? closed.summary : null;
  assert.ok(snapshot);
  const moveCount = await prisma.cashMovement.count({ where: { shiftId: firstId } });

  const reloaded = await prisma.cashShift.findUnique({ where: { id: firstId } });
  assert.ok(reloaded?.summaryJson);
  assert.equal(reloaded.status, "CLOSED");
  assert.deepEqual(JSON.parse(reloaded.summaryJson), snapshot);
  assert.equal(await prisma.cashMovement.count({ where: { shiftId: firstId } }), moveCount);

  const repeat = await closeShiftOp(prisma, caja, {
    countedUsd: expectedUsd,
    countedVes: expectedVes,
    reason: "intento de recierre",
  });
  assert.equal(repeat.ok, false);
  const afterRepeat = await prisma.cashShift.findUnique({ where: { id: firstId } });
  assert.equal(afterRepeat?.summaryJson, reloaded.summaryJson);
  assert.equal(await prisma.cashMovement.count({ where: { shiftId: firstId } }), moveCount);

  const correction = await recordCashMoveOp(prisma, admin, {
    type: "CORRECTION",
    shiftId: firstId,
    currency: "USD",
    amountCents: 100,
    concept: "Ajuste posterior",
    reason: "Corrección sin reescribir el cierre",
  });
  assert.equal(correction.ok, true);
  const afterCorr = await prisma.cashShift.findUnique({
    where: { id: firstId },
    include: { movements: true },
  });
  assert.equal(afterCorr?.summaryJson, reloaded.summaryJson, "close summary stays immutable");
  assert.ok(afterCorr && afterCorr.movements.length === moveCount + 1);

  const next = await openShiftOp(prisma, caja, { openingUsd: 3000, openingVes: 100000 });
  assert.equal(next.ok, true);
  const nextShift = await findOpenShift(prisma);
  assert.ok(nextShift);
  const nextPays = await prisma.payment.findMany({ where: { shiftId: nextShift.id } });
  assert.equal(nextPays.length, 0, "next shift does not inherit prior cobros");
  const nextLive = summarizeShift({
    openingUsd: nextShift.openingUsd,
    openingVes: nextShift.openingVes,
    payments: nextPays,
    movements: nextShift.movements,
  });
  assert.equal(nextLive.cashHanded.usd, 0);
  assert.equal(nextLive.expected.usd, 3000);
  assert.equal((await prisma.payment.findUnique({ where: { id: pay.id } }))?.shiftId, firstId);

  const rewrite = await rewriteClosedShiftOp(prisma, caja, {
    shiftId: firstId,
    countedUsd: 1,
    countedVes: 1,
    summaryJson: JSON.stringify({ tampered: true }),
  });
  assert.equal(rewrite.ok, false, "direct rewrite of confirmed close is rejected");
  const afterRewrite = await prisma.cashShift.findUnique({ where: { id: firstId } });
  assert.equal(afterRewrite?.summaryJson, reloaded.summaryJson, "closed summary unchanged on reject");
  assert.equal(afterRewrite?.countedUsd, reloaded.countedUsd);
  assert.equal(afterRewrite?.countedVes, reloaded.countedVes);
  assert.equal(await prisma.cashMovement.count({ where: { shiftId: firstId } }), moveCount + 1);

  const pendingCheck = await prisma.check.create({
    data: {
      folio: "P4-XFER-PEND",
      channel: "TAKEAWAY",
      status: "OPEN",
      waiterId: caja.id,
      guestCount: 1,
      bcvRateUsed: restaurant.bcvRate,
      bcvSource: "seed",
    },
  });
  const pendingPay = await prisma.payment.create({
    data: {
      checkId: pendingCheck.id,
      methodKey: "PAGO_MOVIL",
      methodLabel: "Pago Móvil",
      currency: "VES",
      amountCents: 10000,
      amountUsd: 67,
      amountVes: 10000,
      confirmed: false,
      shiftId: nextShift.id,
      reference: "P4-PEND-XFER",
      note: settleNote({ tenderedCents: 10000, changeCents: 0 }),
    },
  });
  const xferNoMotivo = await closeShiftOp(prisma, caja, {
    countedUsd: 3000,
    countedVes: 100000,
    transferToNext: true,
  });
  assert.equal(xferNoMotivo.ok, false, "transfer requires motivo");
  const stillAssigned = await prisma.payment.findUnique({ where: { id: pendingPay.id } });
  assert.equal(stillAssigned?.shiftId, nextShift.id, "reject does not clear pending");
  assert.equal((await prisma.cashShift.findUnique({ where: { id: nextShift.id } }))?.status, "OPEN");

  const xfer = await closeShiftOp(prisma, caja, {
    countedUsd: 3000,
    countedVes: 100000,
    transferToNext: true,
    reason: "Traspaso de pendiente al siguiente turno",
  });
  assert.equal(xfer.ok, true);
  const kept = await prisma.payment.findUnique({ where: { id: pendingPay.id } });
  assert.ok(kept, "transfer must not lose pendings");
  assert.equal(kept?.confirmed, false);
  assert.equal(kept?.shiftId, null);
  assert.equal(kept?.amountCents, 10000);

  const third = await openShiftOp(prisma, caja, { openingUsd: 1000, openingVes: 50000 });
  assert.equal(third.ok, true);
  const thirdShift = await findOpenShift(prisma);
  assert.ok(thirdShift);
  const thirdPays = await prisma.payment.findMany({ where: { shiftId: thirdShift.id } });
  assert.equal(thirdPays.length, 0, "next shift does not re-count prior cobros");
  const stillKept = await prisma.payment.findUnique({ where: { id: pendingPay.id } });
  assert.equal(stillKept?.id, pendingPay.id);

  const audits = await prisma.auditLog.findMany({
    where: { action: { in: ["SHIFT_OPEN", "SHIFT_IN", "SHIFT_OUT", "SHIFT_CLOSE", "SHIFT_CORRECTION"] } },
  });
  assert.ok(audits.some((a) => a.action === "SHIFT_OPEN"));
  assert.ok(audits.some((a) => a.action === "SHIFT_IN"));
  assert.ok(audits.some((a) => a.action === "SHIFT_OUT"));
  assert.ok(audits.some((a) => a.action === "SHIFT_CLOSE"));
  assert.ok(audits.some((a) => a.action === "SHIFT_CORRECTION"));

  console.log("phase4-shift: OK", {
    expectedUsd,
    expectedVes,
    countedUsd: expectedUsd - 100,
    countedVes: expectedVes,
    differenceUsd: -100,
    salesUsd,
    nextShiftCashCobros: 0,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
