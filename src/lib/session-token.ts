import { createHmac, timingSafeEqual } from "node:crypto";
import { runtimeSessionSecret } from "@/lib/runtime-dsn";
import { ROLES, type SessionUser } from "@/lib/roles";

export const TTL_MS = 1000 * 60 * 60 * 14;

type Payload = SessionUser & { exp: number };

function secret() {
  const configured = process.env.SESSION_SECRET || runtimeSessionSecret;
  if (configured && configured.length >= 32 && ![
    "mesa-dev-session-change-in-production",
    "cambia-esta-clave-en-produccion",
  ].includes(configured)) return configured;
  throw new Error("Configura SESSION_SECRET con al menos 32 caracteres aleatorios.");
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
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (!payload || typeof payload !== "object" ||
      !Number.isFinite(payload.exp) || payload.exp <= Date.now() ||
      typeof payload.id !== "string" || !payload.id ||
      typeof payload.email !== "string" || !payload.email ||
      typeof payload.name !== "string" || !ROLES.includes(payload.role)) return null;
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

