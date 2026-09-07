"use server";

import { asPublicDbError, prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import { revalidatePos } from "@/lib/revalidate";
import { MANUAL_STOCK_TYPES, recordManualStockOp, setItemStockControlOp } from "@/lib/stock";

export async function setItemStockControlAction(input: {
  itemId: string;
  stockControlled: boolean;
  stockQty?: number;
  stockUnit?: string;
  stockMinAlert?: number;
  motivo: string;
}) {
  const auth = await allowAction("menu");
  if (!auth.ok) return { error: auth.error };
  try {
    const res = await setItemStockControlOp(prisma, auth.user, input);
    if (!res.ok) return { error: res.error };
    revalidatePos();
    return { ok: true as const };
  } catch (error) {
    return { error: asPublicDbError(error) ?? "No se pudo guardar el control de existencias." };
  }
}

export async function recordStockMoveAction(input: {
  itemId: string;
  type: (typeof MANUAL_STOCK_TYPES)[number];
  qty: number;
  motivo: string;
}) {
  const auth = await allowAction("menu");
  if (!auth.ok) return { error: auth.error };
  try {
    const res = await recordManualStockOp(prisma, auth.user, input);
    if (!res.ok) return { error: res.error };
    revalidatePos();
    return { ok: true as const, stockQty: res.stockQty };
  } catch (error) {
    return { error: asPublicDbError(error) ?? "No se pudo registrar el movimiento." };
  }
}
