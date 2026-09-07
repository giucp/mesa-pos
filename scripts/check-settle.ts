import assert from "node:assert/strict";
import { usdToVesCents } from "../src/lib/money";
import { settleTender, paymentIsConfirmed, summarizePayments, parseSettleNote, settleNote } from "../src/lib/caja";
import { confirmedPaymentUsd, normalizePaymentOpId } from "../src/lib/payment-status";

const rate = 148.52;

const usdExact = settleTender({ tenderedCents: 754, currency: "USD", remainingUsd: 754, rate });
assert.equal(usdExact.appliedUsd, 754);
assert.equal(usdExact.changeUsd, 0);
assert.equal(usdExact.appliedCents, 754);

const usdVuelto = settleTender({ tenderedCents: 2000, currency: "USD", remainingUsd: 754, rate });
assert.equal(usdVuelto.appliedUsd, 754);
assert.equal(usdVuelto.changeUsd, 1246);
assert.equal(usdVuelto.appliedCents, 754);
assert.equal(usdVuelto.changeCents, 1246);

const vesNeeded = usdToVesCents(754, rate);
const vesExact = settleTender({ tenderedCents: vesNeeded, currency: "VES", remainingUsd: 754, rate });
assert.ok(Math.abs(vesExact.appliedUsd - 754) <= 1);
assert.equal(vesExact.changeUsd, 0);

const vesVuelto = settleTender({ tenderedCents: 200000, currency: "VES", remainingUsd: 754, rate });
assert.equal(vesVuelto.appliedUsd, 754);
assert.ok(vesVuelto.changeCents > 0);
assert.ok(vesVuelto.appliedCents < 200000);

const p2aPm = settleTender({ tenderedCents: 10000, currency: "VES", remainingUsd: 10000, rate });
assert.equal(p2aPm.appliedCents, 10000, "P2-A bank amount stays Bs 100");
assert.equal(p2aPm.changeCents, 0, "no cash return → real vuelto 0");
assert.equal(p2aPm.appliedUsd, 67);
assert.notEqual(p2aPm.appliedCents, 9951);
assert.notEqual(p2aPm.changeCents, 49);

const leftoverUsd = 377;
const leftoverVes = usdToVesCents(leftoverUsd, rate);
const handedVes = usdToVesCents(754, rate) + 50000;
const p2cOverage = settleTender({
  tenderedCents: handedVes,
  currency: "VES",
  remainingUsd: leftoverUsd,
  rate,
});
assert.equal(p2cOverage.appliedCents, leftoverVes);
assert.equal(p2cOverage.changeCents, handedVes - leftoverVes);
assert.ok(p2cOverage.changeCents > 0);

assert.equal(paymentIsConfirmed({ methodKey: "PAGO_MOVIL", verified: undefined }), false);
assert.equal(paymentIsConfirmed({ methodKey: "PAGO_MOVIL", verified: false }), false);
assert.equal(paymentIsConfirmed({ methodKey: "PAGO_MOVIL", verified: true }), true);
assert.equal(paymentIsConfirmed({ methodKey: "CASH_USD", verified: undefined }), true);
assert.equal(paymentIsConfirmed({ methodKey: "CASH_USD", verified: false }), false);
assert.equal(
  confirmedPaymentUsd([
    { amountUsd: 754, confirmed: true },
    { amountUsd: 67, confirmed: false },
  ]),
  754,
  "un pago pendiente no reduce el saldo confirmado",
);
assert.equal(normalizePaymentOpId("pay-12345"), "pay-12345");
assert.equal(normalizePaymentOpId("short"), null);
assert.equal(normalizePaymentOpId("pay id invalid"), null);

const note = settleNote({ tenderedCents: 2000, changeCents: 1246, idempotencyKey: "abc-1", extra: "Vuelto" });
const parsed = parseSettleNote(note);
assert.equal(parsed.tenderedCents, 2000);
assert.equal(parsed.changeCents, 1246);
assert.equal(parsed.idempotencyKey, "abc-1");

const caja = summarizePayments(
  [
    {
      methodKey: "CASH_USD",
      methodLabel: "Efectivo USD",
      currency: "USD",
      amountCents: 754,
      amountUsd: 754,
      amountVes: 112000,
      igtfUsd: 0,
      confirmed: true,
    },
    {
      methodKey: "PAGO_MOVIL",
      methodLabel: "Pago Móvil",
      currency: "VES",
      amountCents: 50000,
      amountUsd: 337,
      amountVes: 50000,
      igtfUsd: 0,
      confirmed: false,
    },
  ],
  rate,
);
assert.equal(caja.cashUsd, 754);
assert.equal(caja.pendingUsd, 337);
assert.equal(caja.receivedUsd, 754);
assert.equal(caja.collectedVes, 0);

console.log("settle ok");
