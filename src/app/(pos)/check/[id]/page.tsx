import { notFound } from "next/navigation";
import { CheckView } from "@/components/pos/check-view";
import { requireAction } from "@/lib/auth-guard";
import { loadCheckout } from "@/lib/checkout-props";
import { can } from "@/lib/roles";

export default async function CheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAction("order");
  const { id } = await params;
  const data = await loadCheckout(id);
  if (!data) notFound();

  return (
    <CheckView
      rate={data.rate}
      canPay={can(user.role, "checkout")}
      restaurant={data.restaurant}
      check={data.check}
    />
  );
}
