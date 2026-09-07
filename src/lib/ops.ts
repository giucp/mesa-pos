import type { PrismaClient } from "@prisma/client";
import { authorize, requireMotivo } from "@/lib/permissions";
import { auditDetails } from "@/lib/audit-shape";
import { TAX_CODE_RATE, asTaxCode } from "@/lib/fiscal";
import { lineTotalUsd } from "@/lib/money";
import type { SessionUser } from "@/lib/roles";
import { hasOrderConflict, type ServerCheckSnapshot } from "@/lib/sync-state";
import { classifyPaymentRow, normalizePaymentOpId } from "@/lib/payment-status";
import { parseSettleNote } from "@/lib/caja";
import {
  DRAWER_KEY,
  SHIFT_KIND_LABEL,
  SHIFT_KIND_MESA,
  differenceLabel,
  drawerDifference,
  hasDrawerDifference,
  summarizeShift,
  type CloseSummary,
} from "@/lib/shift";
import { commitReservedLines, lineIsPrepared, releaseStock, reserveStock } from "@/lib/stock";

type Db = PrismaClient;

async function appendAudit(
  db: Db,
  input: {
    action: string;
    reason: string;
    userId?: string | null;
    checkId?: string | null;
    details?: string;
  },
) {
  return db.auditLog.create({
    data: {
      action: input.action,
      reason: input.reason.trim(),
      userId: input.userId ?? null,
      checkId: input.checkId ?? null,
      details: input.details ?? "",
    },
  });
}

export type OrderConflictResult = {
  ok: false;
  conflict: true;
  error: string;
  server: ServerCheckSnapshot;
};

