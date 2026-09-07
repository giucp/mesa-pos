import { notFound, redirect } from "next/navigation";
import { OrderEntry } from "@/components/pos/order-entry";
import { requireAction } from "@/lib/auth-guard";
import { getBcvRate } from "@/lib/bcv";
import { asChannel } from "@/lib/fiscal";
import { fohMenuItems, getMenu, getOpenCheckForTable, getRestaurant } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { openOrGetCheck } from "@/lib/open-table";
import { paths } from "@/lib/paths";

export default async function TablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAction("order");
  const { id } = await params;
  const table = await prisma.diningTable.findUnique({ where: { id } });
  if (!table) notFound();

  await openOrGetCheck(id, user.id, 2);
  const check = await getOpenCheckForTable(id);
  if (!check) redirect(paths.floor);

  const [{ categories }, restaurant, rate] = await Promise.all([
    getMenu(),
    getRestaurant(),
    getBcvRate(),
  ]);

  return (
    <OrderEntry
      placeLabel={`Mesa ${table.number}`}
      role={user.role}
      ivaRate={restaurant.ivaRate}
      rate={rate.usdToVes}
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        items: fohMenuItems(c.items, asChannel(check.channel) ?? "LOCAL").map(
          (i) => ({
            id: i.id,
            name: i.name,
            description: i.description,
            priceUsd: i.priceUsd,
            available: i.available,
            stockControlled: i.stockControlled,
            stockQty: i.stockQty,
            stockUnit: i.stockUnit,
            stockMinAlert: i.stockMinAlert,
            station: { name: i.station.name },
            modifiers: i.modifiers,
          }),
        ),
      }))}
      check={{
        id: check.id,
        folio: check.folio,
        guestCount: check.guestCount,
        notes: check.notes,
        tipUsd: check.tipUsd,
        status: check.status,
        updatedAt: check.updatedAt.toISOString(),
        lines: check.lines.map((l) => ({
          id: l.id,
          name: l.name,
          qty: l.qty,
          priceUsd: l.priceUsd,
          notes: l.notes,
          modifiers: l.modifiers,
          status: l.status,
        })),
      }}
    />
  );
}
