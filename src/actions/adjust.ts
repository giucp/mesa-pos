"use server";

import { prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import { applyCourtesyOp, applyDiscountOp } from "@/lib/ops";
import { requireMotivo } from "@/lib/permissions";
import { writeAudit, auditDetails } from "@/lib/audit";
import { revalidatePos } from "@/lib/revalidate";

export async function applyLineDiscountAction(input: {
  lineId: string;
  discountUsd: number;
  reason: string;
}) {
  const auth = await allowAction("adjust");
  if (!auth.ok) return { error: auth.error };
  const res = await applyDiscountOp(prisma, auth.user, input);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}

export async function applyCourtesyAction(input: { lineId: string; reason: string }) {
  const auth = await allowAction("adjust");
  if (!auth.ok) return { error: auth.error };
  const res = await applyCourtesyOp(prisma, auth.user, input);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true };
}

export async function clearLineAdjustAction(lineId: string, reason: string) {
  const auth = await allowAction("adjust");
  if (!auth.ok) return { error: auth.error };
  const motivo = requireMotivo(reason);
  if (!motivo.ok) return { error: motivo.error };
  const line = await prisma.orderLine.findUnique({ where: { id: lineId } });
  if (!line) return { error: "Línea no válida." };
  await prisma.orderLine.update({
    where: { id: lineId },
    data: { courtesy: false, courtesyReason: null, discountUsd: 0 },
  });
  await writeAudit({
    action: "ADJUST_CLEAR",
    reason: motivo.reason,
    userId: auth.user.id,
    checkId: line.checkId,
    details: auditDetails({
      entity: "orderLine",
      entityId: line.id,
      itemName: line.name,
      from: { discountUsd: line.discountUsd, courtesy: line.courtesy },
      to: { discountUsd: 0, courtesy: false },
    }),
  });
  revalidatePos();
  return { ok: true };
}