async function checkSnapshot(db: Db, checkId: string, folio: string, updatedAt: Date): Promise<ServerCheckSnapshot> {
  const lines = await db.orderLine.findMany({
    where: { checkId, status: { not: "VOID" } },
    select: { id: true, name: true, qty: true, notes: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    folio,
    updatedAt: updatedAt.toISOString(),
    lineIds: lines.map((l) => l.id),
    lines,
  };
}

export async function addItemOp(
  db: Db,
  user: SessionUser | null,
  input: {
    checkId: string;
    itemId: string;
    modifierIds?: string[];
    notes?: string;
    qty?: number;
    clientOpId?: string;
    knownLineIds?: string[];
    baseUpdatedAt?: string | Date;
  },
) {
  const auth = authorize(user, "order");
  if (!auth.ok) return auth;
  if (input.clientOpId) {
    const replay = await db.orderLine.findFirst({ where: { clientOpId: input.clientOpId } });
    if (replay) {
      const check = await db.check.findUnique({ where: { id: replay.checkId } });
      return {
        ok: true as const,
        lineId: replay.id,
        duplicate: true as const,
        updatedAt: (check?.updatedAt ?? new Date()).toISOString(),
      };
    }
  }
  const [check, item] = await Promise.all([
    db.check.findUnique({
      where: { id: input.checkId },
      include: { lines: { where: { status: { not: "VOID" } }, select: { id: true } } },
    }),
    db.item.findUnique({ where: { id: input.itemId }, include: { modifiers: true } }),
  ]);
  if (!check || !["OPEN", "SENT", "PARTIAL"].includes(check.status)) {
    return { ok: false as const, error: "La cuenta no acepta ítems." };
  }
  if (!item || !item.available) return { ok: false as const, error: "Ese plato no está disponible." };
  if (
    hasOrderConflict({
      knownLineIds: input.knownLineIds,
      baseUpdatedAt: input.baseUpdatedAt,
      server: { updatedAt: check.updatedAt, lines: check.lines },
    })
  ) {
    const server = await checkSnapshot(db, check.id, check.folio, check.updatedAt);
    return {
      ok: false as const,
      conflict: true as const,
      error: "Otra sesión cambió esta cuenta. Revisa el conflicto; no se pisó el pedido.",
      server,
    } satisfies OrderConflictResult;
  }
  const mods = item.modifiers.filter((m) => (input.modifierIds ?? []).includes(m.id));
  const qty = Math.max(1, Math.round(input.qty ?? 1));
  try {
    return await db.$transaction(async (tx) => {
      const reserved = await reserveStock(tx, {
        item,
        qty,
        user: auth.user,
        checkId: check.id,
        clientOpId: input.clientOpId,
      });
      if (!reserved.ok) return reserved;
      const line = await tx.orderLine.create({
        data: {
          checkId: input.checkId,
          itemId: item.id,
          name: item.name,
          qty,
          priceUsd: item.priceUsd,
          notes: input.notes?.trim() || null,
          modifiers: JSON.stringify(mods.map((m) => ({ name: m.name, priceUsd: m.priceUsd }))),
          status: "HELD",
          stationId: item.stationId,
          taxCode: item.taxCode,
          ivaRate: item.ivaRate,
          clientOpId: input.clientOpId || null,
          stockReserved: reserved.reserved,
          stockCommitted: false,
        },
      });
      const touched = await tx.check.update({
        where: { id: input.checkId },
        data: { updatedAt: new Date() },
      });
      return { ok: true as const, lineId: line.id, updatedAt: touched.updatedAt.toISOString() };
    });
  } catch (error) {
    if (input.clientOpId) {
      const replay = await db.orderLine.findFirst({ where: { clientOpId: input.clientOpId } });
      if (replay) {
        return { ok: true as const, lineId: replay.id, duplicate: true as const };
      }
    }
    return { ok: false as const, error: error instanceof Error ? error.message : "No se pudo agregar el plato." };
  }
}

export async function bumpTicketOp(
  db: Db,
  user: SessionUser | null,
  input: { checkId: string; stationId: string },
) {
  const auth = authorize(user, "kitchen");
  if (!auth.ok) return auth;
  const now = new Date();
  await db.orderLine.updateMany({
    where: { checkId: input.checkId, stationId: input.stationId, status: "FIRED" },
    data: { status: "BUMPED", bumpedAt: now },
  });
  return { ok: true as const };
}

export async function recallTicketOp(
  db: Db,
  user: SessionUser | null,
  input: { checkId: string; stationId: string },
) {
  const auth = authorize(user, "kitchen");
  if (!auth.ok) return auth;
  await db.orderLine.updateMany({
    where: { checkId: input.checkId, stationId: input.stationId, status: "BUMPED" },
    data: { status: "FIRED", bumpedAt: null },
  });
  return { ok: true as const };
}

export async function voidCheckOp(db: Db, user: SessionUser | null, checkId: string, reason: string) {
  const auth = authorize(user, "void");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(reason);
  if (!motivo.ok) return motivo;
  const check = await db.check.findUnique({
    where: { id: checkId },
    include: { lines: true },
  });
  if (!check) return { ok: false as const, error: "Cuenta no encontrada." };
  if (["PAID", "VOID", "CLOSED"].includes(check.status)) {
    return { ok: false as const, error: "Esa cuenta ya está cerrada." };
  }
  await db.$transaction(async (tx) => {
    for (const line of check.lines) {
      if (line.status === "VOID") continue;
      const reserved = line.stockReserved ?? 0;
      if (reserved <= 0) continue;
      if (lineIsPrepared(line.status, line.stockCommitted)) {
        continue;
      }
      await releaseStock(tx, {
        itemId: line.itemId,
        qty: reserved,
        user: auth.user,
        checkId,
        lineId: line.id,
        clientOpId: line.clientOpId ? `release:${line.clientOpId}` : `release-line:${line.id}`,
        motivo: "Anulación antes de preparar — se libera la reserva",
      });
    }
    await tx.check.update({
      where: { id: checkId },
      data: { status: "VOID", voidedAt: new Date(), voidReason: motivo.reason },
    });
    await tx.orderLine.updateMany({
      where: { checkId, status: { not: "VOID" } },
      data: { status: "VOID" },
    });
    await tx.voidLog.create({
      data: {
        checkId,
        userId: auth.user.id,
        reason: motivo.reason,
        details: `Anulación ${check.folio}`,
      },
    });
    const prepared = check.lines.filter(
      (l) => l.status !== "VOID" && (l.stockReserved ?? 0) > 0 && lineIsPrepared(l.status, l.stockCommitted),
    );
    await tx.auditLog.create({
      data: {
        action: "VOID",
        reason: motivo.reason,
        userId: auth.user.id,
        checkId,
        details: auditDetails({
          entity: "check",
          entityId: checkId,
          folio: check.folio,
          from: check.status,
          to: "VOID",
          extra: {
            stockKept: prepared.map((l) => ({ lineId: l.id, name: l.name, qty: l.stockReserved })),
          },
        }),
      },
    });
    if (check.tableId) {
      await tx.diningTable.update({ where: { id: check.tableId }, data: { status: "FREE" } });
    }
  });
  return { ok: true as const };
}

export async function changeQtyOp(db: Db, user: SessionUser | null, lineId: string, delta: number) {
  const auth = authorize(user, "order");
  if (!auth.ok) return auth;
  const line = await db.orderLine.findUnique({ where: { id: lineId } });
  if (!line || line.status === "VOID" || line.status === "BUMPED") {
    return { ok: false as const, error: "No se puede cambiar esa línea." };
  }
  if (line.status !== "HELD") {
    return { ok: false as const, error: "Ya se envió a cocina. Anula y agrega de nuevo." };
  }
  const qty = line.qty + delta;
  return db.$transaction(async (tx) => {
    if (qty <= 0) {
      if ((line.stockReserved ?? 0) > 0 && !lineIsPrepared(line.status, line.stockCommitted)) {
        await releaseStock(tx, {
          itemId: line.itemId,
          qty: line.stockReserved,
          user: auth.user,
          checkId: line.checkId,
          lineId: line.id,
          clientOpId: `release-line:${line.id}`,
          motivo: "Se quitó el plato antes de preparar",
        });
      }
      await tx.orderLine.delete({ where: { id: lineId } });
      return { ok: true as const };
    }
    if (delta > 0 && line.itemId) {
      const item = await tx.item.findUnique({ where: { id: line.itemId } });
      if (item?.stockControlled) {
        const reserved = await reserveStock(tx, {
          item,
          qty: delta,
          user: auth.user,
          checkId: line.checkId,
          lineId: line.id,
          clientOpId: `qty:${line.id}:${line.qty}:${qty}`,
        });
        if (!reserved.ok) return reserved;
        await tx.orderLine.update({
          where: { id: lineId },
          data: { qty, stockReserved: (line.stockReserved ?? 0) + reserved.reserved },
        });
        return { ok: true as const };
      }
    }
    if (delta < 0 && (line.stockReserved ?? 0) > 0 && !lineIsPrepared(line.status, line.stockCommitted)) {
      const releaseQty = Math.min(line.stockReserved, Math.abs(delta));
      await releaseStock(tx, {
        itemId: line.itemId,
        qty: releaseQty,
        user: auth.user,
        checkId: line.checkId,
        lineId: line.id,
        clientOpId: `qty-release:${line.id}:${line.qty}:${qty}`,
        motivo: "Se bajó la cantidad antes de preparar",
      });
      await tx.orderLine.update({
        where: { id: lineId },
        data: { qty, stockReserved: Math.max(0, (line.stockReserved ?? 0) - releaseQty) },
      });
      return { ok: true as const };
    }
    await tx.orderLine.update({ where: { id: lineId }, data: { qty } });
    return { ok: true as const };
  });
}

export async function removeLineOp(db: Db, user: SessionUser | null, lineId: string) {
  const auth = authorize(user, "order");
  if (!auth.ok) return auth;
  const line = await db.orderLine.findUnique({ where: { id: lineId } });
  if (!line) return { ok: false as const, error: "Línea no existe." };
  if (line.status !== "HELD") return { ok: false as const, error: "Solo se quitan ítems no enviados." };
  await db.$transaction(async (tx) => {
    if ((line.stockReserved ?? 0) > 0 && !lineIsPrepared(line.status, line.stockCommitted)) {
      await releaseStock(tx, {
        itemId: line.itemId,
        qty: line.stockReserved,
        user: auth.user,
        checkId: line.checkId,
        lineId: line.id,
        clientOpId: `release-line:${line.id}`,
        motivo: "Se quitó el plato antes de preparar",
      });
    }
    await tx.orderLine.delete({ where: { id: lineId } });
  });
  return { ok: true as const };
}

export async function sendToKitchenOp(db: Db, user: SessionUser | null, checkId: string) {
  const auth = authorize(user, "order");
  if (!auth.ok) return auth;
  const held = await db.orderLine.findMany({ where: { checkId, status: "HELD" } });
  if (!held.length) return { ok: false as const, error: "No hay ítems nuevos para enviar." };
  const now = new Date();
  const ids = held.map((l) => l.id);
  await db.$transaction(async (tx) => {
    await tx.orderLine.updateMany({
      where: { id: { in: ids }, status: "HELD" },
      data: { status: "FIRED", sentAt: now },
    });
    await commitReservedLines(tx, { lineIds: ids });
    await tx.check.update({
      where: { id: checkId },
      data: { status: "SENT", sentAt: now },
    });
  });
  return { ok: true as const, count: held.length };
}

export async function applyDiscountOp(
  db: Db,
  user: SessionUser | null,
  input: { lineId: string; discountUsd: number; reason: string },
) {
  const auth = authorize(user, "adjust");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(input.reason);
  if (!motivo.ok) return motivo;
  const line = await db.orderLine.findUnique({ where: { id: input.lineId } });
  if (!line || line.status === "VOID") return { ok: false as const, error: "Línea no válida." };
  const max = lineTotalUsd(line.qty, line.priceUsd, line.modifiers);
  const discountUsd = Math.max(0, Math.min(max, Math.round(input.discountUsd)));
  await db.orderLine.update({
    where: { id: input.lineId },
    data: { discountUsd, courtesy: false, courtesyReason: null },
  });
  await appendAudit(db, {
    action: "DISCOUNT",
    reason: motivo.reason,
    userId: auth.user.id,
    checkId: line.checkId,
    details: auditDetails({
      entity: "orderLine",
      entityId: line.id,
      itemName: line.name,
      from: { discountUsd: line.discountUsd },
      to: { discountUsd },
    }),
  });
  return { ok: true as const };
}

export async function applyCourtesyOp(
  db: Db,
  user: SessionUser | null,
  input: { lineId: string; reason: string },
) {
  const auth = authorize(user, "adjust");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(input.reason);
  if (!motivo.ok) return motivo;
  const line = await db.orderLine.findUnique({
    where: { id: input.lineId },
    include: { check: { select: { folio: true } } },
  });
  if (!line || line.status === "VOID") return { ok: false as const, error: "Línea no válida." };
  await db.orderLine.update({
    where: { id: input.lineId },
    data: { courtesy: true, courtesyReason: motivo.reason, discountUsd: 0 },
  });
  await appendAudit(db, {
    action: "COURTESY",
    reason: motivo.reason,
    userId: auth.user.id,
    checkId: line.checkId,
    details: auditDetails({
      entity: "orderLine",
      entityId: line.id,
      folio: line.check.folio,
      itemName: line.name,
      from: { courtesy: line.courtesy },
      to: { courtesy: true },
    }),
  });
  return { ok: true as const };
}

export async function updateItemPriceOp(
  db: Db,
  user: SessionUser | null,
  input: { itemId: string; priceUsd: number; reason: string },
) {
  const auth = authorize(user, "menu");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(input.reason);
  if (!motivo.ok) return motivo;
  if (!Number.isFinite(input.priceUsd) || input.priceUsd < 0) {
    return { ok: false as const, error: "Precio inválido." };
  }
  const item = await db.item.findUnique({ where: { id: input.itemId } });
  if (!item) return { ok: false as const, error: "Ese plato ya no existe." };
  const priceUsd = Math.round(input.priceUsd);
  await db.item.update({ where: { id: input.itemId }, data: { priceUsd } });
  await appendAudit(db, {
    action: "PRICE_CHANGE",
    reason: motivo.reason,
    userId: auth.user.id,
    details: auditDetails({
      entity: "item",
      entityId: item.id,
      itemName: item.name,
      from: { priceUsd: item.priceUsd },
      to: { priceUsd },
    }),
  });
  return { ok: true as const };
}

export async function updateItemTaxOp(
  db: Db,
  user: SessionUser | null,
  input: { itemId: string; taxCode: string; reason: string },
) {
  const auth = authorize(user, "menu");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(input.reason);
  if (!motivo.ok) return motivo;
  const item = await db.item.findUnique({ where: { id: input.itemId } });
  if (!item) return { ok: false as const, error: "Ese plato ya no existe." };
  const taxCode = asTaxCode(input.taxCode);
  const ivaRate = TAX_CODE_RATE[taxCode];
  await db.item.update({ where: { id: input.itemId }, data: { taxCode, ivaRate } });
  await appendAudit(db, {
    action: "TAX_CHANGE",
    reason: motivo.reason,
    userId: auth.user.id,
    details: auditDetails({
      entity: "item",
      entityId: item.id,
      itemName: item.name,
      from: { taxCode: item.taxCode, ivaRate: item.ivaRate },
      to: { taxCode, ivaRate },
    }),
  });
  return { ok: true as const };
}

export async function confirmPaymentOp(
  db: Db,
  user: SessionUser | null,
  paymentId: string,
  reason = "Caja confirmó el pago digital",
) {
  const auth = authorize(user, "checkout");
  if (!auth.ok) return auth;
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { check: { select: { folio: true } } },
    });
    if (!payment) return { ok: false as const, error: "Pago no encontrado." };
    if (payment.confirmed) return { ok: false as const, error: "Ese pago ya está verificado." };
    const open = await tx.cashShift.findFirst({
      where: { drawerKey: DRAWER_KEY, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    const nextShiftId =
      !payment.shiftId || (open && payment.shiftId !== open.id) ? open?.id ?? payment.shiftId : payment.shiftId;
    const changed = await tx.payment.updateMany({
      where: { id: paymentId, confirmed: false },
      data: { confirmed: true, ...(nextShiftId ? { shiftId: nextShiftId } : {}) },
    });
    if (changed.count !== 1) {
      return { ok: false as const, error: "Ese pago ya está verificado." };
    }
    await tx.auditLog.create({
      data: {
        action: "PAYMENT_CONFIRM",
        reason: reason.trim(),
        userId: auth.user.id,
        checkId: payment.checkId,
        details: auditDetails({
          entity: "payment",
          entityId: payment.id,
          folio: payment.check.folio,
          from: { confirmed: false, method: payment.methodKey, reference: payment.reference },
          to: { confirmed: true },
        }),
      },
    });
    return { ok: true as const };
  });
}

export async function findOpenShift(db: Db, drawerKey = DRAWER_KEY) {
  return db.cashShift.findFirst({
    where: { drawerKey, status: "OPEN" },
    include: { movements: true },
    orderBy: { openedAt: "desc" },
  });
}

export async function openShiftOp(
  db: Db,
  user: SessionUser | null,
  input: { openingUsd: number; openingVes: number; drawerKey?: string },
) {
  const auth = authorize(user, "checkout");
  if (!auth.ok) return auth;
  const drawerKey = input.drawerKey || DRAWER_KEY;
  const openingUsd = Math.max(0, Math.round(input.openingUsd));
  const openingVes = Math.max(0, Math.round(input.openingVes));
  const existing = await findOpenShift(db, drawerKey);
  if (existing) {
    return { ok: false as const, error: "Ya hay un turno abierto en esta caja. Ciérralo antes de abrir otro." };
  }
  let shift;
  try {
    shift = await db.cashShift.create({
      data: {
        drawerKey,
        status: "OPEN",
        openedById: auth.user.id,
        openedByName: auth.user.name,
        openingUsd,
        openingVes,
        kind: SHIFT_KIND_MESA,
        openLock: drawerKey,
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "P2002") {
      return { ok: false as const, error: "Ya hay un turno abierto en esta caja. Ciérralo antes de abrir otro." };
    }
    return { ok: false as const, error: error instanceof Error ? error.message : "No se pudo abrir el turno." };
  }
  await appendAudit(db, {
    action: "SHIFT_OPEN",
    reason: "Apertura de turno",
    userId: auth.user.id,
    details: auditDetails({
      entity: "shift",
      entityId: shift.id,
      to: {
        openedAt: shift.openedAt.toISOString(),
        openedByName: auth.user.name,
        openingUsd,
        openingVes,
        drawerKey,
      },
    }),
  });
  return { ok: true as const, shiftId: shift.id };
}

export async function recordCashMoveOp(
  db: Db,
  user: SessionUser | null,
  input: {
    type: "IN" | "OUT" | "CORRECTION";
    currency: "USD" | "VES";
    amountCents: number;
    concept: string;
    reason: string;
    shiftId?: string;
  },
) {
  const auth = authorize(user, input.type === "CORRECTION" ? "adjust" : "checkout");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(input.reason);
  if (!motivo.ok) return motivo;
  const concept = input.concept.trim();
  if (concept.length < 2) return { ok: false as const, error: "Indica el concepto del movimiento." };
  const amountCents = Math.round(input.amountCents);
  if (amountCents <= 0) return { ok: false as const, error: "El monto debe ser mayor a cero." };
  if (input.currency !== "USD" && input.currency !== "VES") {
    return { ok: false as const, error: "Moneda no válida." };
  }

  const shift =
    input.type === "CORRECTION" && input.shiftId
      ? await db.cashShift.findUnique({ where: { id: input.shiftId } })
      : await findOpenShift(db);
  if (!shift) return { ok: false as const, error: "No hay un turno para registrar el movimiento." };
  if (input.type !== "CORRECTION" && shift.status !== "OPEN") {
    return { ok: false as const, error: "El turno está cerrado. Registra una corrección, no reescribas el cierre." };
  }
  if (input.type === "CORRECTION" && shift.status !== "CLOSED") {
    return { ok: false as const, error: "Las correcciones van sobre un cierre confirmado." };
  }

  const move = await db.cashMovement.create({
    data: {
      shiftId: shift.id,
      type: input.type,
      currency: input.currency,
      amountCents,
      concept,
      reason: motivo.reason,
      userId: auth.user.id,
      userName: auth.user.name,
    },
  });
  await appendAudit(db, {
    action: input.type === "IN" ? "SHIFT_IN" : input.type === "OUT" ? "SHIFT_OUT" : "SHIFT_CORRECTION",
    reason: motivo.reason,
    userId: auth.user.id,
    details: auditDetails({
      entity: "cashMovement",
      entityId: move.id,
      extra: { shiftId: shift.id, type: input.type, currency: input.currency, amountCents, concept },
    }),
  });
  return { ok: true as const, movementId: move.id };
}

export async function closeShiftOp(
  db: Db,
  user: SessionUser | null,
  input: {
    countedUsd: number;
    countedVes: number;
    reason?: string;
    transferToNext?: boolean;
    drawerKey?: string;
  },
) {
  const auth = authorize(user, "checkout");
  if (!auth.ok) return auth;
  const drawerKey = input.drawerKey || DRAWER_KEY;
  const shift = await findOpenShift(db, drawerKey);
  if (!shift) return { ok: false as const, error: "No hay un turno abierto." };

  const [payments, openChecks, salesPaid] = await Promise.all([
    db.payment.findMany({ where: { shiftId: shift.id } }),
    db.check.findMany({
      where: { status: { in: ["OPEN", "SENT", "PARTIAL"] } },
      select: { id: true, folio: true, status: true },
    }),
    db.payment.findMany({
      where: { shiftId: shift.id, confirmed: true },
      select: { amountUsd: true },
    }),
  ]);

  const live = summarizeShift({
    openingUsd: shift.openingUsd,
    openingVes: shift.openingVes,
    payments,
    movements: shift.movements,
  });
  const counted = {
    usd: Math.max(0, Math.round(input.countedUsd)),
    ves: Math.max(0, Math.round(input.countedVes)),
  };
  const difference = drawerDifference(live.expected, counted);
  const needsMotivo =
    hasDrawerDifference(difference) ||
    live.pending.length > 0 ||
    openChecks.length > 0 ||
    input.transferToNext === true;
  if (needsMotivo) {
    const motivo = requireMotivo(input.reason);
    if (!motivo.ok) return motivo;
  }
  if ((live.pending.length > 0 || openChecks.length > 0) && !input.transferToNext) {
    return {
      ok: false as const,
      error:
        "Hay cuentas abiertas o pagos pendientes. Resuélvelos o marca el traspaso explícito al siguiente turno.",
      openChecks,
      pending: live.pending.map((p) => ({
        id: p.id,
        methodLabel: p.methodLabel,
        reference: p.reference,
        amountCents: p.amountCents,
        currency: p.currency,
      })),
    };
  }

  const closedAt = new Date();
  const transferred = {
    pending: live.pending.map((p) => ({
      id: p.id,
      methodLabel: p.methodLabel,
      reference: p.reference,
      amountCents: p.amountCents,
      currency: p.currency,
    })),
    openChecks,
  };
  const summary: CloseSummary = {
    kind: SHIFT_KIND_MESA,
    kindLabel: SHIFT_KIND_LABEL,
    drawerKey,
    openedAt: shift.openedAt.toISOString(),
    closedAt: closedAt.toISOString(),
    openedByName: shift.openedByName,
    closedByName: auth.user.name,
    opening: live.opening,
    cashHanded: live.cashHanded,
    cashApplied: live.cashApplied,
    vuelto: live.vuelto,
    entradas: live.entradas,
    salidas: live.salidas,
    expected: live.expected,
    counted,
    difference,
    differenceLabel: differenceLabel(difference),
    otherConfirmed: live.otherConfirmed,
    pendingTransferred: transferred.pending,
    openChecksTransferred: transferred.openChecks,
    paymentIds: payments.map((p) => p.id),
    movementIds: shift.movements.map((m) => m.id),
    salesRevenueUsd: salesPaid.reduce((s, p) => s + p.amountUsd, 0),
  };

  if (input.transferToNext && live.pending.length) {
    await db.payment.updateMany({
      where: { id: { in: live.pending.map((p) => p.id) } },
      data: { shiftId: null },
    });
  }

  await db.cashShift.update({
    where: { id: shift.id },
    data: {
      status: "CLOSED",
      closedAt,
      closedById: auth.user.id,
      closedByName: auth.user.name,
      countedUsd: counted.usd,
      countedVes: counted.ves,
      expectedUsd: live.expected.usd,
      expectedVes: live.expected.ves,
      differenceUsd: difference.usd,
      differenceVes: difference.ves,
      closeReason: (input.reason ?? "").trim() || null,
      summaryJson: JSON.stringify(summary),
      transferredJson: JSON.stringify(transferred),
      openLock: null,
    },
  });
  await appendAudit(db, {
    action: "SHIFT_CLOSE",
    reason: (input.reason ?? "").trim() || "Cierre de turno sin diferencia",
    userId: auth.user.id,
    details: auditDetails({
      entity: "shift",
      entityId: shift.id,
      from: { status: "OPEN" },
      to: {
        status: "CLOSED",
        expected: live.expected,
        counted,
        difference,
        transferred: input.transferToNext === true,
        kind: SHIFT_KIND_MESA,
      },
    }),
  });
  return { ok: true as const, shiftId: shift.id, summary };
}

/** Direct rewrite of a confirmed close — always refused. Used by tests and any raw server call. */
export async function rewriteClosedShiftOp(
  db: Db,
  user: SessionUser | null,
  input: {
    shiftId: string;
    countedUsd?: number;
    countedVes?: number;
    summaryJson?: string;
  },
) {
  const auth = authorize(user, "checkout");
  if (!auth.ok) return auth;
  const shift = await db.cashShift.findUnique({ where: { id: input.shiftId } });
  if (!shift) return { ok: false as const, error: "Turno no encontrado." };
  if (shift.status === "CLOSED") {
    return { ok: false as const, error: "No se modifica un cierre confirmado." };
  }
  return { ok: false as const, error: "Usa el cierre normal. No se reescriben los datos del turno por esta vía." };
}

export async function findPaymentByOpId(db: Db, checkId: string, opId: string) {
  const normalized = normalizePaymentOpId(opId);
  if (!normalized) return null;
  const exact = await db.payment.findUnique({
    where: { checkId_clientOpId: { checkId, clientOpId: normalized } },
  });
  if (exact) return exact;

  // Compatibility for rows created before Payment.clientOpId existed. Confirm
  // the parsed key so `abc-1234` cannot accidentally match `abc-12345`.
  const legacy = await db.payment.findMany({
    where: { checkId, clientOpId: null, note: { contains: `k=${normalized}` } },
    orderBy: { createdAt: "asc" },
  });
  return legacy.find((row) => parseSettleNote(row.note).idempotencyKey === normalized) ?? null;
}

export async function lookupPaymentOp(db: Db, checkId: string, opId: string) {
  const row = await findPaymentByOpId(db, checkId, opId);
  return classifyPaymentRow(row);
}

export async function reopenCheckOp(db: Db, user: SessionUser | null, checkId: string, reason: string) {
  const auth = authorize(user, "void");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(reason);
  if (!motivo.ok) return motivo;
  const check = await db.check.findUnique({
    where: { id: checkId },
    include: { payments: true },
  });
  if (!check) return { ok: false as const, error: "Cuenta no encontrada." };
  if (!["PAID", "CLOSED"].includes(check.status)) {
    return { ok: false as const, error: "Solo se reabre una cuenta cobrada." };
  }
  const next = check.payments.length ? "PARTIAL" : "OPEN";
  await db.check.update({
    where: { id: checkId },
    data: { status: next, closedAt: null },
  });
  await appendAudit(db, {
    action: "REOPEN_CHECK",
    reason: motivo.reason,
    userId: auth.user.id,
    checkId,
    details: auditDetails({
      entity: "check",
      entityId: checkId,
      folio: check.folio,
      from: check.status,
      to: next,
    }),
  });
  return { ok: true as const };
}
