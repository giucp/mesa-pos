import type { Prisma, PrismaClient } from "@prisma/client";
import { authorize, requireMotivo } from "@/lib/permissions";
import { auditDetails } from "@/lib/audit-shape";
import type { SessionUser } from "@/lib/roles";

export const STOCK_MOVE = {
  ENTRADA: "ENTRADA",
  AJUSTE: "AJUSTE",
  MERMA: "MERMA",
  RESERVE: "RESERVE",
  RELEASE: "RELEASE",
} as const;

export type StockMoveType = (typeof STOCK_MOVE)[keyof typeof STOCK_MOVE];

export const MANUAL_STOCK_TYPES = [STOCK_MOVE.ENTRADA, STOCK_MOVE.AJUSTE, STOCK_MOVE.MERMA] as const;

type Db = PrismaClient | Prisma.TransactionClient;

export type StockBadge = {
  kind: "open" | "ok" | "low" | "out" | "eighty6";
  label: string | null;
  sellable: boolean;
};

export function stockBadge(item: {
  available: boolean;
  stockControlled?: boolean | null;
  stockQty?: number | null;
  stockMinAlert?: number | null;
  stockUnit?: string | null;
}): StockBadge {
  if (!item.available) {
    return { kind: "eighty6", label: "Agotado (86)", sellable: false };
  }
  if (!item.stockControlled) {
    return { kind: "open", label: null, sellable: true };
  }
  const qty = item.stockQty ?? 0;
  const unit = item.stockUnit || "un";
  const min = item.stockMinAlert ?? 0;
  if (qty <= 0) {
    return { kind: "out", label: "Sin existencias", sellable: false };
  }
  if (min > 0 && qty <= min) {
    return { kind: "low", label: `Quedan ${qty} ${unit}`, sellable: true };
  }
  return { kind: "ok", label: `${qty} ${unit}`, sellable: true };
}

export function stockOfflineBlock() {
  return "Sin existencias confirmadas. El servidor tiene que verificar el inventario; no se promete stock sin conexión.";
}

export function lineIsPrepared(status: string, committed: boolean) {
  return committed || status === "FIRED" || status === "BUMPED";
}

async function writeMove(
  db: Db,
  input: {
    itemId: string;
    type: StockMoveType;
    qty: number;
    unit: string;
    motivo: string;
    userId?: string | null;
    userName?: string | null;
    checkId?: string | null;
    lineId?: string | null;
    clientOpId?: string | null;
  },
) {
  if (input.clientOpId) {
    const existing = await db.stockMovement.findUnique({ where: { clientOpId: input.clientOpId } });
    if (existing) return existing;
  }
  return db.stockMovement.create({
    data: {
      itemId: input.itemId,
      type: input.type,
      qty: input.qty,
      unit: input.unit,
      motivo: input.motivo,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      checkId: input.checkId ?? null,
      lineId: input.lineId ?? null,
      clientOpId: input.clientOpId ?? null,
    },
  });
}

/** Reserve sellable qty at add-to-check. Atomic: two sessions cannot take the last unit. */
export async function reserveStock(
  db: Db,
  input: {
    item: { id: string; name: string; stockControlled: boolean; stockQty: number; stockUnit: string };
    qty: number;
    user: SessionUser;
    checkId: string;
    lineId?: string | null;
    clientOpId?: string | null;
  },
) {
  if (!input.item.stockControlled) return { ok: true as const, reserved: 0 };
  const qty = Math.max(1, Math.round(input.qty));
  const opId = input.clientOpId ? `reserve:${input.clientOpId}` : null;
  if (opId) {
    const replay = await db.stockMovement.findUnique({ where: { clientOpId: opId } });
    if (replay) return { ok: true as const, reserved: qty, duplicate: true as const };
  }
  const dec = await db.item.updateMany({
    where: { id: input.item.id, stockControlled: true, stockQty: { gte: qty } },
    data: { stockQty: { decrement: qty } },
  });
  if (dec.count !== 1) {
    return {
      ok: false as const,
      error: `No hay existencias suficientes de ${input.item.name}. El servidor no reservó.`,
    };
  }
  await writeMove(db, {
    itemId: input.item.id,
    type: STOCK_MOVE.RESERVE,
    qty: -qty,
    unit: input.item.stockUnit || "un",
    motivo: "Reserva al agregar a la cuenta",
    userId: input.user.id,
    userName: input.user.name,
    checkId: input.checkId,
    lineId: input.lineId,
    clientOpId: opId,
  });
  return { ok: true as const, reserved: qty };
}

/** Return reserved qty only when the plate was not yet prepared. */
export async function releaseStock(
  db: Db,
  input: {
    itemId: string | null;
    qty: number;
    unit?: string;
    user: SessionUser;
    checkId?: string | null;
    lineId?: string | null;
    clientOpId?: string | null;
    motivo: string;
  },
) {
  const qty = Math.max(0, Math.round(input.qty));
  if (!input.itemId || qty <= 0) return { ok: true as const, released: 0 };
  const item = await db.item.findUnique({ where: { id: input.itemId } });
  if (!item?.stockControlled) return { ok: true as const, released: 0 };
  await db.item.update({
    where: { id: item.id },
    data: { stockQty: { increment: qty } },
  });
  await writeMove(db, {
    itemId: item.id,
    type: STOCK_MOVE.RELEASE,
    qty,
    unit: input.unit || item.stockUnit || "un",
    motivo: input.motivo,
    userId: input.user.id,
    userName: input.user.name,
    checkId: input.checkId,
    lineId: input.lineId,
    clientOpId: input.clientOpId,
  });
  return { ok: true as const, released: qty };
}

