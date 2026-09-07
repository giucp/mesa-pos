import { MenuPanel } from "@/components/pos/menu-panel";
import { requireAction } from "@/lib/auth-guard";
import { getBcvRate } from "@/lib/bcv";
import { fohMenuItems, getMenu } from "@/lib/queries";

export default async function MenuBrowsePage() {
  await requireAction("order");
  const [{ categories }, rate] = await Promise.all([getMenu(), getBcvRate()]);
  return (
    <MenuPanel
      rate={rate.usdToVes}
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        items: fohMenuItems(c.items).map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          priceUsd: i.priceUsd,
          station: i.station.name,
        })),
      }))}
    />
  );
}
