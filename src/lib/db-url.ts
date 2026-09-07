import path from "node:path";
import { runtimeDatabaseUrl, runtimeDirectUrl, runtimeSessionSecret } from "@/lib/runtime-dsn";
import { ISOLATED_DEMO } from "@/lib/isolated-demo";
import { isIsolatedPersistentUrl, looksLikeOliveProductionUrl } from "@/lib/isolated-db-guard";

function applyRuntimeOverlay() {
  if (runtimeDatabaseUrl) process.env.DATABASE_URL = runtimeDatabaseUrl;
  if (runtimeDirectUrl) process.env.DIRECT_URL = runtimeDirectUrl;
  if (runtimeSessionSecret && !process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = runtimeSessionSecret;
  }
}

export const PLACEHOLDER_DATABASE_URL = "postgresql://mesa:mesa@127.0.0.1:5432/mesa?sslmode=disable";

export const MISSING_DB_MESSAGE =
  "Falta DATABASE_URL de Supabase. En Supabase: Project Settings → Database → Connect → URI. Pooler Transaction (puerto 6543, usuario postgres.<ref>) → DATABASE_URL. Directa (db.<ref>.supabase.co:5432) → DIRECT_URL. Luego Redeploy.";

export const DB_AUTH_MESSAGE =
  "Supabase rechazó las credenciales de Postgres. En Connect → ORMs → Prisma, copia de nuevo DATABASE_URL (pooler :6543, usuario postgres.<ref>) y DIRECT_URL (db.<ref>.supabase.co :5432). Si la clave tiene # @ % /, URL-encódala. No hace falta pegar la clave en el chat.";

export type DbProvider = "postgresql" | "sqlite";

export type ResolvedDatabase = {
  provider: DbProvider;
  url: string | null;
  directUrl: string | null;
  configured: boolean;
  schemaPath: string;
};

function trimEnv(name: string) {
  let value = process.env[name]?.trim();
  if (!value) return undefined;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/^psql\s+/i, "").trim();
  return value || undefined;
}

export function isPostgresUrl(url?: string | null) {
  return Boolean(url && /^(postgres(ql)?:\/\/)/i.test(url));
}

export function isSqliteUrl(url?: string | null) {
  return Boolean(url && /^file:/i.test(url));
}

function allPostgresEnv() {
  const names = [
    "POSTGRES_PRISMA_URL",
    "DATABASE_URL",
    "POSTGRES_URL",
    "DIRECT_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
  ];
  const urls: string[] = [];
  for (const name of names) {
    const value = trimEnv(name);
    if (value && value !== PLACEHOLDER_DATABASE_URL && isPostgresUrl(value)) {
      urls.push(value);
    }
  }
  return urls;
}

