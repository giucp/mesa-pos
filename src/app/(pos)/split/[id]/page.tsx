import { notFound } from "next/navigation";
import { SplitDesk } from "@/components/pos/split-desk";
import { requireAction } from "@/lib/auth-guard";
import { loadCheckout } from "@/lib/checkout-props";

export default async function SplitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAction("checkout");
  const { id } = await params;
  const data = await loadCheckout(id);
  if (!data) notFound();

  return <SplitDesk rate={data.rate} check={data.check} />;
}
