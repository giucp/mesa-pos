"use server";

import { prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import { bumpTicketOp, recallTicketOp } from "@/lib/ops";
import { revalidatePos } from "@/lib/revalidate";

export async function bumpTicketAction(checkId: string, stationId: string) {
  const auth = await allowAction("kitchen");
  if (!auth.ok) return { error: auth.error };
  const res = await bumpTicketOp(prisma, auth.user, { checkId, stationId });
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}

export async function bumpLineAction(lineId: string) {
  const auth = await allowAction("kitchen");
  if (!auth.ok) return { error: auth.error };
  const line = await prisma.orderLine.findUnique({ where: { id: lineId } });
  if (!line || line.status !== "FIRED") return { error: "Esa línea no está en cocina." };
  await prisma.orderLine.update({
    where: { id: lineId },
    data: { status: "BUMPED", bumpedAt: new Date() },
  });
  revalidatePos();
  return { ok: true };
}

export async function recallTicketAction(checkId: string, stationId: string) {
  const auth = await allowAction("kitchen");
  if (!auth.ok) return { error: auth.error };
  const res = await recallTicketOp(prisma, auth.user, { checkId, stationId });
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}
