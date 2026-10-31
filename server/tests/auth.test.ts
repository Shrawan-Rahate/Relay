import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { verify } from "argon2";
import { createApp } from "../src/app.js";
import { createAuthMiddleware } from "../src/auth.js";
import { prisma } from "../src/lib/prisma.js";
import type { Prisma } from "../src/generated/prisma/client.js";

const target = new URL(process.env.DATABASE_URL ?? "");
if (target.pathname !== "/relay_dev" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    || (target.port && target.port !== "5432") || [...target.searchParams.keys()].some(k => k !== "schema")
    || (target.searchParams.has("schema") && target.searchParams.get("schema") !== "public")) {
  throw new Error("Auth tests require local relay_dev, public schema");
}

const createdUserIds = new Set<string>();
after(async () => {
  try {
    const where = { id: { in: [...createdUserIds] } };
    assert.equal(await prisma.user.count({ where }), 0, "Auth test users must roll back");
    assert.equal(await prisma.authSession.count({ where: { userId: { in: [...createdUserIds] } } }), 0, "Auth test sessions must roll back");
  } finally {
    await prisma.$disconnect();
  }
});

const password = "Relay test password 2026!";
const origin = "http://localhost:5173";
type App = ReturnType<typeof createApp>;

async function scenario(run: (app: App, db: Prisma.TransactionClient, advance: (ms: number) => void) => Promise<void>, production = false) {
  const rollback = new Error("rollback auth test transaction");
  let now = Date.now();
  try {
    await prisma.$transaction(async db => {
      const app = createApp(db, { now: () => new Date(now), production, clientOrigin: origin });
      await run(app, db, ms => { now += ms; });
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function register(app: App, email = `${randomUUID()}@relay.test`) {
  const response = await request(app).post("/api/auth/register").send({ email, password, name: "Relay Tester" });
  if (response.status === 201) createdUserIds.add(response.body.user.id);
  return response;
}

function sessionCookie(response: request.Response): string {
  const headers = response.headers["set-cookie"] as unknown as string[];
  assert.ok(headers?.length);
  return headers[0]!.split(";")[0]!;
}

test("registration hashes passwords and tokens, returns a safe user, and authenticates me", async () => {
  await scenario(async (app, db) => {
    const response = await register(app);
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.body.user).sort(), ["createdAt", "email", "id", "name"]);
    const user = await db.user.findUniqueOrThrow({ where: { id: response.body.user.id } });
    const [, algorithm, version, parameters] = user.passwordHash.split("$");
    assert.equal(algorithm, "argon2id");
    assert.equal(version, "v=19");
    assert.deepEqual(Object.fromEntries(parameters!.split(",").map(pair => pair.split("="))), { m: "65536", t: "3", p: "1" });
    assert.ok(await verify(user.passwordHash, password));
    const cookie = sessionCookie(response);
    const token = cookie.slice(cookie.indexOf("=") + 1);
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token));
    const session = await db.authSession.findFirstOrThrow({ where: { userId: user.id } });
    assert.ok(session.tokenHash === createHash("sha256").update(token).digest("hex"));
    assert.ok(session.tokenHash !== token);
    const header = (response.headers["set-cookie"] as unknown as string[])[0]!;
    assert.ok(header.includes("HttpOnly") && header.includes("SameSite=Lax") && header.includes("Path=/api"));
    assert.ok(!header.includes("Secure"));
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie)).status, 200);
  });
});

test("login accepts normalized email and creates distinct random sessions", async () => {
  await scenario(async (app, db) => {
    const email = `${randomUUID()}@relay.test`;
    const first = await register(app, `  ${email.toUpperCase()}  `);
    assert.equal(first.status, 201);
    assert.equal(first.body.user.email, email);
    const login = await request(app).post("/api/auth/login").send({ email: email.toUpperCase(), password });
    assert.equal(login.status, 200);
    assert.ok(sessionCookie(first) !== sessionCookie(login));
    assert.equal(await db.authSession.count({ where: { userId: first.body.user.id } }), 2);
    const me = await request(app).get("/api/auth/me").set("Cookie", sessionCookie(login));
    assert.equal(me.body.user.id, first.body.user.id);
  });
});

test("unknown email and wrong password return identical safe credentials errors", async () => {
  await scenario(async (app, db) => {
    const user = await register(app);
    const wrong = await request(app).post("/api/auth/login").send({ email: user.body.user.email, password: "incorrect password" });
    const missing = await request(app).post("/api/auth/login").send({ email: "nobody@relay.test", password });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.deepEqual(wrong.body, missing.body);
    assert.equal(await db.authSession.count({ where: { userId: user.body.user.id } }), 1);
  });
});

test("registration rejects invalid input and duplicate normalized email", async () => {
  await scenario(async (app, db) => {
    const email = `${randomUUID()}@relay.test`;
    for (const body of [{ email: "bad", password }, { email, password: "short" }, { email, password, role: "REVIEWER" }]) {
      assert.equal((await request(app).post("/api/auth/register").send(body)).status, 400);
    }
    assert.equal(await db.user.count({ where: { email } }), 0);
    assert.equal((await register(app, email)).status, 201);
    // A deliberate unique violation aborts the test's enclosing transaction;
    // real HTTP requests use autocommit, so isolate this one with a savepoint.
    await db.$executeRawUnsafe("SAVEPOINT duplicate_registration");
    assert.equal((await register(app, email.toUpperCase())).status, 409);
    await db.$executeRawUnsafe("ROLLBACK TO SAVEPOINT duplicate_registration");
    assert.equal(await db.user.count({ where: { email } }), 1);
  });
});

