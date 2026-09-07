"use server";

import { asPublicDbError, prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import { asChannel } from "@/lib/fiscal";
import { nextFolio } from "@/lib/queries";
import { OPEN_CHECK_STATUSES } from "@/lib/open-checks";
import { openOrGetCheck } from "@/lib/open-table";
import { revalidatePos } from "@/lib/revalidate";
import { writeAudit } from "@/lib/audit";

export async function openChannelCheckAction(channel: "BARRA" | "TAKEAWAY") {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const parsed = asChannel(channel);
  if (!parsed || (parsed !== "BARRA" && parsed !== "TAKEAWAY")) {
    return { error: "Ese canal no se abre en esta fase." };
  }
  const { createCheck } = await import("@/lib/open-table");
  const check = await createCheck({ waiterId: user.id, guestCount: 1, channel: parsed });
  revalidatePos();
  return { checkId: check.id };
}

export async function reassignCheckAction(checkId: string, waiterId: string) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  const [check, waiter] = await Promise.all([
    prisma.check.findUnique({ where: { id: checkId } }),
    prisma.user.findUnique({ where: { id: waiterId } }),
  ]);
  if (!check) return { error: "Cuenta no encontrada." };
  if (!(OPEN_CHECK_STATUSES as readonly string[]).includes(check.status)) {
    return { error: "Solo se reasignan cuentas abiertas." };
  }
  if (!waiter || !waiter.active) return { error: "El responsable no está activo." };
  if (!["ADMIN", "CAJERO", "MESERO"].includes(waiter.role)) {
    return { error: "Ese usuario no toma cuentas." };
  }
  await prisma.check.update({
    where: { id: checkId },
    data: { waiterId: waiter.id },
  });
  await writeAudit({
    action: "REASSIGN_CHECK",
    reason: `Reasignada a ${waiter.name}`,
    userId: user.id,
    checkId,
    details: JSON.stringify({ from: check.waiterId, to: waiter.id }),
  });
  revalidatePos();
  return { ok: true };
}

export async function openTableAction(tableId: string, guestCount = 2) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  try {
    const table = await prisma.diningTable.findUnique({ where: { id: tableId } });
    if (!table) return { error: "Mesa no existe." };

    const check = await openOrGetCheck(tableId, user.id, guestCount);
    revalidatePos();
    return { checkId: check.id };
  } catch (error) {
    return { error: asPublicDbError(error) ?? "No se pudo abrir la mesa." };
  }
}

export async function reserveTableAction(tableId: string, reserved: boolean) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const busy = await prisma.check.findFirst({
    where: { tableId, status: { in: [...OPEN_CHECK_STATUSES] } },
  });
  if (busy) return { error: "No se reserva una mesa con cuenta." };
  await prisma.diningTable.update({
    where: { id: tableId },
    data: { status: reserved ? "RESERVED" : "FREE" },
  });
  revalidatePos();
  return { ok: true };
}

export async function updateGuestsAction(checkId: string, guestCount: number) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  await prisma.check.update({
    where: { id: checkId },
    data: { guestCount: Math.max(1, guestCount) },
  });
  revalidatePos();
}

export async function moveCheckAction(checkId: string, toTableId: string) {
  const auth = await allowAction("order");
  if (!auth.ok) return { error: auth.error };
  const check = await prisma.check.findUnique({ where: { id: checkId } });
  if (!check || !check.tableId) return { error: "Cuenta no válida." };
  if (!(OPEN_CHECK_STATUSES as readonly string[]).includes(check.status)) {
    return { error: "Solo se mueven cuentas abiertas." };
  }

  const destBusy = await prisma.check.findFirst({
    where: { tableId: toTableId, status: { in: [...OPEN_CHECK_STATUSES] } },
  });
  if (destBusy) return { error: "La mesa destino ya tiene cuenta abierta." };

  const fromId = check.tableId;
  await prisma.$transaction([
    prisma.check.update({ where: { id: checkId }, data: { tableId: toTableId } }),
    prisma.diningTable.update({ where: { id: fromId }, data: { status: "FREE" } }),
    prisma.diningTable.update({ where: { id: toTableId }, data: { status: "OCCUPIED" } }),
  ]);
  revalidatePos();
  return { ok: true };
}

export async function mergeChecksAction(fromCheckId: string, toCheckId: string) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  if (fromCheckId === toCheckId) return { error: "Elige otra cuenta." };
  const [from, to] = await Promise.all([
    prisma.check.findUnique({ where: { id: fromCheckId }, include: { lines: true, payments: true } }),
    prisma.check.findUnique({ where: { id: toCheckId } }),
  ]);
  if (!from || !to) return { error: "Cuentas no encontradas." };
  if (from.payments.length) return { error: "No se une una cuenta con pagos." };

  await prisma.$transaction([
    prisma.orderLine.updateMany({ where: { checkId: from.id }, data: { checkId: to.id } }),
    prisma.check.update({
      where: { id: from.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: "Unida a " + to.folio },
    }),
    ...(from.tableId
      ? [prisma.diningTable.update({ where: { id: from.tableId }, data: { status: "FREE" } })]
      : []),
  ]);
  revalidatePos();
  return { ok: true };
}

export async function splitItemsAction(checkId: string, lineIds: string[]) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  const user = auth.user;
  if (!lineIds.length) return { error: "Selecciona ítems." };
  const check = await prisma.check.findUnique({
    where: { id: checkId },
    include: { lines: true },
  });
  if (!check) return { error: "Cuenta no encontrada." };

  const moving = check.lines.filter((l) => lineIds.includes(l.id) && l.status !== "VOID");
  if (!moving.length) return { error: "Nada para separar." };
  if (moving.length === check.lines.filter((l) => l.status !== "VOID").length) {
    return { error: "Deja al menos un ítem en la cuenta original." };
  }

  const folio = await nextFolio();
  const created = await prisma.check.create({
    data: {
      folio,
      tableId: check.tableId,
      guestCount: 1,
      waiterId: user.id,
      status: check.status === "OPEN" ? "OPEN" : "SENT",
      channel: check.channel,
      bcvRateUsed: check.bcvRateUsed,
    },
  });
  await prisma.orderLine.updateMany({
    where: { id: { in: moving.map((l) => l.id) } },
    data: { checkId: created.id },
  });
  revalidatePos();
  return { checkId: created.id };
}
