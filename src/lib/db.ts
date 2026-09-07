import "server-only";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ISOLATED_DEMO } from "@/lib/isolated-demo";
import {
  DB_AUTH_MESSAGE,
  MISSING_DB_MESSAGE,
  asPublicDbError,
  isolatedDemoNeedsWritableCopy,
  isolatedDemoSqlitePath,
  isDatabaseConfigured,
  resolveDatabase,
} from "@/lib/db-url";

export {
  DB_AUTH_MESSAGE,
  MISSING_DB_MESSAGE,
  asPublicDbError,
  isDatabaseConfigured,
  resolveDatabase,
};

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function ensureIsolatedSqlite() {
  if (!ISOLATED_DEMO || !isolatedDemoNeedsWritableCopy()) return;
  const resolved = resolveDatabase();
  if (resolved.provider === "postgresql") return;
  const dest = isolatedDemoSqlitePath();
  const baked = path.join(process.cwd(), "prisma", "mesa-demo.db");
  if (!existsSync(baked)) {
    throw new Error("Falta prisma/mesa-demo.db en el deploy aislado.");
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  const stamp = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "runtime";
  const stampFile = `${dest}.deploy`;
  const stamped = existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp;
  if (!existsSync(dest) || !stamped) {
    copyFileSync(baked, dest);
    writeFileSync(stampFile, stamp);
  }
  try {
    chmodSync(dest, 0o666);
  } catch {
    /* /tmp already writable */
  }
}

function createPrisma() {
  ensureIsolatedSqlite();
  const db = resolveDatabase();
  if (!db.configured || !db.url) {
    throw new Error(MISSING_DB_MESSAGE);
  }
  return new PrismaClient({
    datasources: { db: { url: db.url } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrisma() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrisma();
  }
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
