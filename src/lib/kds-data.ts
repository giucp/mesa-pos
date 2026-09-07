import { prisma } from "@/lib/db";

export async function getKdsStations() {
  return prisma.station.findMany({ orderBy: { sortOrder: "asc" } });
}

export async function getKdsLines() {
  const lines = await prisma.orderLine.findMany({
    where: { status: { in: ["FIRED", "BUMPED"] } },
    include: { check: { include: { table: true } }, item: true },
    orderBy: { sentAt: "asc" },
  });
  return lines
    .filter((l) => {
      if (l.status === "FIRED") return true;
      if (!l.bumpedAt) return false;
      return Date.now() - l.bumpedAt.getTime() < 1000 * 60 * 45;
    })
    .map((l) => ({
      id: l.id,
      checkId: l.checkId,
      name: l.name,
      qty: l.qty,
      notes: l.notes,
      modifiers: l.modifiers,
      status: l.status,
      sentAt: l.sentAt?.toISOString() ?? null,
      stationId: l.stationId,
      eightySixed: l.item ? !l.item.available : false,
      check: {
        folio: l.check.folio,
        channel: l.check.channel,
        table: l.check.table ? { number: l.check.table.number, zone: l.check.table.zone } : null,
      },
    }));
}
