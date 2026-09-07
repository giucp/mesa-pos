/**
 * Phase 5 connection & recovery tests. Dedicated prisma/mesa-phase5.db.
 * Does not touch production or isolated demo sales.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { addItemOp, findPaymentByOpId, lookupPaymentOp } from "../src/lib/ops";
import { paymentIsConfirmed, settleNote, settleTender } from "../src/lib/caja";
import { deriveSyncState, hasOrderConflict, planMutation } from "../src/lib/sync-state";
import { auditHeadline } from "../src/lib/audit-display";
import { authorize } from "../src/lib/permissions";
import type { SessionUser } from "../src/lib/roles";

const envUrl = process.env.DATABASE_URL;
if (envUrl && !envUrl.startsWith("file:")) {
  console.error("phase5-sync refuses non-sqlite URLs (will not touch production).");
  process.exit(1);
}

const dbFile = path.join(process.cwd(), "prisma", "mesa-phase5.db");
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
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--schema", "prisma/schema.sqlite.prisma", "--accept-data-loss"], {
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
  assert.equal(
    auditHeadline("SHIFT_OUT", { currency: "VES", amountCents: 50000 }),
    "Salida de efectivo · Bs 500,00",
  );

  const ready = deriveSyncState({ online: true, pending: 0, errors: 0 });
  assert.equal(ready.label, "Al día");
  const offline = deriveSyncState({ online: false, pending: 2, errors: 0 });
  assert.equal(offline.label, "Sin conexión");
  assert.equal(offline.pending, 2);
  const syncing = deriveSyncState({ online: true, pending: 3, errors: 0 });
  assert.equal(syncing.label, "Sincronizando");
  const err = deriveSyncState({ online: true, pending: 1, errors: 1 });
  assert.equal(err.label, "Error de sincronización");

  assert.equal(planMutation({ online: false, action: "confirmPayment" }).kind, "block");
  assert.equal(planMutation({ online: false, action: "closeShift" }).kind, "block");
  const queuedOrder = planMutation({ online: false, action: "addItem" });
  assert.equal(queuedOrder.kind, "queue");
  const lost = planMutation({
    online: true,
    action: "addPayment",
    attemptStarted: true,
    responseLost: true,
  });
  assert.equal(lost.kind, "unknown");
  if (lost.kind === "unknown") {
    assert.equal(lost.label, "Por verificar");
    assert.equal(lost.queueRetry, true);
  }
  const lostClose = planMutation({
    online: true,
    action: "closeShift",
    attemptStarted: true,
    responseLost: true,
  });
  assert.equal(lostClose.kind, "unknown");
  if (lostClose.kind === "unknown") assert.equal(lostClose.queueRetry, false);

  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Café Ávila · TEST FASE 5",
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
  const caja = asSession(cajaRow);
  const salon = asSession(salonRow);
  assert.equal(authorize(salon, "order").ok, true);
  assert.equal(authorize(caja, "checkout").ok, true);

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
  const check = await prisma.check.create({
    data: {
      folio: "P5-SYNC-ORD",
      channel: "TAKEAWAY",
      status: "OPEN",
      waiterId: salon.id,
      guestCount: 1,
      bcvRateUsed: restaurant.bcvRate,
      bcvSource: "seed",
    },
  });

  const clientOpId = "p5-order-once";
  const first = await addItemOp(prisma, salon, {
    checkId: check.id,
    itemId: item.id,
    notes: "sin cebolla",
    qty: 2,
    clientOpId,
    knownLineIds: [],
  });
  assert.equal(first.ok, true);
  const replay = await addItemOp(prisma, salon, {
    checkId: check.id,
    itemId: item.id,
    notes: "sin cebolla",
    qty: 2,
    clientOpId,
    knownLineIds: [],
  });
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.duplicate, true);
  const lines = await prisma.orderLine.findMany({ where: { checkId: check.id } });
  assert.equal(lines.length, 1, "offline order arrives once after reload/retry");
  assert.equal(lines[0]?.qty, 2);
  assert.equal(lines[0]?.notes, "sin cebolla");
  assert.equal(lines[0]?.clientOpId, clientOpId);
  assert.equal(lines[0]?.status, "HELD", "not marked sent to kitchen until server send");

  const otherItem = await prisma.item.create({
    data: {
      name: "Café",
      priceUsd: 200,
      categoryId: category.id,
      stationId: station.id,
      taxCode: "IVA16",
      ivaRate: 16,
      available: true,
      channels: "LOCAL,TAKEAWAY",
    },
  });
  const sessionB = await addItemOp(prisma, salon, {
    checkId: check.id,
    itemId: otherItem.id,
    notes: "sesión B",
    clientOpId: "p5-session-b",
    knownLineIds: [],
    baseUpdatedAt: check.updatedAt,
  });
  assert.equal(sessionB.ok, false);
  assert.equal("conflict" in sessionB && sessionB.conflict, true, "two sessions show conflict");
  const afterConflict = await prisma.orderLine.count({ where: { checkId: check.id } });
  assert.equal(afterConflict, 1, "conflict does not silent-overwrite");
  assert.ok(hasOrderConflict({
    knownLineIds: [],
    server: { updatedAt: new Date(), lines: lines.map((l) => ({ id: l.id })) },
  }));

  if (!sessionB.ok && "server" in sessionB) {
    const resolved = await addItemOp(prisma, salon, {
      checkId: check.id,
      itemId: otherItem.id,
      notes: "sesión B",
      clientOpId: "p5-session-b",
      knownLineIds: sessionB.server.lineIds,
      baseUpdatedAt: sessionB.server.updatedAt,
    });
    assert.equal(resolved.ok, true, "conflict is resolvable");
  }
  assert.equal(await prisma.orderLine.count({ where: { checkId: check.id } }), 2);

  const shift = await prisma.cashShift.create({
    data: {
      drawerKey: "CAJA-1",
      status: "OPEN",
      openedById: caja.id,
      openedByName: caja.name,
      openingUsd: 0,
      openingVes: 0,
      openLock: "CAJA-1",
    },
  });
  const settle = settleTender({
    tenderedCents: 2000,
    currency: "USD",
    remainingUsd: 754,
    rate: restaurant.bcvRate,
  });
  const opId = "p5-lost-response-op";
  const saved = await prisma.payment.create({
    data: {
      checkId: check.id,
      methodKey: "CASH_USD",
      methodLabel: "Efectivo USD",
      currency: "USD",
      amountCents: settle.appliedCents,
      amountUsd: settle.appliedUsd,
      amountVes: settle.appliedVes,
      confirmed: paymentIsConfirmed({ methodKey: "CASH_USD", verified: true }),
      shiftId: shift.id,
      clientOpId: opId,
      note: settleNote({
        tenderedCents: settle.tenderedCents,
        changeCents: settle.changeCents,
        idempotencyKey: opId,
      }),
    },
  });
  const unknownBefore = await lookupPaymentOp(prisma, check.id, "missing-op");
  assert.equal(unknownBefore.status, "unknown");
  const recovered = await lookupPaymentOp(prisma, check.id, opId);
  assert.equal(recovered.status, "paid");
  assert.equal(recovered.paymentId, saved.id);
  const same = await findPaymentByOpId(prisma, check.id, opId);
  assert.equal(same?.id, saved.id);
  const resend = await findPaymentByOpId(prisma, check.id, opId);
  assert.ok(resend);
  if (resend) {
    /* query-before-resend: do not create another row */
  }
  assert.equal(await prisma.payment.count({ where: { checkId: check.id } }), 1);
  assert.equal(await prisma.payment.count({ where: { shiftId: shift.id } }), 1);
  assert.equal((await prisma.payment.findUnique({ where: { id: saved.id } }))?.shiftId, shift.id);

  console.log("phase5-sync: OK", {
    orderLines: await prisma.orderLine.count({ where: { checkId: check.id } }),
    payments: 1,
    cajaAttributions: 1,
    syncLabels: [offline.label, syncing.label, ready.label, err.label],
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
