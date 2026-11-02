import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { hash } from "argon2";
import { createApp } from "../src/app.js";
import type { AuthOptions } from "../src/auth.js";
import { prisma } from "../src/lib/prisma.js";
import type { Prisma } from "../src/generated/prisma/client.js";

const target = new URL(process.env.DATABASE_URL ?? "");
if (!["postgresql:", "postgres:"].includes(target.protocol) || target.pathname !== "/relay_dev"
    || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || (target.port && target.port !== "5432")
    || [...target.searchParams.keys()].some(k => k !== "schema")
    || (target.searchParams.has("schema") && target.searchParams.get("schema") !== "public")) {
  throw new Error("Supabase auth tests require local relay_dev, public schema");
}
after(async () => { await prisma.$disconnect(); });

const providerUser = () => ({
  id: randomUUID(), email: `${randomUUID()}@relay.test`,
  email_confirmed_at: new Date().toISOString(), is_anonymous: false,
  user_metadata: { name: "Untrusted name", role: "REVIEWER", email_verified: true },
});
const config = { url: "https://relay-auth.supabase.co", publishableKey: "test-public-key" };
function options(body: unknown = providerUser(), status = 200): AuthOptions {
  return { authMode: "supabase", production: true, supabase: {
    ...config,
    fetch: async (url, init) => {
      assert.equal(String(url), `${config.url}/auth/v1/user`);
      assert.equal(new Headers(init?.headers).get("apikey"), config.publishableKey);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-access-token");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      return new Response(JSON.stringify(body), { status });
    },
  } };
}
type App = ReturnType<typeof createApp>;
async function scenario(run: (db: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error("rollback Supabase auth scenario");
  try {
    await prisma.$transaction(async db => { await run(db); throw rollback; }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
}
const exchange = (app: App, body: object = { accessToken: "test-access-token" }) =>
  request(app).post("/api/auth/supabase-session").send(body);
function cookie(response: request.Response) {
  const header = (response.headers["set-cookie"] as unknown as string[])[0]!;
  assert.ok(header);
  return header.split(";")[0]!;
}
async function legacy(db: Prisma.TransactionClient, email = `${randomUUID()}@relay.test`) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: { email, passwordHash: await hash("legacy-password"), sessions: {
    create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000) },
  } } });
  return { user, cookie: `relay_session=${token}` };
}

test("auth modes disable alternate credential entry points and preserve existing Relay cookies", async () => {
  await scenario(async db => {
    const app = createApp(db, options());
    const old = await legacy(db);
    for (const path of ["login", "register"]) {
      const response = await request(app).post(`/api/auth/${path}`).send({ email: old.user.email, password: "legacy-password" });
      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, "AUTH_MODE_DISABLED");
      assert.ok(!response.headers["set-cookie"]);
    }
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", old.cookie)).body.user.id, old.user.id);
    const disabled = await exchange(createApp(db, { authMode: "legacy" }));
    assert.equal(disabled.status, 404);
    assert.equal(await db.authSession.count({ where: { userId: old.user.id } }), 1);
  });
});

test("invalid mode and missing or unsafe Supabase configuration fail closed", () => {
  assert.throws(() => createApp(prisma, { authMode: "typo" as AuthOptions["authMode"] }));
  assert.throws(() => createApp(prisma, { authMode: "supabase", supabase: { url: "", publishableKey: "" } }));
  for (const url of ["http://auth.example.com", "https://user:pass@auth.example.com", "https://auth.example.com/path", "https://auth.example.com/?q=x"]) {
    assert.throws(() => createApp(prisma, { authMode: "supabase", supabase: { ...config, url } }));
  }
});

test("confirmed Supabase identity creates a safe Relay user and hashed HttpOnly session", async () => {
  await scenario(async db => {
    const identity = providerUser();
    identity.email = `  ${identity.email.toUpperCase()}  `;
    const app = createApp(db, options(identity));
    const response = await exchange(app);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body.user).sort(), ["createdAt", "email", "id", "name"]);
    assert.equal(response.body.user.email, identity.email.trim().toLowerCase());
    assert.equal(response.body.user.name, null);
    const user = await db.user.findUniqueOrThrow({ where: { id: response.body.user.id } });
    assert.equal(user.supabaseUserId, identity.id);
    assert.equal(user.passwordHash, null);
    const session = await db.authSession.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(session.tokenHash, createHash("sha256").update(cookie(response).split("=")[1]!).digest("hex"));
    const header = (response.headers["set-cookie"] as unknown as string[])[0]!;
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api", "Max-Age=604800"]) assert.ok(header.includes(flag));
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual((await request(app).get("/api/projects").set("Cookie", cookie(response))).body, { projects: [] });
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie(response))).body.user.id, user.id);
    assert.equal((await request(app).post("/api/auth/logout").set("Cookie", cookie(response))).status, 204);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie(response))).status, 401);
    assert.ok(!JSON.stringify(response.body).includes("test-access-token"));
  });
});