function asUrl(raw: string) {
  try {
    return new URL(raw.replace(/^postgres:\/\//i, "postgresql://"));
  } catch {
    return null;
  }
}

function projectRefFromEnv() {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
    const value = trimEnv(name);
    const match = value?.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
    if (match) return match[1];
  }
  for (const raw of allPostgresEnv()) {
    const parsed = asUrl(raw);
    if (!parsed) continue;
    const host = parsed.hostname;
    const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (direct) return direct[1];
    const user = decodeURIComponent(parsed.username || "");
    const pooledUser = user.match(/^(?:postgres|[a-z0-9_]+)\.([a-z0-9]+)$/i);
    if (pooledUser) return pooledUser[1];
  }
  return undefined;
}

export function normalizePostgresUrl(raw: string, kind: "pool" | "direct") {
  const parsed = asUrl(raw);
  if (!parsed) return raw;
  const host = parsed.hostname;
  const port = parsed.port || (host.includes("pooler.supabase.com") && kind === "pool" ? "6543" : "5432");
  let user = decodeURIComponent(parsed.username || "");
  const ref = projectRefFromEnv();

  if (host.includes("pooler.supabase.com") && user === "postgres" && ref) {
    user = `postgres.${ref}`;
  }

  parsed.username = user;
  parsed.port = port;
  const schema = parsed.searchParams.get("schema");
  if (host.includes("supabase.com") && !parsed.searchParams.has("sslmode")) {
    parsed.searchParams.set("sslmode", "require");
  }
  if (port === "6543" && !parsed.searchParams.has("pgbouncer")) {
    parsed.searchParams.set("pgbouncer", "true");
  }
  if (port === "6543" && !parsed.searchParams.has("connect_timeout")) {
    parsed.searchParams.set("connect_timeout", "15");
  }
  if (schema) parsed.searchParams.set("schema", schema);
  return parsed.toString();
}

function scoreUrl(raw: string, kind: "pool" | "direct") {
  const parsed = asUrl(raw);
  if (!parsed) return -10;
  const host = parsed.hostname;
  const port = parsed.port;
  const user = decodeURIComponent(parsed.username || "");
  let score = 0;
  if (kind === "direct" && /^db\.[a-z0-9]+\.supabase\.co$/i.test(host)) score += 8;
  if (kind === "direct" && host.includes("pooler.supabase.com")) score -= 3;
  if (kind === "pool" && host.includes("pooler.supabase.com")) score += 4;
  if (kind === "pool" && port === "6543") score += 4;
  if (kind === "pool" && /pgbouncer=true/i.test(raw)) score += 2;
  if (/^(?:postgres|[a-z0-9_]+)\.[a-z0-9]+$/i.test(user) && host.includes("pooler.supabase.com")) score += 5;
  if (host.includes("pooler.supabase.com") && user === "postgres") score -= 4;
  if (kind === "direct" && port === "5432" && !host.includes("pooler")) score += 2;
  return score;
}

function pickBest(kind: "pool" | "direct") {
  const urls = allPostgresEnv();
  if (urls.length === 0) return undefined;
  const ranked = [...urls].sort((a, b) => scoreUrl(b, kind) - scoreUrl(a, kind));
  return normalizePostgresUrl(ranked[0], kind);
}

function localSqliteFile() {
  return `file:${path.join(process.cwd(), "prisma", "mesa.db")}`;
}

export function isolatedDemoNeedsWritableCopy() {
  if (process.env.MESA_BUILDING_ISOLATED === "1") return false;
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function isolatedDemoSqlitePath() {
  const baked = path.join(process.cwd(), "prisma", "mesa-demo.db");
  if (isolatedDemoNeedsWritableCopy()) return "/tmp/mesa-demo.db";
  return baked;
}

function isolatedPersistentFromEnv(): ResolvedDatabase | null {
  const overlayUrl = runtimeDatabaseUrl ?? runtimeDirectUrl ?? trimEnv("MESA_ISOLATED_DATABASE_URL");
  const overlayDirect = runtimeDirectUrl ?? overlayUrl ?? trimEnv("MESA_ISOLATED_DIRECT_URL");
  if (!overlayUrl || !isPostgresUrl(overlayUrl)) return null;
  if (looksLikeOliveProductionUrl(overlayUrl)) {
    throw new Error("El overlay aislado apunta a Café Ávila. Abortado.");
  }
  if (!isIsolatedPersistentUrl(overlayUrl)) return null;
  return {
    provider: "postgresql",
    url: normalizePostgresUrl(overlayUrl, "pool"),
    directUrl: normalizePostgresUrl(overlayDirect ?? overlayUrl, "direct"),
    configured: true,
    schemaPath: path.join(process.cwd(), "prisma", "schema.prisma"),
  };
}

export function resolveDatabase(): ResolvedDatabase {
  applyRuntimeOverlay();
  if (!ISOLATED_DEMO && isIsolatedPersistentUrl(runtimeDatabaseUrl ?? trimEnv("MESA_ISOLATED_DATABASE_URL"))) {
    throw new Error("Overlay aislado (mesa_isolated / isolated_fase6) en un build que no es MESA_ISOLATED_DEMO.");
  }
  if (ISOLATED_DEMO) {
    const persistent = isolatedPersistentFromEnv();
    if (persistent) return persistent;
    const file = isolatedDemoSqlitePath();
    return {
      provider: "sqlite",
      url: `file:${file}`,
      directUrl: `file:${file}`,
      configured: true,
      schemaPath: path.join(process.cwd(), "prisma", "schema.sqlite.prisma"),
    };
  }
  if (runtimeDatabaseUrl || runtimeDirectUrl) {
    const rawUrl = runtimeDatabaseUrl ?? runtimeDirectUrl!;
    const rawDirect = runtimeDirectUrl ?? rawUrl;
    return {
      provider: "postgresql",
      url: normalizePostgresUrl(rawUrl, "pool"),
      directUrl: normalizePostgresUrl(rawDirect, "direct"),
      configured: true,
      schemaPath: path.join(process.cwd(), "prisma", "schema.prisma"),
    };
  }
  const pooled = pickBest("pool");
  const direct = pickBest("direct");

  if (pooled || direct) {
    const url = pooled ?? direct!;
    return {
      provider: "postgresql",
      url,
      directUrl: direct ?? url,
      configured: true,
      schemaPath: path.join(process.cwd(), "prisma", "schema.prisma"),
    };
  }

  const sqlite =
    trimEnv("SQLITE_DATABASE_URL") ??
    (isSqliteUrl(trimEnv("DATABASE_URL")) ? trimEnv("DATABASE_URL") : undefined);
  const onVercel = Boolean(process.env.VERCEL);

  if (onVercel) {
    return {
      provider: "postgresql",
      url: null,
      directUrl: null,
      configured: false,
      schemaPath: path.join(process.cwd(), "prisma", "schema.prisma"),
    };
  }

  const url = sqlite ?? localSqliteFile();
  return {
    provider: "sqlite",
    url,
    directUrl: url,
    configured: true,
    schemaPath: path.join(process.cwd(), "prisma", "schema.sqlite.prisma"),
  };
}

/** Sets Prisma CLI env. Uses a dummy Postgres URL only so `prisma generate` can run without secrets. */
export function applyPrismaEnv() {
  const db = resolveDatabase();
  if (db.provider === "postgresql") {
    process.env.DATABASE_URL = db.url ?? PLACEHOLDER_DATABASE_URL;
    process.env.DIRECT_URL = db.directUrl ?? process.env.DATABASE_URL;
  } else if (db.url) {
    process.env.DATABASE_URL = db.url;
    delete process.env.DIRECT_URL;
  }
  return db;
}

export function isDatabaseConfigured() {
  return resolveDatabase().configured;
}

export function asPublicDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Authentication failed|P1000/i.test(message)) return DB_AUTH_MESSAGE;
  if (/P1001|Can't reach database|timed out/i.test(message)) {
    return "No se alcanzó Postgres de Supabase. Revisa host/puerto (pooler :6543 o db.<ref>.supabase.co :5432) y Redeploy.";
  }
  if (/readonly database|SQLITE_READONLY|extended_code: 8/i.test(message)) {
    return "El demo aislado no pudo escribir. Recarga; si sigue, vuelve a desplegar el entorno aislado.";
  }
  if (/P2003|Foreign key constraint/i.test(message)) {
    return "La sesión no coincide con este entorno. Cierra sesión y entra de nuevo con el PIN.";
  }
  if (/does not exist|P2021|P2010/i.test(message)) {
    return "La base está vacía o sin migraciones. Con DIRECT_URL correcta, Redeploy para prisma migrate deploy + seed.";
  }
  return null;
}
