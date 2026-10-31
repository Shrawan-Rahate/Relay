import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import type { Prisma, ProjectRole } from "../src/generated/prisma/client.js";

const target = new URL(process.env.DATABASE_URL ?? "");
if (!["postgresql:", "postgres:"].includes(target.protocol) || target.pathname !== "/relay_dev"
    || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || (target.port && target.port !== "5432")
    || [...target.searchParams.keys()].some(key => key !== "schema")
    || (target.searchParams.has("schema") && target.searchParams.get("schema") !== "public")) {
  throw new Error("Project tests require local relay_dev, public schema");
}

type App = ReturnType<typeof createApp>;
const userIds = new Set<string>();
const projectIds = new Set<string>();

after(async () => {
  try {
    assert.equal(await prisma.user.count({ where: { id: { in: [...userIds] } } }), 0);
    assert.equal(await prisma.project.count({ where: { id: { in: [...projectIds] } } }), 0);
    assert.equal(await prisma.projectMember.count({ where: { projectId: { in: [...projectIds] } } }), 0);
  } finally { await prisma.$disconnect(); }
});

async function scenario(run: (app: App, db: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error("rollback project test transaction");
  try {
    await prisma.$transaction(async db => {
      await run(createApp(db), db);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
}

async function identity(db: Prisma.TransactionClient) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: {
    email: `${randomUUID()}@relay.test`, name: "Project Test User",
    // These rollback-only fixtures authenticate via sessions, never password login.
    passwordHash: "unused-session-only-fixture",
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } },
  } });
  userIds.add(user.id);
  return { id: user.id, email: user.email, cookie: `relay_session=${token}` };
}

async function project(app: App, cookie: string, name = "Relay project") {
  const response = await request(app).post("/api/projects").set("Cookie", cookie).send({ name });
  assert.equal(response.status, 201);
  projectIds.add(response.body.project.id);
  return response.body.project as { id: string; name: string; role: string };
}

async function add(app: App, cookie: string, projectId: string, email: string, role: ProjectRole) {
  return request(app).post(`/api/projects/${projectId}/members`).set("Cookie", cookie).send({ email, role });
}

test("every project endpoint requires authentication", async () => {
  await scenario(async app => {
    const id = randomUUID();
    for (const response of [
      await request(app).post("/api/projects").send({ name: "Private" }),
      await request(app).get("/api/projects"),
      await request(app).get(`/api/projects/${id}`),
      await request(app).get(`/api/projects/${id}/members`),
      await request(app).post(`/api/projects/${id}/members`).send({ email: "user@relay.test", role: "REVIEWER" }),
      await request(app).delete(`/api/projects/${id}/members/${randomUUID()}`),
    ]) assert.equal(response.status, 401);
  });
});

test("project creation atomically makes its creator a reviewer and returns only own projects", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const other = await identity(db);
    assert.deepEqual((await request(app).get("/api/projects").set("Cookie", owner.cookie)).body, { projects: [] });
    const own = await project(app, owner.cookie);
    await project(app, other.cookie, "Other project");
    assert.equal(own.role, "REVIEWER");
    const membership = await db.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: own.id, userId: owner.id } } });
    assert.equal(membership.role, "REVIEWER");
    const list = await request(app).get("/api/projects").set("Cookie", owner.cookie);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.projects.map((p: { id: string }) => p.id), [own.id]);
    const detail = await request(app).get(`/api/projects/${own.id}`).set("Cookie", owner.cookie);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.project.role, "REVIEWER");
    assert.equal(detail.headers["cache-control"], "no-store");
  });
});

test("outsiders cannot discover, read, list members, add, or remove across projects", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const outsider = await identity(db);
    const own = await project(app, owner.cookie);
    const membership = await db.projectMember.findFirstOrThrow({ where: { projectId: own.id } });
    const missing = await request(app).get(`/api/projects/${randomUUID()}`).set("Cookie", outsider.cookie);
    for (const response of [
      await request(app).get(`/api/projects/${own.id}`).set("Cookie", outsider.cookie),
      await request(app).get(`/api/projects/${own.id}/members`).set("Cookie", outsider.cookie),
      await add(app, outsider.cookie, own.id, outsider.email, "REVIEWER"),
      await request(app).delete(`/api/projects/${own.id}/members/${membership.id}`).set("Cookie", outsider.cookie),
    ]) {
      assert.equal(response.status, 404);
      assert.deepEqual(response.body, missing.body);
    }
    assert.deepEqual((await request(app).get("/api/projects").set("Cookie", outsider.cookie)).body.projects, []);
  });
});