test("forged and expired tokens rejected by Supabase cannot create users or sessions", async () => {
  await scenario(async db => {
    const before = await db.user.count();
    const sessions = await db.authSession.count();
    for (const message of ["invalid signature", "JWT expired"]) {
      const response = await exchange(createApp(db, options({ message }, 401)));
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, "INVALID_CREDENTIALS");
      assert.ok(!response.headers["set-cookie"]);
      assert.ok(!JSON.stringify(response.body).includes(message));
    }
    assert.equal(await db.user.count(), before);
    assert.equal(await db.authSession.count(), sessions);
  });
});

test("unconfirmed, anonymous and malformed identities fail even with verification metadata", async () => {
  await scenario(async db => {
    const identity = providerUser();
    for (const body of [
      { ...identity, email_confirmed_at: null, confirmed_at: new Date().toISOString() },
      { ...identity, email_confirmed_at: "" },
      { ...identity, email_confirmed_at: "invalid-date" },
      { ...identity, is_anonymous: true },
      { ...identity, id: "not-a-uuid" },
      { ...identity, email: null },
    ]) {
      const response = await exchange(createApp(db, options(body)));
      assert.ok([401, 403].includes(response.status), JSON.stringify(response.body));
      assert.ok(!response.headers["set-cookie"]);
    }
    assert.equal(await db.user.count({ where: { email: identity.email } }), 0);
  });
});

test("email collision with a legacy account never links or changes its records", async () => {
  await scenario(async db => {
    const old = await legacy(db);
    const project = await db.project.create({ data: { name: "Existing project", members: { create: { userId: old.user.id, role: "REVIEWER" } } } });
    const identity = { ...providerUser(), email: old.user.email.toUpperCase() };
    const response = await exchange(createApp(db, options(identity)));
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "IDENTITY_CONFLICT");
    assert.ok(!response.headers["set-cookie"]);
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: old.user.id } }), old.user);
    assert.equal(await db.authSession.count({ where: { userId: old.user.id } }), 1);
    assert.equal((await db.projectMember.findFirstOrThrow({ where: { projectId: project.id } })).role, "REVIEWER");
  });
});

test("UUID mapping survives email changes, rejects a second identity and preserves per-project roles", async () => {
  await scenario(async db => {
    const identity = providerUser();
    const old = await legacy(db, identity.email);
    await db.user.update({ where: { id: old.user.id }, data: { supabaseUserId: identity.id } });
    const reviewer = await db.project.create({ data: { name: "Reviewer", members: { create: { userId: old.user.id, role: "REVIEWER" } } } });
    const incoming = await db.project.create({ data: { name: "Incoming", members: { create: { userId: old.user.id, role: "INCOMING" } } } });
    const outgoing = await db.project.create({ data: { name: "Outgoing", members: { create: { userId: old.user.id, role: "OUTGOING" } } } });
    const other = await legacy(db);
    const foreign = await db.project.create({ data: { name: "Other", members: { create: { userId: other.user.id, role: "REVIEWER" } } } });
    const changed = { ...identity, email: other.user.email };
    const app = createApp(db, options(changed));
    const first = await exchange(app);
    const second = await exchange(app);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.user.id, old.user.id);
    assert.equal(first.body.user.email, old.user.email);
    assert.notEqual(cookie(first), cookie(second));
    const session = cookie(first);
    for (const [project, role] of [[reviewer, "REVIEWER"], [incoming, "INCOMING"], [outgoing, "OUTGOING"]] as const) {
      const response = await request(app).get(`/api/projects/${project.id}`).set("Cookie", session);
      assert.equal(response.status, 200);
      assert.equal(response.body.project.role, role);
      assert.equal((await request(app).get(`/api/projects/${project.id}/members`).set("Cookie", session)).status, role === "REVIEWER" ? 200 : 403);
    }
    assert.equal((await request(app).get(`/api/projects/${foreign.id}`).set("Cookie", session)).status, 404);
    assert.equal((await request(app).post(`/api/projects/${foreign.id}/members`).set("Cookie", session).send({ email: old.user.email, role: "REVIEWER" })).status, 404);
    const collision = await exchange(createApp(db, options({ ...identity, id: randomUUID() })));
    assert.equal(collision.status, 409);
    const fallback = await request(createApp(db, { authMode: "legacy" })).post("/api/auth/login").send({ email: old.user.email, password: "legacy-password" });
    assert.equal(fallback.status, 401);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", old.cookie)).status, 200);
  });
});

