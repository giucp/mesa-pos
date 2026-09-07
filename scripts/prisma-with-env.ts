import { spawnSync } from "node:child_process";
import { applyPrismaEnv } from "../src/lib/db-url";

const db = applyPrismaEnv();
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Uso: tsx scripts/prisma-with-env.ts <comando prisma…>");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", ...args, "--schema", db.schemaPath], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
