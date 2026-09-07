import { MenuBoard } from "@/components/pos/menu-board";
import { requireAction } from "@/lib/auth-guard";
import { getBcvRate } from "@/lib/bcv";
import { getMenu } from "@/lib/queries";

export default async function MenuAdminPage() {
  await requireAction("menu");
  const [{ categories, stations }, rate] = await Promise.all([getMenu(), getBcvRate()]);
  return (
    <MenuBoard
      rate={rate.usdToVes}
      stations={stations.map((s) => ({ id: s.id, name: s.name }))}
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        items: c.items.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          priceUsd: i.priceUsd,
          available: i.available,
          stockControlled: i.stockControlled,
          stockQty: i.stockQty,
          stockUnit: i.stockUnit,
          stockMinAlert: i.stockMinAlert,
          taxCode: i.taxCode,
          ivaRate: i.ivaRate,
          channels: i.channels,
          categoryId: i.categoryId,
          station: { id: i.station.id, name: i.station.name },
        })),
      }))}
    />
  );
}
