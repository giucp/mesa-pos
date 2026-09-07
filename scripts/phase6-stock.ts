/**
 * Phase 6 finished-goods inventory tests. Dedicated prisma/mesa-phase6.db.
 * Does not touch production or isolated demo sales.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { addItemOp, changeQtyOp, sendToKitchenOp, voidCheckOp } from "../src/lib/ops";
import { planMutation } from "../src/lib/sync-state";
import { recordManualStockOp, stockBadge, stockOfflineBlock } from "../src/lib/stock";
import { auditHeadline } from "../src/lib/audit-display";
import type { SessionUser } from "../src/lib/roles";

const envUrl = process.env.DATABASE_URL;
if (envUrl && !envUrl.startsWith("file:")) {
  console.error("phase6-stock refuses non-sqlite URLs (will not touch production).");
  process.exit(1);
}

const dbFile = path.join(process.cwd(), "prisma", "mesa-phase6.db");
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
  assert.equal(stockBadge({ available: false, stockControlled: true, stockQty: 4 }).kind, "eighty6");
  assert.equal(stockBadge({ available: true, stockControlled: true, stockQty: 0 }).kind, "out");
  assert.equal(stockBadge({ available: true, stockControlled: true, stockQty: 1, stockMinAlert: 2 }).kind, "low");
  assert.equal(stockBadge({ available: true, stockControlled: false, stockQty: 0 }).kind, "open");
  assert.equal(
    planMutation({ online: false, action: "addItem", requiresStockConfirm: true }).kind,
    "block",
  );
  const blocked = planMutation({ online: false, action: "addItem", requiresStockConfirm: true });
  if (blocked.kind === "block") assert.equal(blocked.error, stockOfflineBlock());
  assert.equal(planMutation({ online: false, action: "addItem" }).kind, "queue");
  assert.equal(
    auditHeadline("STOCK_ENTRADA", { itemName: "Cachapa con Queso", qty: 8, unit: "un", from: { stockQty: 0 }, to: { stockQty: 8 } }),
    "Entrada de inventario · Cachapa con Queso · 0 → 8 un",
  );

  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Café Ávila · TEST FASE 6",
      rif: "J-50392847-1",
      ivaRate: 16,
      bcvRate: 148.52,
      bcvUpdatedAt: new Date(),
      bcvSource: "seed",
    },
  });
  const adminRow = await prisma.user.create({
    data: { email: "admin@mesa.ve", name: "Ana Rivas", role: "ADMIN", passwordHash: "unused" },
  });
  const salonRow = await prisma.user.create({
    data: { email: "mesero@mesa.ve", name: "María Castillo", role: "MESERO", passwordHash: "unused" },
  });
  const admin = asSession(adminRow);
  const salon = asSession(salonRow);
  const station = await prisma.station.create({ data: { name: "Plancha", slug: "plancha", sortOrder: 1 } });
  const category = await prisma.category.create({ data: { name: "Desayunos", sortOrder: 1 } });
  const item = await prisma.item.create({
    data: {
      name: "Cachapa con Queso",
      priceUsd: 780,
      categoryId: category.id,
      stationId: station.id,
      stockControlled: true,
      stockQty: 0,
      stockUnit: "un",
      stockMinAlert: 2,
    },
  });
  const free = await prisma.item.create({
    data: {
      name: "Arepa Reina Pepiada",
      priceUsd: 650,
      categoryId: category.id,
      stationId: station.id,
      stockControlled: false,
    },
  });

  const entrada = await recordManualStockOp(prisma, admin, {
    itemId: item.id,
    type: "ENTRADA",
    qty: 8,
    motivo: "Entrada de demostración Fase 6",
  });
  assert.equal(entrada.ok, true);
  if (entrada.ok) assert.equal(entrada.stockQty, 8);

  async function openCheck(folio: string) {
    return prisma.check.create({
      data: {
        folio,
        channel: "TAKEAWAY",
        status: "OPEN",
        waiterId: salon.id,
        guestCount: 1,
        bcvRateUsed: restaurant.bcvRate,
        bcvSource: "seed",
      },
    });
  }

  const sale = await openCheck("P6-SALE");
  const added = await addItemOp(prisma, salon, {
    checkId: sale.id,
    itemId: item.id,
    qty: 1,
    clientOpId: "p6-sale-1",
  });
  assert.equal(added.ok, true);
  let stock = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(stock?.stockQty, 7);

  const beforePrep = await openCheck("P6-VOID-HELD");
  const heldAdd = await addItemOp(prisma, salon, {
    checkId: beforePrep.id,
    itemId: item.id,
    qty: 1,
    clientOpId: "p6-void-held",
  });
  assert.equal(heldAdd.ok, true);
  stock = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(stock?.stockQty, 6);
  const voidHeld = await voidCheckOp(prisma, admin, beforePrep.id, "Anulación antes de preparar");
  assert.equal(voidHeld.ok, true);
  stock = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(stock?.stockQty, 7);

  const afterPrep = await openCheck("P6-VOID-FIRED");
  const firedAdd = await addItemOp(prisma, salon, {
    checkId: afterPrep.id,
    itemId: item.id,
    qty: 1,
    clientOpId: "p6-void-fired",
  });
  assert.equal(firedAdd.ok, true);
  stock = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(stock?.stockQty, 6);
  const sent = await sendToKitchenOp(prisma, salon, afterPrep.id);
  assert.equal(sent.ok, true);
  const voidFired = await voidCheckOp(prisma, admin, afterPrep.id, "Anulación después de preparar");
  assert.equal(voidFired.ok, true);
  stock = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(stock?.stockQty, 6, "void after prep must not return prepared food");

  const merma = await recordManualStockOp(prisma, admin, {
    itemId: item.id,
    type: "MERMA",
    qty: 1,
    motivo: "Merma de demostración Fase 6",
  });
  assert.equal(merma.ok, true);
  stock = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(stock?.stockQty, 5);

  await prisma.item.update({ where: { id: item.id }, data: { stockQty: 1 } });
  const raceA = await openCheck("P6-RACE-A");
  const raceB = await openCheck("P6-RACE-B");
  const [first, second] = await Promise.all([
    addItemOp(prisma, salon, { checkId: raceA.id, itemId: item.id, qty: 1, clientOpId: "p6-race-a" }),
    addItemOp(prisma, salon, { checkId: raceB.id, itemId: item.id, qty: 1, clientOpId: "p6-race-b" }),
  ]);
  const wins = [first, second].filter((r) => r.ok).length;
  const losses = [first, second].filter((r) => !r.ok).length;
  assert.equal(wins, 1, "only one session takes the last unit");
  assert.equal(losses, 1, "the other session is rejected");
  stock = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(stock?.stockQty, 0);

  const retryCheck = await openCheck("P6-RETRY");
  await prisma.item.update({ where: { id: item.id }, data: { stockQty: 2 } });
  const once = await addItemOp(prisma, salon, {
    checkId: retryCheck.id,
    itemId: item.id,
    qty: 1,
    clientOpId: "p6-retry-same",
  });
  const again = await addItemOp(prisma, salon, {
    checkId: retryCheck.id,
    itemId: item.id,
    qty: 1,
    clientOpId: "p6-retry-same",
  });
  assert.equal(once.ok, true);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.duplicate, true);
  stock = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(stock?.stockQty, 1, "retry must not double deduct");
  const lines = await prisma.orderLine.findMany({ where: { checkId: retryCheck.id } });
  assert.equal(lines.length, 1);

  const freeCheck = await openCheck("P6-FREE");
  const freeAdd = await addItemOp(prisma, salon, {
    checkId: freeCheck.id,
    itemId: free.id,
    qty: 2,
    clientOpId: "p6-free",
  });
  assert.equal(freeAdd.ok, true);
  const freeItem = await prisma.item.findUnique({ where: { id: free.id } });
  assert.equal(freeItem?.stockQty, 0);
  assert.equal(freeItem?.stockControlled, false);

  const qtyCheck = await openCheck("P6-QTY");
  await prisma.item.update({ where: { id: item.id }, data: { stockQty: 3 } });
  const qtyAdd = await addItemOp(prisma, salon, {
    checkId: qtyCheck.id,
    itemId: item.id,
    qty: 1,
    clientOpId: "p6-qty",
  });
  assert.equal(qtyAdd.ok, true);
  if (qtyAdd.ok) {
    const up = await changeQtyOp(prisma, salon, qtyAdd.lineId, 1);
    assert.equal(up.ok, true);
    stock = await prisma.item.findUnique({ where: { id: item.id } });
    assert.equal(stock?.stockQty, 1);
    const down = await changeQtyOp(prisma, salon, qtyAdd.lineId, -1);
    assert.equal(down.ok, true);
    stock = await prisma.item.findUnique({ where: { id: item.id } });
    assert.equal(stock?.stockQty, 2);
  }

  console.log("phase6-stock ok");
  console.log(
    JSON.stringify({
      entrada: 8,
      afterSale: 7,
      voidBeforePrep: 7,
      voidAfterPrep: 6,
      afterMerma: 5,
      lastUnitWins: 1,
      retryNoDouble: true,
      uncontrolledUnchanged: true,
    }),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