test("protected me rejects absent, unknown, and malformed session tokens", async () => {
  await scenario(async app => {
    assert.equal((await request(app).get("/api/auth/me")).status, 401);
    for (const value of ["bad", "a".repeat(43), "%E0%A4%A"]) {
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", `relay_session=${value}`)).status, 401);
    }
  });
});

test("sessions expire at the expiry boundary and cannot authenticate", async () => {
  await scenario(async (app, db, advance) => {
    const response = await register(app);
    const cookie = sessionCookie(response);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie)).status, 200);
    advance(7 * 24 * 60 * 60 * 1000);
    const expired = await request(app).get("/api/auth/me").set("Cookie", cookie);
    assert.equal(expired.status, 401);
    assert.ok((expired.headers["set-cookie"] as unknown as string[])[0]!.includes("Expires=Thu, 01 Jan 1970"));
    assert.equal(await db.authSession.count({ where: { userId: response.body.user.id } }), 1);
  });
});

test("revoked sessions are rejected", async () => {
  await scenario(async (app, db) => {
    const response = await register(app);
    await db.authSession.updateMany({ where: { userId: response.body.user.id }, data: { revokedAt: new Date() } });
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", sessionCookie(response))).status, 401);
  });
});

test("logout revokes only the current session, clears cookies, and prevents replay", async () => {
  await scenario(async (app, db) => {
    const first = await register(app);
    const second = await request(app).post("/api/auth/login").send({ email: first.body.user.email, password });
    const cookie = sessionCookie(first);
    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    assert.equal(logout.status, 204);
    assert.ok((logout.headers["set-cookie"] as unknown as string[])[0]!.includes("Expires=Thu, 01 Jan 1970"));
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie)).status, 401);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", sessionCookie(second))).status, 200);
    assert.equal(await db.authSession.count({ where: { userId: first.body.user.id, revokedAt: { not: null } } }), 1);
    assert.equal((await request(app).post("/api/auth/logout")).status, 204);
  });
});

test("production session cookies are Secure", async () => {
  await scenario(async app => {
    const response = await register(app);
    assert.equal(response.status, 201);
    assert.ok((response.headers["set-cookie"] as unknown as string[])[0]!.includes("Secure"));
  }, true);
});

test("foreign browser origins cannot register, login, or logout", async () => {
  await scenario(async app => {
    for (const path of ["register", "login", "logout"]) {
      assert.equal((await request(app).post(`/api/auth/${path}`).set("Origin", "https://attacker.test").send({ email: "test@relay.test", password })).status, 403);
    }
    const allowed = await request(app).post("/api/auth/register").set("Origin", origin).send({ email: `${randomUUID()}@relay.test`, password });
    assert.equal(allowed.status, 201);
    createdUserIds.add(allowed.body.user.id);
  });
});

test("login rate limiting cannot be bypassed with spoofed forwarded headers", async () => {
  await scenario(async app => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await request(app).post("/api/auth/login").send({ email: "nobody@relay.test", password })).status, 401);
    }
    const limited = await request(app).post("/api/auth/login").set("X-Forwarded-For", "198.51.100.1").send({ email: "nobody@relay.test", password });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers["retry-after"]);
    assert.deepEqual(Object.keys(limited.body), ["error"]);
  });
});

test("malformed JSON returns a safe validation error and health remains available", async () => {
  await scenario(async app => {
    const response = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{");
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ["error"]);
    assert.ok(!JSON.stringify(response.body).includes("SyntaxError"));
    assert.equal((await request(app).get("/api/health")).status, 200);
  });
});

test("authentication middleware protects additional backend routes", async () => {
  await scenario(async (app, db) => {
    app.get("/api/private", createAuthMiddleware(db), (_req, res) => { res.json({ allowed: true }); });
    assert.equal((await request(app).get("/api/private")).status, 401);
    const user = await register(app);
    const response = await request(app).get("/api/private").set("Cookie", sessionCookie(user));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { allowed: true });
  });
});

test("invalid login bodies are rejected without echoing input", async () => {
  await scenario(async app => {
    for (const body of [{ email: "invalid", password }, { email: { contains: "@" }, password }, { email: "test@relay.test", password: "" }]) {
      const response = await request(app).post("/api/auth/login").send(body);
      assert.equal(response.status, 400);
      assert.deepEqual(Object.keys(response.body), ["error"]);
      assert.ok(!JSON.stringify(response.body).includes(password));
    }
  });
});

test("database failures return generic errors without exposing internals", async () => {
  await scenario(async (_app, db) => {
    // Replace only the external database failure; exercise the real HTTP handler.
    const failingUser = new Proxy(db.user, {
      get(target, key) {
        if (key === "findUnique") return async () => { throw new Error("private database diagnostic"); };
        return Reflect.get(target, key);
      },
    });
    const app = createApp({ ...db, user: failingUser });
    const response = await request(app).post("/api/auth/login").send({ email: "test@relay.test", password });
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: { code: "INTERNAL_ERROR", message: "Unable to complete request" } });
    assert.ok(!response.headers["set-cookie"]);
  });
});

test("authentication responses prevent user/session caching", async () => {
  await scenario(async app => {
    const registered = await register(app);
    const login = await request(app).post("/api/auth/login").send({ email: registered.body.user.email, password });
    const me = await request(app).get("/api/auth/me").set("Cookie", sessionCookie(login));
    for (const response of [registered, login, me]) {
      assert.equal(response.headers["cache-control"], "no-store");
      assert.deepEqual(Object.keys(response.body.user).sort(), ["createdAt", "email", "id", "name"]);
    }
  });
});
