import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { applyPrismaEnv, isPostgresUrl } from "../src/lib/db-url";
import { isIsolatedPersistentUrl, looksLikeOliveProductionUrl } from "../src/lib/isolated-db-guard";

function run(command: string, args: string[], allowFail = false, timeoutMs?: number) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: false,
    timeout: timeoutMs,
  });
  if (result.error && /TIMEOUT/i.test(result.error.message)) {
    console.warn(`[mesa] ${command} ${args.join(" ")} excedió el tiempo. El build sigue.`);
    if (!allowFail) process.exit(1);
    return 1;
  }
  if ((result.status ?? 1) !== 0 && !allowFail) {
    process.exit(result.status ?? 1);
  }
  return result.status ?? 1;
}

function runSqliteTest(script: string, dbFile: string) {
  return spawnSync("npx", ["tsx", script], {
    env: { ...process.env, DATABASE_URL: `file:${process.cwd()}/${dbFile}` },
    encoding: "utf8",
  });
}

if (process.env.MESA_ISOLATED_DEMO === "1") {
  process.env.MESA_BUILDING_ISOLATED = "1";
  const db = applyPrismaEnv();
  const persistent = db.provider === "postgresql" && isPostgresUrl(db.url);
  if (persistent) {
    if (looksLikeOliveProductionUrl(db.url)) {
      console.error("[mesa] Abortado: overlay aislado apunta a Café Ávila.");
      process.exit(1);
    }
    if (!isIsolatedPersistentUrl(db.url)) {
      console.error("[mesa] Abortado: Postgres aislado debe ser mesa_isolated + isolated_fase6.");
      process.exit(1);
    }
    console.log("[mesa] Entorno aislado Fase 6: Postgres persistente isolated_fase6 (no toca public/olive)");
    run("npx", ["prisma", "generate", "--schema", "prisma/schema.prisma"]);
    run("npx", ["prisma", "db", "push", "--schema", "prisma/schema.prisma"]);
    run("npx", ["tsx", "prisma/seed.ts"]);
    run("npx", ["tsx", "scripts/check-settle.ts"]);
    run("npx", ["tsx", "scripts/phase2-sales.ts"]);
    run("npx", ["tsx", "scripts/phase3-isolated-audit.ts"]);
    run("npx", ["tsx", "scripts/phase4-isolated.ts"]);
    run("npx", ["tsx", "scripts/phase6-isolated.ts"]);
    run("npx", ["prisma", "generate", "--schema", "prisma/schema.sqlite.prisma"]);
    const p2round = runSqliteTest("scripts/phase2-pm-round.ts", "prisma/mesa-p2-round.db");
    const test = runSqliteTest("scripts/phase3-roles.ts", "prisma/mesa-phase3.db");
    const p4 = runSqliteTest("scripts/phase4-shift.ts", "prisma/mesa-phase4.db");
    const p5 = runSqliteTest("scripts/phase5-sync.ts", "prisma/mesa-phase5.db");
    const p6 = runSqliteTest("scripts/phase6-stock.ts", "prisma/mesa-phase6.db");
    run("npx", ["prisma", "generate", "--schema", "prisma/schema.prisma"]);
    const p6persist = spawnSync("npx", ["tsx", "scripts/phase6-persistent.ts"], {
      env: process.env,
      encoding: "utf8",
    });
    const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout?.trim();
    const testLog = [
      `build: isolated MESA_ISOLATED_DEMO=1 persistent isolated_fase6`,
      `commit: ${sha || process.env.VERCEL_GIT_COMMIT_SHA || "file-deploy"}`,
      `when: ${new Date().toISOString()}`,
      `check-settle + phase2-sales + phase3-isolated-audit + phase4-isolated + phase6-isolated + test:phase2-pm-round + test:phase3 + test:phase4 + test:phase5 + test:phase6 + test:phase6:persist`,
      p2round.stdout ?? "",
      p2round.stderr ?? "",
      `phase2-pm-round exit ${p2round.status ?? 1}`,
      test.stdout ?? "",
      test.stderr ?? "",
      `phase3 exit ${test.status ?? 1}`,
      p4.stdout ?? "",
      p4.stderr ?? "",
      `phase4 exit ${p4.status ?? 1}`,
      p5.stdout ?? "",
      p5.stderr ?? "",
      `phase5 exit ${p5.status ?? 1}`,
      p6.stdout ?? "",
      p6.stderr ?? "",
      `phase6 exit ${p6.status ?? 1}`,
      p6persist.stdout ?? "",
      p6persist.stderr ?? "",
      `phase6-persist exit ${p6persist.status ?? 1}`,
    ].join("\n");
    writeFileSync(`${process.cwd()}/prisma/fase3-test-log.txt`, testLog);
    console.log(testLog);
    if ((p2round.status ?? 1) !== 0) process.exit(p2round.status ?? 1);
    if ((test.status ?? 1) !== 0) process.exit(test.status ?? 1);
    if ((p4.status ?? 1) !== 0) process.exit(p4.status ?? 1);
    if ((p5.status ?? 1) !== 0) process.exit(p5.status ?? 1);
    if ((p6.status ?? 1) !== 0) process.exit(p6.status ?? 1);
    if ((p6persist.status ?? 1) !== 0) process.exit(p6persist.status ?? 1);
    run("npx", ["next", "build"]);
    process.exit(0);
  }

  process.env.DATABASE_URL = `file:${process.cwd()}/prisma/mesa-demo.db`;
  delete process.env.DIRECT_URL;
  console.log("[mesa] Entorno aislado Fase 2: SQLite demo (no toca producción)");
  run("npx", ["prisma", "generate", "--schema", "prisma/schema.sqlite.prisma"]);
  run("npx", ["prisma", "db", "push", "--schema", "prisma/schema.sqlite.prisma", "--accept-data-loss"]);
  run("npx", ["tsx", "prisma/seed.ts"]);
  run("npx", ["tsx", "scripts/check-settle.ts"]);
  run("npx", ["tsx", "scripts/phase2-pm-round.ts"]);
  run("npx", ["tsx", "scripts/phase2-sales.ts"]);
  run("npx", ["tsx", "scripts/phase3-isolated-audit.ts"]);
  run("npx", ["tsx", "scripts/phase4-isolated.ts"]);
  const test = spawnSync("npx", ["tsx", "scripts/phase3-roles.ts"], {
    env: { ...process.env, DATABASE_URL: `file:${process.cwd()}/prisma/mesa-phase3.db` },
    encoding: "utf8",
  });
  const p4 = spawnSync("npx", ["tsx", "scripts/phase4-shift.ts"], {
    env: { ...process.env, DATABASE_URL: `file:${process.cwd()}/prisma/mesa-phase4.db` },
    encoding: "utf8",
  });
  const p5 = spawnSync("npx", ["tsx", "scripts/phase5-sync.ts"], {
    env: { ...process.env, DATABASE_URL: `file:${process.cwd()}/prisma/mesa-phase5.db` },
    encoding: "utf8",
  });
  const p6iso = spawnSync("npx", ["tsx", "scripts/phase6-isolated.ts"], {
    env: process.env,
    encoding: "utf8",
  });
  const p6 = spawnSync("npx", ["tsx", "scripts/phase6-stock.ts"], {
    env: { ...process.env, DATABASE_URL: `file:${process.cwd()}/prisma/mesa-phase6.db` },
    encoding: "utf8",
  });
  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout?.trim();
  const testLog = [
    `build: isolated MESA_ISOLATED_DEMO=1`,
    `commit: ${sha || process.env.VERCEL_GIT_COMMIT_SHA || "file-deploy"}`,
    `when: ${new Date().toISOString()}`,
    `check-settle + phase2-pm-round + phase2-sales + phase3-isolated-audit + phase4-isolated + phase6-isolated + test:phase3 + test:phase4 + test:phase5 + test:phase6`,
    test.stdout ?? "",
    test.stderr ?? "",
    `phase3 exit ${test.status ?? 1}`,
    p4.stdout ?? "",
    p4.stderr ?? "",
    `phase4 exit ${p4.status ?? 1}`,
    p5.stdout ?? "",
    p5.stderr ?? "",
    `phase5 exit ${p5.status ?? 1}`,
    p6iso.stdout ?? "",
    p6iso.stderr ?? "",
    `phase6-isolated exit ${p6iso.status ?? 1}`,
    p6.stdout ?? "",
    p6.stderr ?? "",
    `phase6 exit ${p6.status ?? 1}`,
  ].join("\n");
  writeFileSync(`${process.cwd()}/prisma/fase3-test-log.txt`, testLog);
  console.log(testLog);
  if ((test.status ?? 1) !== 0) process.exit(test.status ?? 1);
  if ((p4.status ?? 1) !== 0) process.exit(p4.status ?? 1);
  if ((p5.status ?? 1) !== 0) process.exit(p5.status ?? 1);
  if ((p6iso.status ?? 1) !== 0) process.exit(p6iso.status ?? 1);
  if ((p6.status ?? 1) !== 0) process.exit(p6.status ?? 1);
  run("npx", ["next", "build"]);
  process.exit(0);
}

