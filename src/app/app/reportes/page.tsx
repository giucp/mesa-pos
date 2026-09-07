import { redirect } from "next/navigation";
import { paths } from "@/lib/paths";

export default function LegacyReports() {
  redirect(paths.reportsDay);
}
