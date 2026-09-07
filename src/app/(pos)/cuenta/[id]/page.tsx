import { notFound, redirect } from "next/navigation";
import { OrderEntry } from "@/components/pos/order-entry";
import { requireAction } from "@/lib/auth-guard";
import { getBcvRate } from "@/lib/bcv";
import { asChannel } from "@/lib/fiscal";
import { checkPlaceLabel, isOpenCheckStatus } from "@/lib/open-checks";
import { fohMenuItems, getCheck, getMenu, getRestaurant } from "@/lib/queries";
import { paths } from "@/lib/paths";

export default async function CuentaOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAction("order");
  const { id } = await params;
  const check = await getCheck(id);
  if (!check) notFound();
  if (!isOpenCheckStatus(check.status)) redirect(paths.pay(check.id));

  const [{ categories }, restaurant, rate] = await Promise.all([
    getMenu(),
    getRestaurant(),
    getBcvRate(),
  ]);
  const channel = asChannel(check.channel) ?? "LOCAL";

  return (
    <OrderEntry
      key={`${check.id}:${check.updatedAt.toISOString()}`}
      placeLabel={checkPlaceLabel({
        channel: check.channel,
        table: check.table ? { number: check.table.number, zone: check.table.zone } : null,
      })}
      role={user.role}
      ivaRate={restaurant.ivaRate}
      rate={rate.usdToVes}
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        items: fohMenuItems(c.items, channel).map((i) => ({
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
        })),
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