const db = applyPrismaEnv();
console.log(`[mesa] Prisma generate (${db.provider}${db.configured ? "" : ", sin DATABASE_URL real"})`);
run("npx", ["prisma", "generate", "--schema", db.schemaPath]);

const hasLivePostgres = db.provider === "postgresql" && isPostgresUrl(db.url);
if (hasLivePostgres) {
  try {
    const u = new URL((db.directUrl ?? db.url ?? "").replace(/^postgres:\/\//i, "postgresql://"));
    console.log(`[mesa] migrate host ${u.username}@${u.hostname}:${u.port || "5432"}`);
  } catch {
    console.log("[mesa] migrate host (unparsed)");
  }
  console.log("[mesa] prisma migrate deploy");
  run("npx", ["prisma", "migrate", "deploy", "--schema", db.schemaPath], false, 45_000);
  console.log("[mesa] seed (idempotente)");
  const seeded = run("npx", ["tsx", "prisma/seed.ts"], true, 45_000);
  if (seeded !== 0) {
    console.warn("[mesa] seed falló. La aplicación compiló con el esquema correcto; revisa la semilla por separado.");
  }
} else {
  console.log("[mesa] Sin URI Postgres de Supabase: se omite migrate/seed. Pega DATABASE_URL y DIRECT_URL en Vercel y haz Redeploy.");
}

run("npx", ["next", "build"]);
