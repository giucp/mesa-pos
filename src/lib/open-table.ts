import { prisma } from "@/lib/db";
import { nextFolio } from "@/lib/queries";
import { getBcvRate } from "@/lib/bcv";
import { normalizeRateSource } from "@/lib/bcv-label";
import type { Channel } from "@/lib/fiscal";

export async function openOrGetCheck(tableId: string, waiterId: string, guestCount = 2) {
  const existing = await prisma.check.findFirst({
    where: { tableId, status: { in: ["OPEN", "SENT", "PARTIAL"] } },
  });
  if (existing) return existing;
  return createCheck({ tableId, waiterId, guestCount, channel: "LOCAL" });
}

export async function createCheck(input: {
  tableId?: string | null;
  waiterId: string;
  guestCount?: number;
  channel: Channel;
}) {
  const [folio, rate] = await Promise.all([nextFolio(), getBcvRate()]);
  const check = await prisma.check.create({
    data: {
      folio,
      tableId: input.tableId ?? null,
      guestCount: Math.max(1, input.guestCount ?? 1),
      waiterId: input.waiterId,
      status: "OPEN",
      channel: input.channel,
      bcvRateUsed: rate.usdToVes,
      bcvSource: normalizeRateSource(rate.source),
      bcvFetchedAt: rate.fetchedAt,
    },
  });
  if (input.tableId) {
    await prisma.diningTable.update({
      where: { id: input.tableId },
      data: { status: "OCCUPIED" },
    });
  }
  return check;
}
