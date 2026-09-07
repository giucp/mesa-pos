import { prisma } from "@/lib/db";
import { itemOnChannel, type Channel } from "@/lib/fiscal";
import { checkTotals } from "@/lib/money";
import { isBarraZone, OPEN_CHECK_STATUSES } from "@/lib/open-checks";
export { startOfBusinessDay } from "@/lib/open-checks";

export function fohMenuItems<T extends { available: boolean; channels: string }>(
  items: T[],
  channel: Channel = "LOCAL",
) {
  return items.filter((i) => i.available && itemOnChannel(i.channels, channel));
}

export async function getRestaurant() {
  const r = await prisma.restaurant.findFirst();
  if (!r) throw new Error("Restaurante no inicializado. Ejecuta npm run db:seed");
  return r;
}

export async function getOpenCheckForTable(tableId: string) {
  return prisma.check.findFirst({
    where: { tableId, status: { in: [...OPEN_CHECK_STATUSES] } },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      payments: true,
      table: true,
      waiter: true,
    },
  });
}

export async function getCheck(id: string) {
  return prisma.check.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      table: true,
      waiter: true,
      fiscal: true,
    },
  });
}

export async function getMenu() {
  const [categories, stations] = await Promise.all([
    prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: { modifiers: true, station: true },
        },
      },
    }),
    prisma.station.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return { categories, stations };
}

export async function getKitchenWait() {
  return prisma.orderLine.count({ where: { status: "FIRED" } });
}

export async function getFloor() {
  const tables = await prisma.diningTable.findMany({
    orderBy: [{ zone: "asc" }, { number: "asc" }],
    include: {
      checks: {
        where: { status: { in: [...OPEN_CHECK_STATUSES] } },
        include: {
          lines: true,
          payments: true,
          waiter: true,
        },
      },
    },
  });
  return tables.filter((t) => !isBarraZone(t.zone));
}

export async function getAssignableStaff() {
  return prisma.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "CAJERO", "MESERO"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

export function summarizeCheck(
  check: {
    tipUsd: number;
    lines: { qty: number; priceUsd: number; modifiers: string; status: string }[];
    payments: { amountUsd: number }[];
  },
  ivaRate: number,
) {
  const totals = checkTotals(check.lines, check.tipUsd, ivaRate);
  const paidUsd = check.payments.reduce((s, p) => s + p.amountUsd, 0);
  const remainingUsd = Math.max(0, totals.totalUsd - paidUsd);
  return { ...totals, paidUsd, remainingUsd };
}

export async function nextFolio() {
  const r = await getRestaurant();
  const updated = await prisma.restaurant.update({
    where: { id: r.id },
    data: { folioSeq: { increment: 1 } },
  });
  return `A-${String(updated.folioSeq).padStart(4, "0")}`;
}

export async function nextControlAndInvoice() {
  const r = await getRestaurant();
  const updated = await prisma.restaurant.update({
    where: { id: r.id },
    data: { invoiceSeq: { increment: 1 } },
  });
  return {
    controlNumber: "",
    invoiceNumber: `MESA-${String(updated.invoiceSeq).padStart(8, "0")}`,
  };
}

export async function getOpenChecks() {
  return prisma.check.findMany({
    where: { status: { in: [...OPEN_CHECK_STATUSES] } },
    include: {
      table: true,
      waiter: true,
      lines: true,
      payments: true,
    },
    orderBy: { updatedAt: "desc" },
  });
}

