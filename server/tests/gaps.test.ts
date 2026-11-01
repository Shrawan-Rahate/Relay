import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import type { ClaimType, Prisma, ProjectRole } from "../src/generated/prisma/client.js";

const target = new URL(process.env.DATABASE_URL ?? "");
if (!["postgresql:", "postgres:"].includes(target.protocol) || target.pathname !== "/relay_dev"
  || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || (target.port && target.port !== "5432")
  || [...target.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) throw new Error("Gap tests require local relay_dev");
after(() => prisma.$disconnect());
async function scenario(work: (db: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error("rollback gap fixtures");
  try { await prisma.$transaction(async db => { await work(db); throw rollback; }, { timeout: 30_000 }); }
  catch (error) { if (error !== rollback) throw error; }
}
async function actor(db: Prisma.TransactionClient, role: ProjectRole = "REVIEWER", projectId?: string) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: { email: `${randomUUID()}@relay.test`, passwordHash: "gap-test-fixture",
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } } } });
  projectId ??= (await db.project.create({ data: { name: "Gap fixture" } })).id;
  await db.projectMember.create({ data: { projectId, userId: user.id, role } });
  return { projectId, userId: user.id, cookie: `relay_session=${token}` };
}
async function claims(db: Prisma.TransactionClient, who: Awaited<ReturnType<typeof actor>>, items: { type: ClaimType; text: string; sourceTime?: string }[]) {
  const run = await db.extractionRun.create({ data: { projectId: who.projectId, requestedById: who.userId, model: "mock-model", status: "SUCCEEDED", completedAt: new Date(), provenance: { method: "test_fixture" } } });
  const result = [];
  for (const [index, item] of items.entries()) {
    const hash = createHash("sha256").update(`${run.id}:${index}`).digest("hex");
    const source = await db.source.create({ data: { projectId: who.projectId, importedById: who.userId, type: "MARKDOWN", filename: "notes.md", originalContent: item.text, sha256: hash, byteSize: Buffer.byteLength(item.text), provenance: { method: "test_fixture" },
      documents: { create: { position: 1, content: item.text, sha256: hash, metadata: item.sourceTime ? { updatedAt: item.sourceTime } : {} } } }, include: { documents: true } });
    result.push(await db.knowledgeClaim.create({ data: { runId: run.id, projectId: who.projectId, type: item.type, text: item.text,
      evidence: { create: { documentId: source.documents[0]!.id, quote: item.text, startOffset: 0, endOffset: item.text.length } } } }));
  }
  return result;
}
const scan = (app: ReturnType<typeof createApp>, who: Awaited<ReturnType<typeof actor>>, body = {}) => request(app).post(`/api/projects/${who.projectId}/gaps/scan`).set("Cookie", who.cookie).send(body);

test("missing owners, unclear statuses and unresolved dependencies produce evidence-linked questions", async () => scenario(async db => {
  const who = await actor(db); const app = createApp(db);
  const stored = await claims(db, who, [
    { type: "OWNER", text: "Deployment owner: TBD." }, { type: "STATUS", text: "Deployment status: unknown." },
    { type: "DEPENDENCY", text: "Deployment depends on security review." },
  ]);
  const res = await scan(app, who); assert.equal(res.status, 200);
  assert.deepEqual(res.body.gaps.map((gap: { category: string }) => gap.category).sort(), ["MISSING_OWNER", "UNCLEAR_STATUS", "UNRESOLVED_DEPENDENCY"]);
  for (const gap of res.body.gaps) {
    assert.equal(gap.status, "OPEN"); assert.ok(gap.question.endsWith("?")); assert.match(gap.question, /Deployment/i);
    assert.ok(gap.claimIds.length > 0 && gap.claimIds.every((id: string) => stored.some(claim => claim.id === id)));
    assert.ok(gap.provenance.ruleVersion);
    assert.ok(gap.claimLinks.every((link: { provenance: { evidence: unknown[] } }) => link.provenance.evidence.length));
    assert.ok(gap.createdAt && gap.updatedAt);
  }
}));