test("reviewers add registered users by normalized email and list safe member fields", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const own = await project(app, owner.cookie);
    for (const role of ["REVIEWER", "OUTGOING", "INCOMING"] as const) {
      const user = await identity(db);
      const added = await add(app, owner.cookie, own.id, `  ${user.email.toUpperCase()}  `, role);
      assert.equal(added.status, 201);
      assert.equal(added.body.member.role, role);
      assert.equal(added.body.member.userId, user.id);
      assert.deepEqual(Object.keys(added.body.member.user).sort(), ["email", "id", "name"]);
      assert.equal((await request(app).get(`/api/projects/${own.id}`).set("Cookie", user.cookie)).status, 200);
      const list = await request(app).get("/api/projects").set("Cookie", user.cookie);
      assert.deepEqual(list.body.projects.map((p: { id: string }) => p.id), [own.id]);
    }
    const members = await request(app).get(`/api/projects/${own.id}/members`).set("Cookie", owner.cookie);
    assert.equal(members.status, 200);
    assert.equal(members.body.members.length, 4);
    assert.ok(!JSON.stringify(members.body).includes("passwordHash"));
    assert.ok(!JSON.stringify(members.body).includes("tokenHash"));
  });
});

for (const role of ["OUTGOING", "INCOMING"] as const) {
  test(`${role} can read a project but cannot list members or escalate privileges`, async () => {
    await scenario(async (app, db) => {
      const owner = await identity(db);
      const user = await identity(db);
      const third = await identity(db);
      const own = await project(app, owner.cookie);
      const added = await add(app, owner.cookie, own.id, user.email, role);
      assert.equal(added.status, 201);
      assert.equal((await request(app).get(`/api/projects/${own.id}`).set("Cookie", user.cookie)).status, 200);
      assert.equal((await request(app).get(`/api/projects/${own.id}/members`).set("Cookie", user.cookie)).status, 403);
      assert.equal((await add(app, user.cookie, own.id, user.email, "REVIEWER")).status, 403);
      assert.equal((await add(app, user.cookie, own.id, third.email, "REVIEWER")).status, 403);
      assert.equal((await request(app).delete(`/api/projects/${own.id}/members/${added.body.member.id}`).set("Cookie", user.cookie)).status, 403);
      assert.equal((await db.projectMember.findUniqueOrThrow({ where: { id: added.body.member.id } })).role, role);
    });
  });
}

test("duplicate membership conflicts without changing its existing role", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const user = await identity(db);
    const own = await project(app, owner.cookie);
    assert.equal((await add(app, owner.cookie, own.id, user.email, "OUTGOING")).status, 201);
    assert.equal((await add(app, owner.cookie, own.id, user.email.toUpperCase(), "REVIEWER")).status, 409);
    assert.equal((await add(app, owner.cookie, own.id, owner.email, "INCOMING")).status, 409);
    const membership = await db.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: own.id, userId: user.id } } });
    assert.equal(membership.role, "OUTGOING");
    assert.equal(await db.projectMember.count({ where: { projectId: own.id } }), 2);
  });
});

test("member removal immediately revokes project access without revoking other memberships or auth", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const user = await identity(db);
    const own = await project(app, owner.cookie);
    const other = await project(app, owner.cookie, "Retained project");
    const added = await add(app, owner.cookie, own.id, user.email, "OUTGOING");
    await add(app, owner.cookie, other.id, user.email, "INCOMING");
    const path = `/api/projects/${own.id}/members/${added.body.member.id}`;
    assert.equal((await request(app).delete(path).set("Cookie", owner.cookie)).status, 204);
    assert.equal((await request(app).get(`/api/projects/${own.id}`).set("Cookie", user.cookie)).status, 404);
    assert.equal((await request(app).get(`/api/projects/${other.id}`).set("Cookie", user.cookie)).status, 200);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", user.cookie)).status, 200);
    assert.deepEqual((await request(app).get("/api/projects").set("Cookie", user.cookie)).body.projects.map((p: { id: string }) => p.id), [other.id]);
    assert.equal((await request(app).delete(path).set("Cookie", owner.cookie)).status, 404);
  });
});

test("reviewer removal revokes reviewer permissions immediately and preserves the last reviewer", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const second = await identity(db);
    const own = await project(app, owner.cookie);
    const creator = await db.projectMember.findFirstOrThrow({ where: { projectId: own.id, userId: owner.id } });
    const creatorPath = `/api/projects/${own.id}/members/${creator.id}`;
    assert.equal((await request(app).delete(creatorPath).set("Cookie", owner.cookie)).status, 409);
    const added = await add(app, owner.cookie, own.id, second.email, "REVIEWER");
    assert.equal(added.status, 201);
    assert.equal((await request(app).delete(creatorPath).set("Cookie", owner.cookie)).status, 204);
    assert.equal((await request(app).get(`/api/projects/${own.id}/members`).set("Cookie", owner.cookie)).status, 404);
    assert.equal((await add(app, owner.cookie, own.id, owner.email, "REVIEWER")).status, 404);
    assert.equal((await request(app).delete(`/api/projects/${own.id}/members/${added.body.member.id}`).set("Cookie", second.cookie)).status, 409);
    assert.equal(await db.projectMember.count({ where: { projectId: own.id, role: "REVIEWER" } }), 1);
  });
});

