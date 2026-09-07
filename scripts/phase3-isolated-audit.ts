/**
 * Isolated-only audit fixtures. Refuses production Postgres.
 * Does not touch P2-* folios or their payments.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FASE2_FOLIOS, FASE3_AUDIT } from "../src/lib/isolated-demo";
import { applyCourtesyOp, confirmPaymentOp } from "../src/lib/ops";
import type { SessionUser } from "../src/lib/roles";

import { isolatedPrisma } from "./isolated-target";

const prisma = isolatedPrisma("phase3-isolated-audit");

function asSession(user: { id: string; email: string; name: string; role: string }): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
  };
}

async function main() {
  const p2 = await prisma.check.count({ where: { folio: { in: Object.values(FASE2_FOLIOS) } } });
  assert.ok(p2 >= 3, "Faltan folios Fase 2; no se siembra auditoría encima de un demo vacío.");

  const [adminRow, cajaRow, item] = await Promise.all([
    prisma.user.findFirst({ where: { role: "ADMIN" } }),
    prisma.user.findFirst({ where: { role: "CAJERO" } }),
    prisma.item.findFirst({ where: { available: true } }),
  ]);
  assert.ok(adminRow && cajaRow && item);
  const admin = asSession(adminRow);
  const caja = asSession(cajaRow);

  let confirmCheck = await prisma.check.findUnique({ where: { folio: FASE3_AUDIT.confirmFolio } });
  if (!confirmCheck) {
    confirmCheck = await prisma.check.create({
      data: {
        folio: FASE3_AUDIT.confirmFolio,
        channel: "TAKEAWAY",
        status: "OPEN",
        waiterId: caja.id,
        guestCount: 1,
        notes: "Fixture bitácora — no es venta Fase 2",
      },
    });
  }

  let pending = await prisma.payment.findFirst({
    where: { checkId: confirmCheck.id, reference: FASE3_AUDIT.pendingRef },
  });
  if (!pending) {
    pending = await prisma.payment.create({
      data: {
        checkId: confirmCheck.id,
        methodKey: "PAGO_MOVIL",
        methodLabel: "Pago Móvil",
        currency: "VES",
        amountCents: 14852,
        amountUsd: 100,
        amountVes: 14852,
        reference: FASE3_AUDIT.pendingRef,
        confirmed: false,
        note: "SETTLE t=14852 c=0 | fixture auditoría",
      },
    });
  }

  if (!pending.confirmed) {
    const res = await confirmPaymentOp(prisma, caja, pending.id, FASE3_AUDIT.confirmReason);
    assert.equal(res.ok, true, res.ok === false ? res.error : "confirm");
  }

  let courtesyCheck = await prisma.check.findUnique({ where: { folio: FASE3_AUDIT.courtesyFolio } });
  if (!courtesyCheck) {
    courtesyCheck = await prisma.check.create({
      data: {
        folio: FASE3_AUDIT.courtesyFolio,
        channel: "TAKEAWAY",
        status: "OPEN",
        waiterId: admin.id,
        guestCount: 1,
        notes: "Fixture cortesía — no es venta Fase 2",
      },
    });
  }
  let line = await prisma.orderLine.findFirst({ where: { checkId: courtesyCheck.id } });
  if (!line) {
    line = await prisma.orderLine.create({
      data: {
        checkId: courtesyCheck.id,
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
  }
  if (!line.courtesy) {
    const res = await applyCourtesyOp(prisma, admin, {
      lineId: line.id,
      reason: FASE3_AUDIT.courtesyReason,
    });
    assert.equal(res.ok, true, res.ok === false ? res.error : "courtesy");
  }

  const p2After = await prisma.check.findMany({
    where: { folio: { in: Object.values(FASE2_FOLIOS) } },
    include: { payments: true },
  });
  assert.equal(p2After.length, p2);
  for (const c of p2After) {
    if (c.folio === FASE2_FOLIOS.A) {
      const pendingA = c.payments.find((p) => p.reference === "REF-NO-CONFIRM");
      assert.ok(pendingA);
      assert.equal(pendingA.confirmed, false, "No confirmar el Pago Móvil pendiente de P2-A.");
    }
  }

  const audits = await prisma.auditLog.findMany({
    where: { reason: { in: [FASE3_AUDIT.confirmReason, FASE3_AUDIT.courtesyReason] } },
    orderBy: { createdAt: "asc" },
  });
  assert.ok(audits.some((a) => a.action === "PAYMENT_CONFIRM"));
  assert.ok(audits.some((a) => a.action === "COURTESY"));

  const note = {
    isolated: true,
    productionTouched: false,
    p2FoliosUntouched: Object.values(FASE2_FOLIOS),
    audits: audits.map((a) => ({
      id: a.id,
      action: a.action,
      reason: a.reason,
      userId: a.userId,
      checkId: a.checkId,
      details: a.details,
      createdAt: a.createdAt.toISOString(),
    })),
  };
  fs.writeFileSync(
    path.join(process.cwd(), "prisma", "fase3-isolated-note.json"),
    JSON.stringify(note, null, 2),
  );
  console.log("phase3-isolated-audit: OK", JSON.stringify(note, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
