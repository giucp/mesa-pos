import { revalidatePath } from "next/cache";

const PATHS = [
  "/floor",
  "/table",
  "/menu",
  "/menu/admin",
  "/check",
  "/pay",
  "/split",
  "/kds",
  "/reports/day",
  "/turno",
  "/staff",
  "/auditoria",
  "/inventario",
  "/settings",
  "/app",
];

export function revalidatePos() {
  for (const path of PATHS) revalidatePath(path);
}