test("a reviewer cannot delete a member of another project via a mismatched project id", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const otherOwner = await identity(db);
    const own = await project(app, owner.cookie);
    const other = await project(app, otherOwner.cookie);
    const targetMember = await db.projectMember.findFirstOrThrow({ where: { projectId: other.id } });
    assert.equal((await request(app).delete(`/api/projects/${own.id}/members/${targetMember.id}`).set("Cookie", owner.cookie)).status, 404);
    assert.equal(await db.projectMember.count({ where: { id: targetMember.id, projectId: other.id } }), 1);
  });
});

test("project inputs, member roles and ids are validated and unregistered users cannot be added", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    for (const body of [{ name: " " }, { name: "Valid", role: "REVIEWER" }, { name: "x".repeat(201) }, { name: "Valid", description: 5 }]) {
      assert.equal((await request(app).post("/api/projects").set("Cookie", owner.cookie).send(body)).status, 400);
    }
    const own = await project(app, owner.cookie);
    for (const body of [{ email: owner.email, role: "ADMIN" }, { email: "bad", role: "INCOMING" }, { email: owner.email, role: "INCOMING", userId: owner.id }]) {
      assert.equal((await request(app).post(`/api/projects/${own.id}/members`).set("Cookie", owner.cookie).send(body)).status, 400);
    }
    assert.equal((await add(app, owner.cookie, own.id, `${randomUUID()}@relay.test`, "INCOMING")).status, 404);
    assert.equal((await request(app).get("/api/projects/not-a-uuid").set("Cookie", owner.cookie)).status, 400);
    assert.equal((await request(app).delete(`/api/projects/${own.id}/members/not-a-uuid`).set("Cookie", owner.cookie)).status, 400);
    assert.equal(await db.projectMember.count({ where: { projectId: own.id } }), 1);
  });
});

test("cross-origin state changes are rejected without changing projects or memberships", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const user = await identity(db);
    const own = await project(app, owner.cookie);
    const member = await add(app, owner.cookie, own.id, user.email, "INCOMING");
    for (const response of [
      await request(app).post("/api/projects").set("Cookie", owner.cookie).set("Origin", "https://attacker.test").send({ name: "Injected" }),
      await request(app).post(`/api/projects/${own.id}/members`).set("Cookie", owner.cookie).set("Origin", "null").send({ email: user.email, role: "REVIEWER" }),
      await request(app).delete(`/api/projects/${own.id}/members/${member.body.member.id}`).set("Cookie", owner.cookie).set("Origin", "https://attacker.test"),
    ]) assert.equal(response.status, 403);
    assert.equal(await db.projectMember.count({ where: { projectId: own.id } }), 2);
    const allowed = await request(app).post("/api/projects").set("Cookie", owner.cookie).set("Origin", "http://localhost:5173").send({ name: "Allowed" });
    assert.equal(allowed.status, 201);
    projectIds.add(allowed.body.project.id);
  });
});

test("expired and logged-out sessions cannot use project endpoints", async () => {
  await scenario(async (app, db) => {
    const owner = await identity(db);
    const expired = await identity(db);
    const own = await project(app, owner.cookie);
    assert.equal((await add(app, owner.cookie, own.id, expired.email, "REVIEWER")).status, 201);
    await db.authSession.updateMany({ where: { userId: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await request(app).get(`/api/projects/${own.id}`).set("Cookie", expired.cookie)).status, 401);
    assert.equal((await request(app).post(`/api/projects/${own.id}/members`).set("Cookie", expired.cookie).send({ email: owner.email, role: "REVIEWER" })).status, 401);
    assert.equal((await request(app).post("/api/auth/logout").set("Cookie", owner.cookie)).status, 204);
    assert.equal((await request(app).get("/api/projects").set("Cookie", owner.cookie)).status, 401);
    assert.equal((await request(app).post("/api/projects").set("Cookie", owner.cookie).send({ name: "Denied" })).status, 401);
    assert.equal(await db.projectMember.count({ where: { projectId: own.id } }), 2);
  });
});

test("full Prisma client mutations use their own transaction and safely reject missing projects", async () => {
  await scenario(async (_app, db) => {
    const user = await identity(db);
    const app = createApp({
      ...db,
      // Authenticate the rollback-only fixture through its existing transaction;
      // use an independent, real Prisma transaction for the mutation boundary.
      $transaction: prisma.$transaction.bind(prisma),
      $queryRaw: () => { throw new Error("Project locks must run inside the transaction"); },
    });
    assert.equal((await add(app, user.cookie, randomUUID(), user.email, "REVIEWER")).status, 404);
    assert.equal((await request(app).delete(`/api/projects/${randomUUID()}/members/${randomUUID()}`).set("Cookie", user.cookie)).status, 404);
  });
});
