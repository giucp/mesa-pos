/**
 * Phase 3 role + audit tests. Never points at production Postgres.
 * Uses prisma/mesa-phase3.db only — does not touch mesa-demo.db or P2-* folios.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  addItemOp,
  applyCourtesyOp,
  applyDiscountOp,
  bumpTicketOp,
  confirmPaymentOp,
  recallTicketOp,
  reopenCheckOp,
  updateItemPriceOp,
  updateItemTaxOp,
  voidCheckOp,
} from "../src/lib/ops";
import { authorize, MOTIVO_ERROR, PERMISSION_ERROR } from "../src/lib/permissions";
import type { SessionUser } from "../src/lib/roles";

const envUrl = process.env.DATABASE_URL;
if (envUrl && !envUrl.startsWith("file:")) {
  console.error("phase3-roles refuses non-sqlite URLs (will not touch production).");
  process.exit(1);
}

const dbFile = path.join(process.cwd(), "prisma", "mesa-phase3.db");
const sqliteUrl = `file:${dbFile}`;
const demoDb = path.join(process.cwd(), "prisma", "mesa-demo.db");
const localDb = path.join(process.cwd(), "prisma", "mesa.db");

if (fs.existsSync(demoDb)) {
  const before = fs.statSync(demoDb);
  process.on("exit", () => {
    const after = fs.statSync(demoDb);
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      console.error("ERROR: prisma/mesa-demo.db was modified. Phase 2 evidence must stay intact.");
      process.exitCode = 1;
    }
  });
}

if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
if (fs.existsSync(localDb)) fs.copyFileSync(localDb, dbFile);
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--schema", "prisma/schema.sqlite.prisma", "--accept-data-loss"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: sqliteUrl },
});

const srcTree = path.join(process.cwd(), "src");
function walkTs(dir: string, acc: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}
for (const file of walkTs(srcTree)) {
  const text = fs.readFileSync(file, "utf8");
  assert.equal(
    /auditLog\.(update|delete|upsert|deleteMany|updateMany)\b/.test(text),
    false,
    `Audit must be append-only: ${file}`,
  );
}

const prisma = new PrismaClient({ datasources: { db: { url: sqliteUrl } } });

async function seedPhase3(db: PrismaClient) {
  const restaurant = await db.restaurant.findFirst();
  if (!restaurant) {
    await db.restaurant.create({
      data: {
        name: "Café Ávila · TEST FASE 3",
        rif: "J-50392847-1",
        ivaRate: 16,
        bcvRate: 148.52,
        bcvUpdatedAt: new Date(),
        bcvSource: "seed",
      },
    });
  }
  const roles = [
    { email: "admin@mesa.ve", name: "Ana Rivas", role: "ADMIN" },
    { email: "cajero@mesa.ve", name: "Carlos Méndez", role: "CAJERO" },
    { email: "mesero@mesa.ve", name: "María Castillo", role: "MESERO" },
    { email: "cocina@mesa.ve", name: "José Altuve", role: "COCINA" },
  ];
  for (const u of roles) {
    await db.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash: "unused" },
      update: { role: u.role, active: true },
    });
  }
  let station = await db.station.findFirst();
  if (!station) {
    station = await db.station.create({ data: { name: "Plancha", slug: "plancha", sortOrder: 1 } });
  }
  let category = await db.category.findFirst();
  if (!category) {
    category = await db.category.create({ data: { name: "Arepas", sortOrder: 1 } });
  }
  const existingItem = await db.item.findFirst({ where: { available: true } });
  if (!existingItem) {
    await db.item.create({
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
  }
}

function err(res: { ok?: boolean; error?: string }) {
  return res.ok === false ? res.error : undefined;
}

function asSession(user: { id: string; email: string; name: string; role: string }): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
  };
}

async function main() {
  let [adminRow, cajaRow, salonRow, cocinaRow, item, station] = await Promise.all([
    prisma.user.findFirst({ where: { role: "ADMIN" } }),
    prisma.user.findFirst({ where: { role: "CAJERO" } }),
    prisma.user.findFirst({ where: { role: "MESERO" } }),
    prisma.user.findFirst({ where: { role: "COCINA" } }),
    prisma.item.findFirst({ where: { available: true } }),
    prisma.station.findFirst(),
  ]);

  if (!adminRow || !cajaRow || !salonRow || !cocinaRow || !item || !station) {
    await seedPhase3(prisma);
    [adminRow, cajaRow, salonRow, cocinaRow, item, station] = await Promise.all([
      prisma.user.findFirst({ where: { role: "ADMIN" } }),
      prisma.user.findFirst({ where: { role: "CAJERO" } }),
      prisma.user.findFirst({ where: { role: "MESERO" } }),
      prisma.user.findFirst({ where: { role: "COCINA" } }),
      prisma.item.findFirst({ where: { available: true } }),
      prisma.station.findFirst(),
    ]);
  }

  assert.ok(adminRow && cajaRow && salonRow && cocinaRow && item && station, "Faltan usuarios o ítems de semilla.");

  const admin = asSession(adminRow);
  const caja = asSession(cajaRow);
  const salon = asSession(salonRow);
  const cocina = asSession(cocinaRow);

  assert.equal(authorize(salon, "order").user?.id, salon.id);
  assert.equal(authorize(cocina, "kitchen").user?.id, cocina.id);
  assert.equal(authorize(caja, "checkout").user?.id, caja.id);
  assert.equal(authorize(admin, "settings").user?.id, admin.id);
  assert.equal(authorize(admin, "audit").user?.id, admin.id);
  assert.equal(authorize(cocina, "order").error, PERMISSION_ERROR);
  assert.equal(authorize(salon, "kitchen").error, PERMISSION_ERROR);
  assert.equal(authorize(salon, "checkout").error, PERMISSION_ERROR);
  assert.equal(authorize(caja, "void").error, PERMISSION_ERROR);
  assert.equal(authorize(caja, "adjust").error, PERMISSION_ERROR);
  assert.equal(authorize(null, "order").error, "Sesión vencida.");

  async function openCheck(folio: string) {
    return prisma.check.create({
      data: {
        folio,
        channel: "TAKEAWAY",
        status: "OPEN",
        waiterId: salon.id,
        guestCount: 1,
      },
    });
  }

  const salonCheck = await openCheck("P3-SALON");
  const cocinaDenied = await addItemOp(prisma, cocina, { checkId: salonCheck.id, itemId: item.id });
  assert.equal(err(cocinaDenied), PERMISSION_ERROR);
  assert.equal(await prisma.orderLine.count({ where: { checkId: salonCheck.id } }), 0);

  const salonAdd = await addItemOp(prisma, salon, { checkId: salonCheck.id, itemId: item.id });
  assert.equal(err(salonAdd), undefined);
  assert.equal(salonAdd.ok, true);
  const held = await prisma.orderLine.findFirst({ where: { checkId: salonCheck.id } });
  assert.ok(held);

  const cajaAdd = await addItemOp(prisma, caja, { checkId: salonCheck.id, itemId: item.id });
  assert.equal(cajaAdd.ok, true);

  await prisma.orderLine.updateMany({
    where: { checkId: salonCheck.id },
    data: { status: "FIRED", stationId: station.id },
  });

  const salonBump = await bumpTicketOp(prisma, salon, { checkId: salonCheck.id, stationId: station.id });
  assert.equal(err(salonBump), PERMISSION_ERROR);
  assert.equal(
    await prisma.orderLine.count({ where: { checkId: salonCheck.id, status: "FIRED" } }),
    2,
  );

  const cocinaBump = await bumpTicketOp(prisma, cocina, { checkId: salonCheck.id, stationId: station.id });
  assert.equal(cocinaBump.ok, true);
  assert.equal(
    await prisma.orderLine.count({ where: { checkId: salonCheck.id, status: "BUMPED" } }),
    2,
  );

  const cajaRecall = await recallTicketOp(prisma, caja, { checkId: salonCheck.id, stationId: station.id });
  assert.equal(err(cajaRecall), PERMISSION_ERROR);
  assert.equal(
    await prisma.orderLine.count({ where: { checkId: salonCheck.id, status: "BUMPED" } }),
    2,
  );

  const cocinaRecall = await recallTicketOp(prisma, cocina, { checkId: salonCheck.id, stationId: station.id });
  assert.equal(cocinaRecall.ok, true);

  const line = await prisma.orderLine.findFirst({ where: { checkId: salonCheck.id } });
  assert.ok(line);
  const beforeDiscount = { ...line };
  const cajaDiscount = await applyDiscountOp(prisma, caja, {
    lineId: line.id,
    discountUsd: 100,
    reason: "promo caja",
  });
  assert.equal(err(cajaDiscount), PERMISSION_ERROR);
  const afterDeniedDiscount = await prisma.orderLine.findUnique({ where: { id: line.id } });
  assert.equal(afterDeniedDiscount?.discountUsd, beforeDiscount.discountUsd);
  assert.equal(afterDeniedDiscount?.courtesy, beforeDiscount.courtesy);

  const adminNoMotivo = await applyDiscountOp(prisma, admin, {
    lineId: line.id,
    discountUsd: 100,
    reason: "",
  });
  assert.equal(err(adminNoMotivo), MOTIVO_ERROR);
  assert.equal((await prisma.orderLine.findUnique({ where: { id: line.id } }))?.discountUsd, 0);

  const adminDiscount = await applyDiscountOp(prisma, admin, {
    lineId: line.id,
    discountUsd: 80,
    reason: "Descuento gerencia",
  });
  assert.equal(adminDiscount.ok, true);
  assert.equal((await prisma.orderLine.findUnique({ where: { id: line.id } }))?.discountUsd, 80);

  const courtesyDenied = await applyCourtesyOp(prisma, salon, { lineId: line.id, reason: "amigo" });
  assert.equal(err(courtesyDenied), PERMISSION_ERROR);
  assert.equal((await prisma.orderLine.findUnique({ where: { id: line.id } }))?.courtesy, false);

  const courtesyOk = await applyCourtesyOp(prisma, admin, { lineId: line.id, reason: "Cortesía del local" });
  assert.equal(courtesyOk.ok, true);
  assert.equal((await prisma.orderLine.findUnique({ where: { id: line.id } }))?.courtesy, true);

  const priceBefore = item.priceUsd;
  const cocinaPrice = await updateItemPriceOp(prisma, cocina, {
    itemId: item.id,
    priceUsd: priceBefore + 50,
    reason: "sube cocina",
  });
  assert.equal(err(cocinaPrice), PERMISSION_ERROR);
  assert.equal((await prisma.item.findUnique({ where: { id: item.id } }))?.priceUsd, priceBefore);

  const adminPriceNoReason = await updateItemPriceOp(prisma, admin, {
    itemId: item.id,
    priceUsd: priceBefore + 50,
    reason: "no",
  });
  assert.equal(err(adminPriceNoReason), MOTIVO_ERROR);
  assert.equal((await prisma.item.findUnique({ where: { id: item.id } }))?.priceUsd, priceBefore);

  const adminPrice = await updateItemPriceOp(prisma, admin, {
    itemId: item.id,
    priceUsd: priceBefore + 25,
    reason: "Ajuste lista 2026",
  });
  assert.equal(adminPrice.ok, true);
  assert.equal((await prisma.item.findUnique({ where: { id: item.id } }))?.priceUsd, priceBefore + 25);

  const taxBefore = (await prisma.item.findUnique({ where: { id: item.id } }))!;
  const cajaTax = await updateItemTaxOp(prisma, caja, {
    itemId: item.id,
    taxCode: "EXENTO",
    reason: "caja no puede",
  });
  assert.equal(err(cajaTax), PERMISSION_ERROR);
  assert.equal((await prisma.item.findUnique({ where: { id: item.id } }))?.taxCode, taxBefore.taxCode);

  const adminTax = await updateItemTaxOp(prisma, admin, {
    itemId: item.id,
    taxCode: taxBefore.taxCode === "EXENTO" ? "IVA16" : "EXENTO",
    reason: "Cambio de alícuota",
  });
  assert.equal(adminTax.ok, true);

  const voidCheck = await openCheck("P3-VOID");
  await addItemOp(prisma, salon, { checkId: voidCheck.id, itemId: item.id });
  const cajaVoid = await voidCheckOp(prisma, caja, voidCheck.id, "error de mesa");
  assert.equal(err(cajaVoid), PERMISSION_ERROR);
  assert.equal((await prisma.check.findUnique({ where: { id: voidCheck.id } }))?.status, "OPEN");

  const adminVoidNoReason = await voidCheckOp(prisma, admin, voidCheck.id, "ab");
  assert.equal(err(adminVoidNoReason), MOTIVO_ERROR);
  assert.equal((await prisma.check.findUnique({ where: { id: voidCheck.id } }))?.status, "OPEN");

  const adminVoid = await voidCheckOp(prisma, admin, voidCheck.id, "Cuenta abierta por error");
  assert.equal(adminVoid.ok, true);
  assert.equal((await prisma.check.findUnique({ where: { id: voidCheck.id } }))?.status, "VOID");

  const payCheck = await openCheck("P3-PAY");
  const pending = await prisma.payment.create({
    data: {
      checkId: payCheck.id,
      methodKey: "PAGO_MOVIL",
      methodLabel: "Pago Móvil",
      currency: "VES",
      amountCents: 1000,
      amountUsd: 7,
      amountVes: 1000,
      reference: "P3-REF",
      confirmed: false,
      note: "pendiente prueba fase 3",
    },
  });
  const cocinaConfirm = await confirmPaymentOp(prisma, cocina, pending.id);
  assert.equal(err(cocinaConfirm), PERMISSION_ERROR);
  assert.equal((await prisma.payment.findUnique({ where: { id: pending.id } }))?.confirmed, false);

  const salonConfirm = await confirmPaymentOp(prisma, salon, pending.id);
  assert.equal(err(salonConfirm), PERMISSION_ERROR);
  assert.equal((await prisma.payment.findUnique({ where: { id: pending.id } }))?.confirmed, false);

  const cajaConfirm = await confirmPaymentOp(prisma, caja, pending.id);
  assert.equal(cajaConfirm.ok, true);
  assert.equal((await prisma.payment.findUnique({ where: { id: pending.id } }))?.confirmed, true);
  const confirmAudit = await prisma.auditLog.findFirst({
    where: { action: "PAYMENT_CONFIRM", checkId: payCheck.id },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(confirmAudit);
  assert.match(confirmAudit.details, /PAGO_MOVIL|P3-REF|confirmed/);
  assert.equal(confirmAudit.userId, caja.id);
  const confirmAgain = await confirmPaymentOp(prisma, caja, pending.id);
  assert.equal(confirmAgain.ok, false);
  assert.equal(
    await prisma.auditLog.count({ where: { action: "PAYMENT_CONFIRM", checkId: payCheck.id } }),
    1,
    "reintentar una confirmación no duplica la bitácora",
  );

  const paid = await openCheck("P3-REOPEN");
  await prisma.check.update({
    where: { id: paid.id },
    data: { status: "PAID", closedAt: new Date() },
  });
  const cajaReopen = await reopenCheckOp(prisma, caja, paid.id, "cliente volvió");
  assert.equal(err(cajaReopen), PERMISSION_ERROR);
  assert.equal((await prisma.check.findUnique({ where: { id: paid.id } }))?.status, "PAID");

  const adminReopenNoReason = await reopenCheckOp(prisma, admin, paid.id, "");
  assert.equal(err(adminReopenNoReason), MOTIVO_ERROR);
  assert.equal((await prisma.check.findUnique({ where: { id: paid.id } }))?.status, "PAID");

  const adminReopen = await reopenCheckOp(prisma, admin, paid.id, "Reabre por error de cobro");
  assert.equal(adminReopen.ok, true);
  assert.equal((await prisma.check.findUnique({ where: { id: paid.id } }))?.status, "OPEN");

  const audits = await prisma.auditLog.findMany({
    where: {
      action: { in: ["VOID", "DISCOUNT", "COURTESY", "PRICE_CHANGE", "TAX_CHANGE", "PAYMENT_CONFIRM", "REOPEN_CHECK"] },
    },
    orderBy: { createdAt: "asc" },
  });
  assert.ok(audits.length >= 6, "Faltan filas de bitácora");
  for (const row of audits) {
    assert.ok(row.reason.length >= 3);
    assert.ok(row.createdAt);
    assert.ok(row.action);
  }
  const priceAudit = audits.find((a) => a.action === "PRICE_CHANGE");
  assert.ok(priceAudit);
  const parsed = JSON.parse(priceAudit.details) as { from?: { priceUsd?: number }; to?: { priceUsd?: number } };
  assert.equal(parsed.from?.priceUsd, priceBefore);
  assert.equal(parsed.to?.priceUsd, priceBefore + 25);

  await prisma.check.deleteMany({ where: { folio: { startsWith: "P2-" } } });

  console.log("phase3-roles: OK");
  console.log("  Salón agrega ítems; Cocina bump/recupera; Caja confirma pagos; Admin anula/ajusta/reabre.");
  console.log("  Roles ajenos rechazados en ops (sin mutar). Motivo obligatorio en ops sensibles.");
  console.log("  Bitácora append-only (sin update/delete en src). Confirmación de pago auditada.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
