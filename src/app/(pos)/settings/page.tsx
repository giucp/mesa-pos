import { SettingsForm } from "@/components/pos/settings-form";
import { requireAction } from "@/lib/auth-guard";
import { getRestaurant } from "@/lib/queries";
import { prisma } from "@/lib/db";

export default async function SettingsPage() {
  await requireAction("settings");
  const [restaurant, methods] = await Promise.all([
    getRestaurant(),
    prisma.paymentMethod.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <SettingsForm
      restaurant={{
        name: restaurant.name,
        rif: restaurant.rif,
        address: restaurant.address,
        phone: restaurant.phone,
        ivaRate: restaurant.ivaRate,
        igtfBancarizadoRate: restaurant.igtfBancarizadoRate,
        igtfForexRate: restaurant.igtfForexRate,
        tipInTaxableBase: restaurant.tipInTaxableBase,
        bcvRate: restaurant.bcvRate,
        bcvSource: restaurant.bcvSource,
        bcvUpdatedAt: restaurant.bcvUpdatedAt.toISOString(),
        fiscalAdapterMf: restaurant.fiscalAdapterMf,
        fiscalAdapterDigital: restaurant.fiscalAdapterDigital,
      }}
      methods={methods}
    />
  );
}
