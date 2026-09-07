import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { can, type Action, type Role, type SessionUser } from "@/lib/roles";
import { authorize } from "@/lib/permissions";
import { safeNextPath } from "@/lib/safe-next";

export async function liveUser(session: SessionUser | null): Promise<SessionUser | null> {
  if (!session) return null;
  const dbUser = await prisma.user.findFirst({
    where: { id: session.id, active: true },
  });
  if (!dbUser) return null;
  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role as Role,
  };
}

async function currentPath() {
  const h = await headers();
  return safeNextPath(h.get("x-mesa-path")) ?? "/floor";
}

export async function requireUser() {
  const user = await liveUser(await getSession());
  if (!user) {
    const next = await currentPath();
    redirect(`/?aviso=sesion&next=${encodeURIComponent(next)}`);
  }
  return user;
}

export async function requireAction(action: Action) {
  const user = await requireUser();
  if (!can(user.role, action)) redirect("/sin-acceso");
  return user;
}

/** For mutating server actions: reject with an error instead of redirecting. */
export async function allowAction(action: Action) {
  return authorize(await liveUser(await getSession()), action);
}
