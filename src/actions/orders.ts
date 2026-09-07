"use server";

import { prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import { addItemOp, changeQtyOp, removeLineOp, sendToKitchenOp, voidCheckOp } from "@/lib/ops";
import { revalidatePos } from "@/lib/revalidate";

export async function addItemAction(
  checkId: string,
  itemId: string,
  modifierIds: string[] = [],
  notes = "",
  opts?: {
    qty?: number;
    clientOpId?: string;
    knownLineIds?: string[];
    baseUpdatedAt?: string;
  },
) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const res = await addItemOp(prisma, auth.user, {
    checkId,
    itemId,
    modifierIds,
    notes,
    qty: opts?.qty,
    clientOpId: opts?.clientOpId,
    knownLineIds: opts?.knownLineIds,
    baseUpdatedAt: opts?.baseUpdatedAt,
  });
  if (!res.ok) {
    if ("conflict" in res && res.conflict) {
      return { error: res.error, conflict: true as const, server: res.server };
    }
    return { error: res.error };
  }
  revalidatePos();
  return { ok: true as const, lineId: res.lineId, updatedAt: "updatedAt" in res ? res.updatedAt : undefined, duplicate: "duplicate" in res ? res.duplicate : undefined };
}

export async function changeQtyAction(lineId: string, delta: number) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const res = await changeQtyOp(prisma, auth.user, lineId, delta);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}

export async function updateLineNotesAction(lineId: string, notes: string) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  await prisma.orderLine.update({
    where: { id: lineId },
    data: { notes: notes.trim() || null },
  });
  revalidatePos();
}

export async function removeLineAction(lineId: string) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const res = await removeLineOp(prisma, auth.user, lineId);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}

export async function sendToKitchenAction(checkId: string) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const res = await sendToKitchenOp(prisma, auth.user, checkId);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true, count: res.count };
}

export async function voidCheckAction(checkId: string, reason: string) {
  const auth = await allowAction("void");
  if (!auth.ok) return { error: auth.error };
  const res = await voidCheckOp(prisma, auth.user, checkId, reason);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}

export async function setCheckNotesAction(checkId: string, notes: string) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  await prisma.check.update({
    where: { id: checkId },
    data: { notes: notes.trim() || null },
  });
}