test("Supabase failures return safe availability errors without issuing cookies", async () => {
  await scenario(async db => {
    for (const setup of [options({ private: "diagnostic" }, 500), options({}, 429), {
      ...options(), supabase: { ...config, fetch: async () => { throw new Error("secret network diagnostic"); } },
    }]) {
      const response = await exchange(createApp(db, setup));
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, "AUTH_UNAVAILABLE");
      assert.ok(!response.headers["set-cookie"]);
      assert.ok(!JSON.stringify(response.body).includes("diagnostic"));
    }
  });
});

test("exchange validates input, rejects foreign origins and rate limits spoofed peers", async () => {
  await scenario(async db => {
    const app = createApp(db, options());
    for (const body of [{}, { accessToken: "" }, { accessToken: "x", userId: randomUUID() }, { accessToken: 42 }]) {
      assert.equal((await exchange(app, body)).status, 400);
    }
    assert.equal((await request(app).post("/api/auth/supabase-session").set("Origin", "https://attacker.test").send({ accessToken: "test-access-token" })).status, 403);
    const limited = createApp(db, options({}, 401));
    for (let i = 0; i < 10; i++) assert.equal((await exchange(limited)).status, 401);
    assert.equal((await request(limited).post("/api/auth/supabase-session").set("X-Forwarded-For", "198.51.100.1").send({ accessToken: "test-access-token" })).status, 429);
  });
});

test("a concurrent same-UUID winner before the email check is reused without a conflict", async () => {
  await scenario(async db => {
    const identity = providerUser();
    let inserted = false;
    const user = new Proxy(db.user, {
      get(target, key) {
        if (key === "findUnique") return async (args: Prisma.UserFindUniqueArgs) => {
          if (args.where.email && !inserted) {
            inserted = true;
            // Model another request committing between the two lookups.
            await target.create({ data: { email: identity.email, supabaseUserId: identity.id } });
          }
          return target.findUnique(args);
        };
        return Reflect.get(target, key);
      },
    });
    const response = await exchange(createApp({ ...db, user }, options(identity)));
    assert.equal(response.status, 200);
    const winner = await db.user.findUniqueOrThrow({ where: { supabaseUserId: identity.id } });
    assert.equal(response.body.user.id, winner.id);
    assert.equal(await db.authSession.count({ where: { userId: winner.id } }), 1);
  });
});

for (const sameIdentity of [true, false]) {
  test(`concurrent provisioning ${sameIdentity ? "reuses one UUID" : "rejects competing UUIDs with one email"}`, async () => {
    const first = providerUser();
    const second = { ...first, id: sameIdentity ? first.id : randomUUID() };
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    let creates = 0;
    // Synchronize the real inserts after both requests observed no account.
    // Uniqueness, atomic nested writes and recovery use real PostgreSQL.
    const user = new Proxy(prisma.user, {
      get(target, key) {
        if (key === "create") return async (args: Prisma.UserCreateArgs) => {
          if (++creates === 2) release();
          await ready;
          return target.create(args);
        };
        return Reflect.get(target, key);
      },
    });
    try {
      const db = { ...prisma, user };
      const responses = await Promise.all([
        exchange(createApp(db, options(first))), exchange(createApp(db, options(second))),
      ]);
      assert.deepEqual(responses.map(r => r.status).sort(), sameIdentity ? [200, 200] : [200, 409]);
      const users = await prisma.user.findMany({ where: { supabaseUserId: { in: [first.id, second.id] } } });
      assert.equal(users.length, 1);
      assert.equal(await prisma.authSession.count({ where: { userId: users[0]!.id } }), sameIdentity ? 2 : 1);
      for (const response of responses) {
        if (response.status === 200) assert.equal(response.body.user.id, users[0]!.id);
        else assert.ok(!response.headers["set-cookie"]);
      }
    } finally {
      await prisma.user.deleteMany({ where: { supabaseUserId: { in: [first.id, second.id] } } });
    }
    assert.equal(await prisma.user.count({ where: { supabaseUserId: { in: [first.id, second.id] } } }), 0);
  });
}
