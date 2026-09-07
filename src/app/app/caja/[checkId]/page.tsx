import { redirect } from "next/navigation";
import { paths } from "@/lib/paths";

export default async function LegacyPay({ params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = await params;
  redirect(paths.pay(checkId));
}
