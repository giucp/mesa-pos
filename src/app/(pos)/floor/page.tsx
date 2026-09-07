import { FloorPlan } from "@/components/pos/floor-plan";
import { PollRefresh } from "@/components/pos/poll-refresh";
import { requireAction } from "@/lib/auth-guard";
import { getBcvRate } from "@/lib/bcv";
import { listOpenChecks, salonOpenChecks } from "@/lib/open-checks";
import { getFloor, getKitchenWait, getOpenChecks, getRestaurant } from "@/lib/queries";
import { can } from "@/lib/roles";

export default async function FloorPage() {
  const user = await requireAction("salon");
  const [tables, restaurant, rate, kitchenWait, rawOpen] = await Promise.all([
    getFloor(),
    getRestaurant(),
    getBcvRate(),
    getKitchenWait(),
    getOpenChecks(),
  ]);
  const allOpen = listOpenChecks(rawOpen, restaurant.ivaRate);
  const salonChecks = salonOpenChecks(allOpen);

  return (
    <>
      <PollRefresh seconds={6} />
      <FloorPlan
        canCheckout={can(user.role, "checkout")}
        kitchenWait={kitchenWait}
        openChecks={salonChecks}
        cajaOpenCount={allOpen.length}
        tables={tables.map((t) => ({
          id: t.id,
          number: t.number,
          seats: t.seats,
          zone: t.zone,
          status: t.status,
          checks: t.checks.map((c) => ({
            id: c.id,
            folio: c.folio,
            status: c.status,
            guestCount: c.guestCount,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
            sentAt: c.sentAt?.toISOString() ?? null,
            waiter: c.waiter ? { name: c.waiter.name } : null,
            tipUsd: c.tipUsd,
            lines: c.lines.map((l) => ({
              qty: l.qty,
              priceUsd: l.priceUsd,
              modifiers: l.modifiers,
              status: l.status,
              createdAt: l.createdAt.toISOString(),
              sentAt: l.sentAt?.toISOString() ?? null,
            })),
            payments: c.payments.map((p) => ({
              amountUsd: p.amountUsd,
              createdAt: p.createdAt.toISOString(),
            })),
          })),
        }))}
        ivaRate={restaurant.ivaRate}
        rate={rate.usdToVes}
      />
    </>
  );
}
