import { redirect } from "next/navigation";
import { paths } from "@/lib/paths";

export default async function LegacyTable({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  redirect(paths.table(tableId));
}