export async function commitReservedLines(
  db: Db,
  input: { lineIds: string[] },
) {
  if (!input.lineIds.length) return;
  await db.orderLine.updateMany({
    where: { id: { in: input.lineIds }, stockReserved: { gt: 0 }, stockCommitted: false },
    data: { stockCommitted: true },
  });
}

export async function recordManualStockOp(
  db: PrismaClient,
  user: SessionUser | null,
  input: {
    itemId: string;
    type: (typeof MANUAL_STOCK_TYPES)[number];
    qty: number;
    motivo: string;
    clientOpId?: string | null;
  },
) {
  const auth = authorize(user, "menu");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(input.motivo);
  if (!motivo.ok) return motivo;
  const qty = Math.round(input.qty);
  if (!Number.isFinite(qty) || qty === 0) {
    return { ok: false as const, error: "La cantidad no puede ser cero." };
  }
  if (input.type !== STOCK_MOVE.AJUSTE && qty < 0) {
    return { ok: false as const, error: "Usa un número positivo. La merma resta sola." };
  }

  return db.$transaction(async (tx) => {
    if (input.clientOpId) {
      const replay = await tx.stockMovement.findUnique({ where: { clientOpId: input.clientOpId } });
      if (replay) {
        const current = await tx.item.findUnique({ where: { id: input.itemId } });
        return { ok: true as const, stockQty: current?.stockQty ?? 0, duplicate: true as const };
      }
    }
    const item = await tx.item.findUnique({ where: { id: input.itemId } });
    if (!item) return { ok: false as const, error: "Ese plato ya no existe." };
    if (!item.stockControlled) {
      return { ok: false as const, error: "Activa el control de existencias de este plato primero." };
    }
    const signed =
      input.type === STOCK_MOVE.ENTRADA ? Math.abs(qty) : input.type === STOCK_MOVE.MERMA ? -Math.abs(qty) : qty;
    if (signed < 0 && item.stockQty + signed < 0) {
      return { ok: false as const, error: `No hay ${item.stockQty} ${item.stockUnit} para restar.` };
    }
    const next = item.stockQty + signed;
    await tx.item.update({ where: { id: item.id }, data: { stockQty: next } });
    await writeMove(tx, {
      itemId: item.id,
      type: input.type,
      qty: signed,
      unit: item.stockUnit || "un",
      motivo: motivo.reason,
      userId: auth.user.id,
      userName: auth.user.name,
      clientOpId: input.clientOpId ?? null,
    });
    await tx.auditLog.create({
      data: {
        action: `STOCK_${input.type}`,
        reason: motivo.reason,
        userId: auth.user.id,
        details: auditDetails({
          entity: "item",
          entityId: item.id,
          itemName: item.name,
          from: { stockQty: item.stockQty },
          to: { stockQty: next },
          extra: { type: input.type, qty: signed, unit: item.stockUnit },
        }),
      },
    });
    return { ok: true as const, stockQty: next };
  });
}

export async function setItemStockControlOp(
  db: PrismaClient,
  user: SessionUser | null,
  input: {
    itemId: string;
    stockControlled: boolean;
    stockQty?: number;
    stockUnit?: string;
    stockMinAlert?: number;
    motivo: string;
  },
) {
  const auth = authorize(user, "menu");
  if (!auth.ok) return auth;
  const motivo = requireMotivo(input.motivo);
  if (!motivo.ok) return motivo;
  const item = await db.item.findUnique({ where: { id: input.itemId } });
  if (!item) return { ok: false as const, error: "Ese plato ya no existe." };
  const stockQty = Math.max(0, Math.round(input.stockQty ?? item.stockQty));
  const stockMinAlert = Math.max(0, Math.round(input.stockMinAlert ?? item.stockMinAlert));
  const stockUnit = (input.stockUnit ?? item.stockUnit ?? "un").trim().slice(0, 12) || "un";
  await db.item.update({
    where: { id: item.id },
    data: {
      stockControlled: input.stockControlled,
      stockQty: input.stockControlled ? stockQty : item.stockQty,
      stockUnit,
      stockMinAlert,
    },
  });
  await db.auditLog.create({
    data: {
      action: "STOCK_CONTROL",
      reason: motivo.reason,
      userId: auth.user.id,
      details: auditDetails({
        entity: "item",
        entityId: item.id,
        itemName: item.name,
        from: {
          stockControlled: item.stockControlled,
          stockQty: item.stockQty,
          stockUnit: item.stockUnit,
          stockMinAlert: item.stockMinAlert,
        },
        to: {
          stockControlled: input.stockControlled,
          stockQty: input.stockControlled ? stockQty : item.stockQty,
          stockUnit,
          stockMinAlert,
        },
      }),
    },
  });
  return { ok: true as const };
}
