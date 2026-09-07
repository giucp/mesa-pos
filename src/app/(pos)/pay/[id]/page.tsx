import { notFound } from "next/navigation";
import { CheckoutDesk } from "@/components/pos/checkout-desk";
import { requireAction } from "@/lib/auth-guard";
import { loadCheckout } from "@/lib/checkout-props";
import { can } from "@/lib/roles";

export default async function PayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAction("checkout");
  const { id } = await params;
  const data = await loadCheckout(id);
  if (!data) notFound();

  return (
    <CheckoutDesk
      rate={data.rate}
      rateSource={data.check.bcvSource || data.rateSource}
      rateAt={data.check.bcvFetchedAt || data.rateAt}
      canAdjust={can(user.role, "adjust")}
      restaurant={data.restaurant}
      methods={data.methods}
      check={data.check}
    />
  );
}
