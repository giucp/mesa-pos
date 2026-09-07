import { requireAction } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { ShiftDesk, type ShiftDeskClosed } from "@/components/pos/shift-desk";
import { DRAWER_KEY, differenceLabel, summarizeShift, type CloseSummary } from "@/lib/shift";

export const dynamic = "force-dynamic";

function parseSummary(raw: string | null): CloseSummary | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CloseSummary;
  } catch {
    return null;
  }
}

export default async function TurnoPage() {
  await requireAction("checkout");
  const [openRow, closedRows, openChecks] = await Promise.all([
    prisma.cashShift.findFirst({
      where: { drawerKey: DRAWER_KEY, status: "OPEN" },
      include: { movements: { orderBy: { createdAt: "asc" } } },
      orderBy: { openedAt: "desc" },
    }),
    prisma.cashShift.findMany({
      where: { drawerKey: DRAWER_KEY, status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 20,
    }),
    prisma.check.findMany({
      where: { status: { in: ["OPEN", "SENT", "PARTIAL"] } },
      select: { id: true, folio: true, status: true },
      orderBy: { folio: "asc" },
    }),
  ]);

  let open = null;
  if (openRow) {
    const pays = await prisma.payment.findMany({ where: { shiftId: openRow.id } });
    const live = summarizeShift({
      openingUsd: openRow.openingUsd,
      openingVes: openRow.openingVes,
      payments: pays,
      movements: openRow.movements,
    });
    open = {
      id: openRow.id,
      openedAt: openRow.openedAt.toISOString(),
      openedByName: openRow.openedByName,
      openingUsd: openRow.openingUsd,
      openingVes: openRow.openingVes,
      expected: live.expected,
      cashHanded: live.cashHanded,
      vuelto: live.vuelto,
      entradas: live.entradas,
      salidas: live.salidas,
      otherConfirmed: live.otherConfirmed,
      pending: live.pending,
      movements: openRow.movements.map((m) => ({
        id: m.id,
        type: m.type,
        currency: m.currency,
        amountCents: m.amountCents,
        concept: m.concept,
        userName: m.userName,
      })),
    };
  }

  const closed: ShiftDeskClosed[] = closedRows.map((row) => {
    const summary = parseSummary(row.summaryJson);
    return {
      id: row.id,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      openedByName: row.openedByName,
      closedByName: row.closedByName,
      summary,
      differenceLabel: summary
        ? summary.differenceLabel
        : differenceLabel({ usd: row.differenceUsd ?? 0, ves: row.differenceVes ?? 0 }),
    };
  });

  return <ShiftDesk open={open} closed={closed} openChecks={openChecks} />;
}
