/**
 * Phase 6 on the persistent isolated Postgres (mesa_isolated / isolated_fase6).
 * Refuses olive. Does not wipe Café Ávila demo seed. Leaves one Cachapa movement.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { FASE6_STOCK } from "../src/lib/isolated-demo";
import { assertIsolatedPersistentUrl } from "../src/lib/isolated-db-guard";
import { addItemOp } from "../src/lib/ops";
import { recordManualStockOp } from "../src/lib/stock";
import type { SessionUser } from "../src/lib/roles";
import { applyPrismaEnv, isPostgresUrl } from "../src/lib/db-url";
import { requireIsolatedDemo } from "./isolated-target";

const RACE_ITEM = "P6 carrera última unidad";

requireIsolatedDemo("phase6-persistent");
const resolved = applyPrismaEnv();
if (!resolved.url || !isPostgresUrl(resolved.url)) {
  console.error("phase6-persistent exige Postgres persistente (mesa_isolated + isolated_fase6).");
  process.exit(1);
}
assertIsolatedPersistentUrl(resolved.url);

function asSession(user: { id: string; email: string; name: string; role: string }): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
  };
}

function client() {
  return new PrismaClient({ datasources: { db: { url: resolved.url! } }, log: ["error"] });
}

async function openCheck(db: PrismaClient, waiterId: string, rate: number, folio: string) {
  return db.check.create({
    data: {
      folio,
      channel: "TAKEAWAY",
      status: "OPEN",
      waiterId,
      guestCount: 1,
      bcvRateUsed: rate,
      bcvSource: "seed",
    },
  });
}

async function main() {
  const setup = client();
  const [adminRow, salonRow, restaurant, station, category] = await Promise.all([
    setup.user.findFirst({ where: { role: "ADMIN" } }),
    setup.user.findFirst({ where: { role: "MESERO" } }),
    setup.restaurant.findFirst(),
    setup.station.findFirst(),
    setup.category.findFirst(),
  ]);
  assert.ok(adminRow && salonRow && restaurant && station && category, "Falta semilla aislada.");
  const admin = asSession(adminRow);
  const salon = asSession(salonRow);
  const rate = restaurant.bcvRate || 148.52;

  const stale = await setup.check.findMany({
    where: { folio: { startsWith: "P6P-" } },
    select: { id: true },
  });
  if (stale.length) {
    await setup.stockMovement.deleteMany({
      where: { checkId: { in: stale.map((c) => c.id) } },
    });
    await setup.check.deleteMany({ where: { id: { in: stale.map((c) => c.id) } } });
  }
  await setup.stockMovement.deleteMany({
    where: { clientOpId: { startsWith: "reserve:p6p-" } },
  });

  let raceItem = await setup.item.findFirst({ where: { name: RACE_ITEM } });
  if (!raceItem) {
    raceItem = await setup.item.create({
      data: {
        name: RACE_ITEM,
        priceUsd: 100,
        categoryId: category.id,
        stationId: station.id,
        available: true,
        stockControlled: true,
        stockQty: 1,
        stockUnit: "un",
        stockMinAlert: 0,
        sortOrder: 99,
      },
    });
  } else {
    raceItem = await setup.item.update({
      where: { id: raceItem.id },
      data: {
        available: true,
        stockControlled: true,
        stockQty: 1,
        stockUnit: "un",
        stockMinAlert: 0,
      },
    });
  }

  await setup.$disconnect();

  const sessionA = client();
  const sessionB = client();
  const [checkA, checkB] = await Promise.all([
    openCheck(sessionA, salon.id, rate, "P6P-RACE-A"),
    openCheck(sessionB, salon.id, rate, "P6P-RACE-B"),
  ]);
  const [first, second] = await Promise.all([
    addItemOp(sessionA, salon, {
      checkId: checkA.id,
      itemId: raceItem.id,
      qty: 1,
      clientOpId: `p6p-race-a-${checkA.id}`,
    }),
    addItemOp(sessionB, salon, {
      checkId: checkB.id,
      itemId: raceItem.id,
      qty: 1,
      clientOpId: `p6p-race-b-${checkB.id}`,
    }),
  ]);
  const wins = [first, second].filter((r) => r.ok).length;
  const losses = [first, second].filter((r) => !r.ok).length;
  assert.equal(wins, 1, "solo una sesión se lleva la última unidad");
  assert.equal(losses, 1, "la otra sesión se rechaza — no hay oversell");
  const afterRace = await sessionA.item.findUnique({ where: { id: raceItem.id } });
  assert.equal(afterRace?.stockQty, 0);
  await sessionA.$disconnect();
  await sessionB.$disconnect();

  const beforeReload = client();
  await beforeReload.item.update({ where: { id: raceItem.id }, data: { stockQty: 2 } });
  const retryCheck = await openCheck(beforeReload, salon.id, rate, "P6P-RETRY");
  const retryOp = `p6p-retry-reload-${retryCheck.id}`;
  const once = await addItemOp(beforeReload, salon, {
    checkId: retryCheck.id,
    itemId: raceItem.id,
    qty: 1,
    clientOpId: retryOp,
  });
  assert.equal(once.ok, true);
  await beforeReload.$disconnect();

  const afterReload = client();
  const again = await addItemOp(afterReload, salon, {
    checkId: retryCheck.id,
    itemId: raceItem.id,
    qty: 1,
    clientOpId: retryOp,
  });
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.duplicate, true);
  const afterRetry = await afterReload.item.findUnique({ where: { id: raceItem.id } });
  assert.equal(afterRetry?.stockQty, 1, "el reintento tras recarga no descuenta dos veces");
  const retryLines = await afterReload.orderLine.findMany({ where: { checkId: retryCheck.id } });
  assert.equal(retryLines.length, 1);
  await afterReload.item.update({ where: { id: raceItem.id }, data: { available: false, stockQty: 0 } });

  const cachapa = await afterReload.item.findFirst({ where: { name: FASE6_STOCK.itemName } });
  assert.ok(cachapa?.stockControlled, `Falta ${FASE6_STOCK.itemName} con control`);
  const persist = await recordManualStockOp(afterReload, admin, {
    itemId: cachapa.id,
    type: "ENTRADA",
    qty: FASE6_STOCK.persistQty,
    motivo: FASE6_STOCK.persistMotivo,
    clientOpId: FASE6_STOCK.persistOpId,
  });
  assert.equal(persist.ok, true);
  const persistAgain = await recordManualStockOp(afterReload, admin, {
    itemId: cachapa.id,
    type: "ENTRADA",
    qty: FASE6_STOCK.persistQty,
    motivo: FASE6_STOCK.persistMotivo,
    clientOpId: FASE6_STOCK.persistOpId,
  });
  assert.equal(persistAgain.ok, true);
  if (persistAgain.ok) assert.equal(persistAgain.duplicate, true);

  const freshCachapa = await afterReload.item.findUnique({ where: { id: cachapa.id } });
  const movement = await afterReload.stockMovement.findUnique({
    where: { clientOpId: FASE6_STOCK.persistOpId },
  });
  assert.ok(movement, "debe quedar un movimiento persistente para Giucp");
  assert.equal(movement.motivo, FASE6_STOCK.persistMotivo);
  assert.equal(movement.qty, FASE6_STOCK.persistQty);
  const sameMotivo = await afterReload.stockMovement.count({
    where: { itemId: cachapa.id, clientOpId: FASE6_STOCK.persistOpId },
  });
  assert.equal(sameMotivo, 1, "un solo movimiento con el clientOpId persistente");

  const note = {
    item: FASE6_STOCK.itemName,
    stockQty: freshCachapa?.stockQty,
    unit: freshCachapa?.stockUnit,
    persistMotivo: FASE6_STOCK.persistMotivo,
    persistOpId: FASE6_STOCK.persistOpId,
    persistQty: FASE6_STOCK.persistQty,
    lastUnitWins: 1,
    retryAfterReloadNoDouble: true,
    howToVerify:
      "PIN 1111 → /inventario → Cachapa con Queso → Historial: «Entrada persistente Giucp — verifica recarga». Recarga la página: el movimiento y las existencias siguen.",
  };
  fs.writeFileSync(path.join(process.cwd(), "prisma", "fase6-evidence.json"), JSON.stringify(note, null, 2));
  console.log("phase6-persistent ok");
  console.log(JSON.stringify(note));
  await afterReload.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
