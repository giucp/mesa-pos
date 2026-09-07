import { redirect } from "next/navigation";
import { paths } from "@/lib/paths";

export default function LegacySettings() {
  redirect(paths.settings);
}
