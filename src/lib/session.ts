import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/constants";
import { decodeSession, encodeSession, TTL_MS } from "@/lib/session-token";
export { decodeSession, encodeSession } from "@/lib/session-token";
import type { SessionUser } from "@/lib/roles";

export type { SessionUser };

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.VERCEL === "1" || process.env.NODE_ENV === "production",
    maxAge: Math.floor(TTL_MS / 1000),
  };
}

export async function getSession() {
  try {
    const jar = await cookies();
    return decodeSession(jar.get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

export async function setSession(user: SessionUser) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(user), cookieOptions());
}

export async function touchSession(user: SessionUser) {
  await setSession(user);
}

export async function clearSession() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
