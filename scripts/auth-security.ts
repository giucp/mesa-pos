import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mock } from "node:test";
import { decodeSession, encodeSession } from "../src/lib/session-token";
import { hashPassword } from "../src/lib/password";

async function main() {
  const secret = "test-only-random-secret-with-more-than-32-characters";
  const user = { id: "admin-1", email: "admin@mesa.ve", name: "Admin", role: "ADMIN" as const };
  for (const value of [undefined, "short", "mesa-dev-session-change-in-production"]) {
    if (value === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = value;
    assert.throws(() => encodeSession(user), /SESSION_SECRET/);
  }
  process.env.SESSION_SECRET = secret;
  const token = encodeSession(user);
  assert.deepEqual(decodeSession(token), user);
  assert.equal(decodeSession(token + ".extra"), null);
  assert.equal(decodeSession(token.slice(0, -1)), null);
  const signed = (payload: unknown) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(body).digest("hex")}`;
  };
  for (const payload of [null, {}, user, { ...user, exp: Date.now() - 1 },
    { ...user, exp: "tomorrow" }, { ...user, exp: Date.now() + 60000, role: "ROOT" },
    { ...user, exp: Date.now() + 60000, id: "" }]) {
    assert.equal(decodeSession(signed(payload)), null);
  }
  process.env.SESSION_SECRET = secret + "rotated";
  assert.equal(decodeSession(token), null);
  process.env.SESSION_SECRET = secret;

  let active = true;
  let storedId = user.id;
  let cookieWrites = 0;
  let reads = 0;
  const passwordHash = hashPassword("test-password");
  const db = { user: {
    findUnique: async ({ where }: { where: { email: string } }) => {
      reads++;
      return where.email === user.email ? { ...user, id: storedId, active, passwordHash } : null;
    },
    findFirst: async ({ where }: { where: { id: string; active: boolean } }) =>
      where.id === storedId && active ? { ...user, id: storedId, active } : null,
  } };
  mock.module("../src/lib/db", { namedExports: { prisma: db, isDatabaseConfigured: () => true,
    MISSING_DB_MESSAGE: "missing", asPublicDbError: () => null } });
  mock.module("../src/lib/session", { namedExports: {
    setSession: async () => { cookieWrites++; }, clearSession: async () => {},
    getSession: async () => user,
  } });
  mock.module("next/navigation", { namedExports: { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
  const { demoLoginAction, pinLoginAction, loginAction } = await import("../src/actions/auth");
  const { liveUser } = await import("../src/lib/auth-guard");
  delete process.env.MESA_ISOLATED_DEMO;
  assert.ok((await demoLoginAction(user.email))?.error);
  assert.ok((await pinLoginAction("1111"))?.error);
  assert.equal(reads, 0);
  assert.equal(cookieWrites, 0);
  process.env.MESA_ISOLATED_DEMO = "1";
  assert.ok((await demoLoginAction("other@example.com"))?.error);
  assert.ok((await pinLoginAction("__proto__"))?.error);
  active = false;
  assert.ok((await pinLoginAction("1111"))?.error);
  assert.equal(await liveUser(user), null);
  assert.equal(cookieWrites, 0);
  active = true;
  await assert.rejects(pinLoginAction("1111"), /REDIRECT:\/floor/);
  assert.equal(cookieWrites, 1);
  storedId = "replacement-account";
  assert.equal(await liveUser(user), null, "Reusing an email must not revive the old account session");
  storedId = user.id;
  delete process.env.MESA_ISOLATED_DEMO;
  const form = new FormData();
  form.set("email", user.email);
  form.set("password", "wrong");
  assert.ok((await loginAction(form))?.error);
  assert.equal(cookieWrites, 1);
  form.set("password", "test-password");
  await assert.rejects(loginAction(form), /REDIRECT:\/floor/);
  assert.equal(cookieWrites, 2);
  active = false;
  assert.ok((await loginAction(form))?.error);
  assert.equal(cookieWrites, 2);
  console.log("auth-security OK: server actions, inactive users, identity, signatures, expiration and demo isolation");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