test("different status and ownership statements flag uncertainty and retain source dates", async () => scenario(async db => {
  const who = await actor(db); const app = createApp(db);
  await claims(db, who, [
    { type: "OWNER", text: "Deployment owner: Ada." }, { type: "OWNER", text: "Deployment owner: Sam." },
    { type: "STATUS", text: "Deployment status: blocked.", sourceTime: "2026-01-01T00:00:00Z" },
    { type: "STATUS", text: "Deployment status: complete.", sourceTime: "2026-02-01T00:00:00Z" },
    { type: "STATUS", text: "Billing status: complete." },
  ]);
  const res = await scan(app, who); assert.equal(res.status, 200);
  const conflicts = res.body.gaps.filter((gap: { category: string }) => gap.category === "POTENTIAL_CONFLICT");
  assert.equal(conflicts.length, 2);
  for (const gap of conflicts) {
    assert.match(gap.question, /change over time|different scope/i);
    assert.doesNotMatch(gap.question, /proven contradiction|contradictory facts/i); assert.equal(gap.claimIds.length, 2);
  }
  const dated = conflicts.find((gap: { provenance: { field: string } }) => gap.provenance.field === "status");
  assert.deepEqual(dated.claimLinks.map((link: { provenance: { evidence: { sourceMetadata: { updatedAt: string } }[] } }) => link.provenance.evidence[0].sourceMetadata.updatedAt).sort(), ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"]);
}));

test("empty and complete clean inputs produce no gaps; unrelated owners do not fill missing owners", async () => scenario(async db => {
  const who = await actor(db); const app = createApp(db);
  assert.equal((await scan(app, who)).body.gaps.length, 0);
  await claims(db, who, [
    { type: "OWNER", text: "Deployment owner: Ada." }, { type: "STATUS", text: "Deployment status: complete." },
    { type: "DEPENDENCY", text: "Deployment dependency: security review resolved." },
  ]);
  const clean = await scan(app, who); assert.equal(clean.status, 200); assert.deepEqual(clean.body.gaps, []);
  await claims(db, who, [{ type: "STATUS", text: "Billing status: active." }]);
  const res = await scan(app, who); assert.equal(res.status, 200);
  assert.equal(res.body.gaps.length, 1); assert.equal(res.body.gaps[0].category, "MISSING_OWNER"); assert.match(res.body.gaps[0].question, /Billing/);
}));

test("rescans reuse findings and links, preserve closed status and attach new evidence without duplicate open gaps", async () => scenario(async db => {
  const who = await actor(db); const app = createApp(db);
  const item = { type: "OWNER" as const, text: "Deployment owner: TBD." }; await claims(db, who, [item]);
  const first = await scan(app, who); assert.equal(first.status, 200);
  const id = first.body.gaps[0].id; const question = first.body.gaps[0].question;
  const again = await scan(app, who); assert.equal(again.body.createdCount, 0); assert.equal(again.body.gaps[0].id, id); assert.equal(again.body.gaps[0].claimIds.length, 1);
  await claims(db, who, [item]);
  const next = await scan(app, who); assert.equal(next.body.gaps[0].id, id); assert.equal(next.body.gaps[0].claimIds.length, 2);
  await db.knowledgeGap.update({ where: { id }, data: { status: "RESOLVED" } });
  const closed = await scan(app, who); assert.equal(closed.body.gaps[0].status, "RESOLVED"); assert.equal(closed.body.gaps[0].question, question);
  assert.equal(await db.knowledgeGap.count({ where: { projectId: who.projectId } }), first.body.gaps.length);
}));

test("gap APIs enforce authentication, roles, origins, UUIDs and project isolation", async () => scenario(async db => {
  const reviewer = await actor(db); const outgoing = await actor(db, "OUTGOING", reviewer.projectId);
  const incoming = await actor(db, "INCOMING", reviewer.projectId); const outsider = await actor(db); const app = createApp(db);
  await claims(db, reviewer, [{ type: "OWNER", text: "Deployment owner: TBD." }]);
  const result = await scan(app, outgoing); assert.equal(result.status, 200); const gapId = result.body.gaps[0].id;
  assert.equal((await request(app).post(`/api/projects/${reviewer.projectId}/gaps/scan`).send({})).status, 401);
  assert.equal((await scan(app, incoming)).status, 403); assert.equal((await scan(app, { ...outsider, projectId: reviewer.projectId })).status, 404);
  assert.equal((await scan(app, reviewer, { claimIds: [randomUUID()] })).status, 400);
  assert.equal((await request(app).post(`/api/projects/${reviewer.projectId}/gaps/scan`).set("Cookie", reviewer.cookie).set("Origin", "https://foreign.test").send({})).status, 403);
  for (const suffix of ["", `/${gapId}`]) {
    assert.equal((await request(app).get(`/api/projects/${reviewer.projectId}/gaps${suffix}`).set("Cookie", incoming.cookie)).status, 200);
    assert.equal((await request(app).get(`/api/projects/${reviewer.projectId}/gaps${suffix}`).set("Cookie", outsider.cookie)).status, 404);
  }
  assert.equal((await request(app).get(`/api/projects/${outsider.projectId}/gaps/${gapId}`).set("Cookie", outsider.cookie)).status, 404);
  assert.equal((await request(app).get(`/api/projects/${reviewer.projectId}/gaps/not-a-uuid`).set("Cookie", incoming.cookie)).status, 400);
  assert.equal((await request(app).get(`/api/projects/${reviewer.projectId}/gaps?limit=0`).set("Cookie", incoming.cookie)).status, 400);
}));

test("ungrounded or unsuccessful extraction claims cannot create findings", async () => scenario(async db => {
  const who = await actor(db); const app = createApp(db);
  const [claim] = await claims(db, who, [{ type: "OWNER", text: "Deployment owner: TBD." }]);
  await db.extractionRun.update({ where: { id: claim!.runId }, data: { status: "FAILED" } }); assert.deepEqual((await scan(app, who)).body.gaps, []);
  await db.extractionRun.update({ where: { id: claim!.runId }, data: { status: "SUCCEEDED" } });
  await db.claimEvidence.updateMany({ where: { claimId: claim!.id }, data: { quote: "Invented owner: nobody." } }); assert.deepEqual((await scan(app, who)).body.gaps, []);
}));

test("dependency questions distinguish future/uncertain completion from explicit absence and deduplicate equivalent targets", async () => scenario(async db => {
  const who = await actor(db); const app = createApp(db);
  await claims(db, who, [
    { type: "OWNER", text: "Deployment owner: Ada." }, { type: "STATUS", text: "Deployment status: active." },
    { type: "DEPENDENCY", text: "Deployment dependency: security review will be completed next week." },
    { type: "DEPENDENCY", text: "Deployment dependency: audit might be complete." },
    { type: "DEPENDENCY", text: "Deployment dependency: none." },
    { type: "DEPENDENCY", text: "Deployment depends on approval." },
    { type: "DEPENDENCY", text: "Deployment dependency: approval unresolved." },
  ]);
  const res = await scan(app, who); assert.equal(res.status, 200);
  const dependencies = res.body.gaps.filter((gap: { category: string }) => gap.category === "UNRESOLVED_DEPENDENCY");
  assert.equal(dependencies.length, 3);
  assert.ok(dependencies.some((gap: { question: string }) => gap.question.includes("will be completed")));
  assert.ok(dependencies.some((gap: { question: string }) => gap.question.includes("might be complete")));
  assert.ok(dependencies.every((gap: { question: string }) => !gap.question.includes("“none”")));
  assert.ok(dependencies.some((gap: { claimIds: string[] }) => gap.claimIds.length === 2));
}));

test("scan size failures preserve prior findings and database errors stay safe", async () => scenario(async db => {
  const who = await actor(db); const app = createApp(db);
  const [claim] = await claims(db, who, [{ type: "OWNER", text: "Deployment owner: TBD." }]);
  const first = await scan(app, who); assert.equal(first.status, 200);
  await db.knowledgeClaim.createMany({ data: Array.from({ length: 1000 }, () => ({ runId: claim!.runId, projectId: who.projectId, type: "STATUS" as const, text: "Unknown status" })) });
  const oversized = await scan(app, who); assert.equal(oversized.status, 413); assert.equal(oversized.body.error.code, "SCAN_TOO_LARGE");
  assert.equal(await db.knowledgeGap.count({ where: { projectId: who.projectId } }), first.body.gaps.length);
  const failingDb = new Proxy(db, { get(target, property) {
    if (property === "knowledgeGap") return new Proxy(target.knowledgeGap, { get(delegate, operation) {
      if (operation === "findMany") return async () => { throw new Error("private SQL connection credentials"); };
      return Reflect.get(delegate, operation);
    } });
    return Reflect.get(target, property);
  } });
  const res = await request(createApp(failingDb)).get(`/api/projects/${who.projectId}/gaps`).set("Cookie", who.cookie);
  assert.equal(res.status, 500); assert.equal(res.body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(res.body), /private SQL|credentials/);
}));

test("concurrent scans through full Prisma transactions create a single set of findings", async () => {
  const who = await actor(prisma); const app = createApp(prisma);
  try {
    await claims(prisma, who, [{ type: "OWNER", text: "Deployment owner: TBD." }]);
    const responses = await Promise.all([scan(app, who), scan(app, who)]);
    assert.ok(responses.every(res => res.status === 200));
    assert.deepEqual(responses[0]!.body.gaps.map((gap: { id: string }) => gap.id), responses[1]!.body.gaps.map((gap: { id: string }) => gap.id));
    assert.equal(responses.reduce((count, res) => count + res.body.createdCount, 0), responses[0]!.body.gaps.length);
    assert.equal(await prisma.knowledgeGap.count({ where: { projectId: who.projectId } }), responses[0]!.body.gaps.length);
  } finally {
    await prisma.knowledgeGap.deleteMany({ where: { projectId: who.projectId } });
    await prisma.extractionRun.deleteMany({ where: { projectId: who.projectId } });
    await prisma.project.delete({ where: { id: who.projectId } });
    await prisma.user.delete({ where: { id: who.userId } });
  }
});
