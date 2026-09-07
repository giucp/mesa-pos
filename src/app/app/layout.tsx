import { AppShell } from "@/components/pos/app-shell";
import { getBcvRate } from "@/lib/bcv";
import { getRestaurant } from "@/lib/queries";
import { requireUser } from "@/lib/auth-guard";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await requireUser();
  const [restaurant, rate] = await Promise.all([getRestaurant(), getBcvRate()]);

  return (
    <AppShell
      user={{ name: user.name, role: user.role }}
      restaurantName={restaurant.name}
      rate={rate.usdToVes}
      rateSource={rate.source}
      rateAt={rate.fetchedAt.toISOString()}
    >
      {children}
    </AppShell>
  );
}
