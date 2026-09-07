/**
 * Isolated demo Prisma target. SQLite local or mesa_isolated + isolated_fase6.
 * Never Café Ávila / mesa_runtime.
 */
import { PrismaClient } from "@prisma/client";
import { applyPrismaEnv, isPostgresUrl, isSqliteUrl } from "../src/lib/db-url";
import { assertIsolatedPersistentUrl, looksLikeOliveProductionUrl } from "../src/lib/isolated-db-guard";

export function requireIsolatedDemo(script = "script") {
  if (process.env.MESA_ISOLATED_DEMO !== "1") {
    console.error(`${script} only runs with MESA_ISOLATED_DEMO=1.`);
    process.exit(1);
  }
}

export function isolatedDatabaseUrl(script = "script") {
  requireIsolatedDemo(script);
  const db = applyPrismaEnv();
  if (!db.url) {
    console.error(`${script}: falta DATABASE_URL aislada.`);
    process.exit(1);
  }
  if (looksLikeOliveProductionUrl(db.url)) {
    console.error(`${script}: abortado — la URI apunta a Café Ávila (olive).`);
    process.exit(1);
  }
  if (isPostgresUrl(db.url)) {
    try {
      assertIsolatedPersistentUrl(db.url);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else if (!isSqliteUrl(db.url)) {
    console.error(`${script}: URI aislada no reconocida.`);
    process.exit(1);
  }
  return db.url;
}

export function isolatedPrisma(script = "script") {
  return new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl(script) } } });
}
