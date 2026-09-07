/**
 * P2-A Pago Móvil rounding: Bs 100 stays original, real vuelto is 0.
 * Checks before confirm, after confirm, and after a fresh Prisma reload.
 * Uses prisma/mesa-p2-round.db only — never confirms P2-A REF-NO-CONFIRM.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  describePaymentSettle,
  parseSettleNote,
  paymentIsConfirmed,
  settleNote,
  settleTender,
  summarizePayments,
} from "../src/lib/caja";
import { vesToUsdCents } from "../src/lib/money";
import { confirmPaymentOp } from "../src/lib/ops";
import type { SessionUser } from "../src/lib/roles";

const envUrl = process.env.DATABASE_URL;
if (envUrl && !envUrl.startsWith("file:")) {
  console.error("phase2-pm-round refuses non-sqlite URLs (will not touch production).");
  process.exit(1);
}

const dbFile = path.join(process.cwd(), "prisma", "mesa-p2-round.db");
const sqliteUrl = `file:${dbFile}`;
const demoDb = path.join(process.cwd(), "prisma", "mesa-demo.db");
const localDb = path.join(process.cwd(), "prisma", "mesa.db");

if (fs.existsSync(demoDb)) {
  const before = fs.statSync(demoDb);
  process.on("exit", () => {
    const after = fs.statSync(demoDb);
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      console.error("ERROR: prisma/mesa-demo.db was modified. P2-A pending must stay intact.");
      process.exitCode = 1;
    }
  });
}

if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
if (fs.existsSync(localDb)) fs.copyFileSync(localDb, dbFile);
execSync("npx prisma db push --schema prisma/schema.sqlite.prisma --accept-data-loss", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: sqliteUrl },
});

const RATE = 148.52;
const BS100 = 10000;
const REMAINING_USD = 10000;
const FOLIO = "P2-ROUND-PM";
const REF = "P2-ROUND-REF";

function asSession(user: { id: string; email: string; name: string; role: string }): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
  };
}

function assertP2ATreatment(
  payment: {
    currency: string;
    amountCents: number;
    amountUsd: number;
    amountVes: number;
    confirmed: boolean;
    note: string | null;
    reference: string | null;
  },
  stage: "before-confirm" | "after-confirm" | "after-reload",
) {
  const settle = parseSettleNote(payment.note);
  const ui = describePaymentSettle(payment);
  assert.equal(payment.amountCents, BS100, `${stage}: stored bank amount is Bs 100`);
  assert.equal(payment.amountVes, BS100, `${stage}: amountVes stays Bs 100`);
  assert.equal(payment.amountUsd, vesToUsdCents(BS100, RATE), `${stage}: USD book is conversion of Bs 100`);
  assert.equal(settle.tenderedCents, BS100, `${stage}: handed Bs 100`);
  assert.equal(settle.changeCents, 0, `${stage}: real vuelto is 0`);
  assert.notEqual(payment.amountCents, 9951, `${stage}: must not store reconverted Bs 99,51`);
  assert.notEqual(settle.changeCents, 49, `${stage}: must not invent Bs 0,49 vuelto`);
  assert.equal(ui.appliedCents, BS100);
  assert.equal(ui.changeCents, 0);
  assert.equal(ui.changeLabel, "Bs 0,00");
  if (stage === "before-confirm") {
    assert.equal(payment.confirmed, false);
    assert.equal(ui.cajaNetCents, 0);
  } else {
    assert.equal(payment.confirmed, true, `${stage}: confirmed`);
    assert.equal(ui.cajaNetCents, BS100);
  }
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: sqliteUrl } } });

  let restaurant = await prisma.restaurant.findFirst();
  if (!restaurant) {
    restaurant = await prisma.restaurant.create({
      data: {
        name: "Café Ávila · TEST P2-A ROUND",
        rif: "J-50392847-1",
        ivaRate: 16,
        bcvRate: RATE,
        bcvUpdatedAt: new Date(),
        bcvSource: "seed",
      },
    });
  }
  let cajaRow = await prisma.user.findFirst({ where: { role: "CAJERO" } });
  if (!cajaRow) {
    cajaRow = await prisma.user.create({
      data: {
        email: "cajero@mesa.ve",
        name: "Carlos Méndez",
        role: "CAJERO",
        passwordHash: "unused",
      },
    });
  }
  const caja = asSession(cajaRow);

  const settle = settleTender({
    tenderedCents: BS100,
    currency: "VES",
    remainingUsd: REMAINING_USD,
    rate: RATE,
  });
  assert.equal(settle.appliedCents, BS100);
  assert.equal(settle.changeCents, 0);
  assert.equal(settle.appliedUsd, 67);

  const check = await prisma.check.create({
    data: {
      folio: FOLIO,
      channel: "TAKEAWAY",
      status: "OPEN",
      waiterId: caja.id,
      guestCount: 1,
      bcvRateUsed: RATE,
      bcvSource: "seed",
    },
  });

  const created = await prisma.payment.create({
    data: {
      checkId: check.id,
      methodKey: "PAGO_MOVIL",
      methodLabel: "Pago Móvil",
      currency: "VES",
      amountCents: settle.appliedCents,
      amountUsd: settle.appliedUsd,
      amountVes: settle.appliedVes,
      bcvRate: RATE,
      bcvSource: "seed",
      igtfUsd: 0,
      reference: REF,
      confirmed: paymentIsConfirmed({ methodKey: "PAGO_MOVIL", verified: false }),
      note: settleNote({
        tenderedCents: settle.tenderedCents,
        changeCents: settle.changeCents,
        idempotencyKey: "p2-round-1",
      }),
    },
  });

  const before = await prisma.payment.findUnique({ where: { id: created.id } });
  assert.ok(before);
  assertP2ATreatment(before, "before-confirm");
  const cajaBefore = summarizePayments(
    [
      {
        methodKey: before.methodKey,
        methodLabel: before.methodLabel,
        currency: before.currency,
        amountCents: before.amountCents,
        amountUsd: before.amountUsd,
        amountVes: before.amountVes,
        igtfUsd: before.igtfUsd,
        confirmed: before.confirmed,
      },
    ],
    RATE,
  );
  assert.equal(cajaBefore.pendingUsd, before.amountUsd, "pending: not received");
  assert.equal(cajaBefore.receivedUsd, 0);
  assert.equal(cajaBefore.collectedVes, 0);
  assert.equal(cajaBefore.cashVes, 0);

  const confirm = await confirmPaymentOp(prisma, caja, before.id, "Prueba P2-A — confirmar Pago Móvil Bs 100");
  assert.equal(confirm.ok, true, confirm.ok === false ? confirm.error : "confirm");

  const after = await prisma.payment.findUnique({ where: { id: created.id } });
  assert.ok(after);
  assertP2ATreatment(after, "after-confirm");
  const cajaAfter = summarizePayments(
    [
      {
        methodKey: after.methodKey,
        methodLabel: after.methodLabel,
        currency: after.currency,
        amountCents: after.amountCents,
        amountUsd: after.amountUsd,
        amountVes: after.amountVes,
        igtfUsd: after.igtfUsd,
        confirmed: after.confirmed,
      },
    ],
    RATE,
  );
  assert.equal(cajaAfter.pendingUsd, 0);
  assert.equal(cajaAfter.receivedUsd, after.amountUsd);
  assert.equal(cajaAfter.collectedVes, BS100, "confirm: bank amount stays Bs 100");
  assert.equal(cajaAfter.cashVes, 0, "Pago Móvil is not cash outflow");

  await prisma.$disconnect();

  const reloadedClient = new PrismaClient({ datasources: { db: { url: sqliteUrl } } });
  const reloaded = await reloadedClient.payment.findUnique({ where: { id: created.id } });
  assert.ok(reloaded);
  assertP2ATreatment(reloaded, "after-reload");
  assert.equal(reloaded.reference, REF);
  await reloadedClient.$disconnect();

  console.log("phase2-pm-round: OK", {
    test: "phase2-pm-round",
    folio: FOLIO,
    amountCents: BS100,
    vuelto: 0,
    stages: ["before-confirm", "after-confirm", "after-reload"],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
