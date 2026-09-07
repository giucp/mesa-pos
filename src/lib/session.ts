import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/constants";
import { runtimeSessionSecret } from "@/lib/runtime-dsn";
import type { SessionUser } from "@/lib/roles";

export type { SessionUser };

const TTL_MS = 1000 * 60 * 60 * 14;

type Payload = SessionUser & { exp: number };

function secret() {
  return (
    runtimeSessionSecret ||
    process.env.SESSION_SECRET ||
    "mesa-dev-session-change-in-production"
  );
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(body).digest("hex");
}

export function encodeSession(user: SessionUser) {
  const payload: Payload = { ...user, exp: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (payload.exp < Date.now()) return null;
    return {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

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
