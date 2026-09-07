"use server";

import { redirect } from "next/navigation";
import { MISSING_DB_MESSAGE, asPublicDbError, isDatabaseConfigured, prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { clearSession, setSession } from "@/lib/session";
import { homePath, type Role } from "@/lib/roles";
import { safeNextPath } from "@/lib/safe-next";

export async function loginAction(formData: FormData) {
  if (!isDatabaseConfigured()) return { error: MISSING_DB_MESSAGE };
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Ingresa correo y clave." };
  }

  let user;
  try {
    user = await prisma.user.findUnique({ where: { email } });
  } catch (error) {
    return { error: asPublicDbError(error) ?? "No se pudo leer usuarios." };
  }
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    return { error: "Correo o clave incorrectos." };
  }

  await setSession({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  });

  redirect(safeNextPath(formData.get("next")) ?? homePath(user.role as Role));
}

export async function logoutAction() {
  await clearSession();
  redirect("/");
}

export async function pinLoginAction(pin: string, next?: string | null) {
  if (!isDatabaseConfigured()) return { error: MISSING_DB_MESSAGE };
  const { DEMO_PINS } = await import("@/lib/paths");
  const email = DEMO_PINS[pin.trim()];
  if (!email) return { error: "PIN incorrecto." };
  return demoLoginAction(email, next);
}

export async function demoLoginAction(email: string, next?: string | null) {
  if (!isDatabaseConfigured()) return { error: MISSING_DB_MESSAGE };
  let user;
  try {
    user = await prisma.user.findUnique({ where: { email } });
  } catch (error) {
    return { error: asPublicDbError(error) ?? "No se pudo leer usuarios." };
  }
  if (!user) return { error: "Usuario demo no encontrado. Ejecuta npm run db:seed" };
  await setSession({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  });
  redirect(safeNextPath(next) ?? homePath(user.role as Role));
}
