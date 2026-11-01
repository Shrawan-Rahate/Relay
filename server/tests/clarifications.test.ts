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
  || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || (target.port && target.port !== "5432")
  || [...target.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) throw new Error("Clarification tests require local relay_dev");
after(() => prisma.$disconnect());
async function scenario(work: (db: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error("rollback clarification fixtures");
  try { await prisma.$transaction(async db => { await work(db); throw rollback; }, { timeout: 30_000 }); }
  catch (error) { if (error !== rollback) throw error; }
}
async function actor(db: Prisma.TransactionClient, role: ProjectRole, projectId?: string) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: { email: `${randomUUID()}@relay.test`, name: "Test member", passwordHash: "clarification-fixture",
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } } } });
  projectId ??= (await db.project.create({ data: { name: "Clarification fixture" } })).id;
  const membership = await db.projectMember.create({ data: { projectId, userId: user.id, role } });
  return { projectId, userId: user.id, membershipId: membership.id, cookie: `relay_session=${token}` };
}
async function fixture(db: Prisma.TransactionClient) {
  const outgoing = await actor(db, "OUTGOING");
  const reviewer = await actor(db, "REVIEWER", outgoing.projectId);
  const incoming = await actor(db, "INCOMING", outgoing.projectId);
  const app = createApp(db);
  const source = await request(app).post(`/api/projects/${outgoing.projectId}/sources`).set("Cookie", outgoing.cookie)
    .send({ type: "MARKDOWN", filename: "handoff.md", content: "Ada owns deployment.\nApproval is still pending." });
  assert.equal(source.status, 201);
  const documentId = source.body.source.documents[0].id as string;
  const run = await db.extractionRun.create({ data: { projectId: outgoing.projectId, requestedById: outgoing.userId, model: "mock-model", status: "SUCCEEDED", provenance: {} } });
  const claim = await db.knowledgeClaim.create({ data: { projectId: outgoing.projectId, runId: run.id, type: "OWNER", text: "Ada owns deployment.",
    evidence: { create: { documentId, quote: "Ada owns deployment.", startOffset: 0, endOffset: 20 } } } });
  const gap = await db.knowledgeGap.create({ data: { projectId: outgoing.projectId, category: "UNCLEAR_STATUS", question: "What is the deployment status?",
    fingerprint: createHash("sha256").update(randomUUID()).digest("hex"), provenance: { method: "test_fixture" }, claimLinks: { create: { claimId: claim.id, provenance: {} } } } });
  return { app, outgoing, reviewer, incoming, gap, claim, documentId };
}
const url = (projectId: string, gapId: string) => `/api/projects/${projectId}/gaps/${gapId}/answers`;
const answer = (app: ReturnType<typeof createApp>, who: Awaited<ReturnType<typeof actor>>, gapId: string, body: object) => request(app).post(url(who.projectId, gapId)).set("Cookie", who.cookie).send(body);

test("outgoing answers preserve append-only history, authors, evidence and pending-review state", async () => scenario(async db => {
  const f = await fixture(db);
  const beforeGap = await db.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } });
  const first = await answer(f.app, f.outgoing, f.gap.id, { answerText: "Ada is responsible; approval is still pending.", evidence: [{ documentId: f.documentId, quote: "Ada owns deployment." }] });
  assert.equal(first.status, 201);
  assert.equal(first.body.answer.authorId, f.outgoing.userId); assert.equal(first.body.answer.projectId, f.outgoing.projectId);
  assert.equal(first.body.answer.gapId, f.gap.id); assert.equal(first.body.answer.status, "PENDING_REVIEW"); assert.ok(first.body.answer.createdAt);
  assert.equal(first.body.answer.evidence[0].documentId, f.documentId);
  assert.equal(first.body.answer.evidence[0].quote, "Ada owns deployment.");
  assert.equal(first.body.answer.evidence[0].startOffset, 0); assert.equal(first.body.answer.evidence[0].endOffset, 20);
  const otherOutgoing = await actor(db, "OUTGOING", f.outgoing.projectId);
  const second = await answer(f.app, otherOutgoing, f.gap.id, { answerText: "New clarification from another outgoing member." });
  assert.equal(second.status, 201); assert.notEqual(first.body.answer.id, second.body.answer.id); assert.deepEqual(second.body.answer.evidence, []);
  const history = await request(f.app).get(url(f.outgoing.projectId, f.gap.id)).set("Cookie", f.reviewer.cookie);
  assert.equal(history.status, 200); assert.equal(history.body.answers.length, 2);
  assert.deepEqual(history.body.answers.map((item: { id: string }) => item.id), [first.body.answer.id, second.body.answer.id]);
  assert.equal(history.body.answers[0].answerText, "Ada is responsible; approval is still pending.");
  assert.ok(history.body.answers.every((item: { status: string }) => item.status === "PENDING_REVIEW"));
  assert.doesNotMatch(JSON.stringify(history.body), /passwordHash|tokenHash|clarification-fixture/);
  assert.deepEqual(await db.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } }), beforeGap);
  assert.equal((await db.knowledgeClaim.findUniqueOrThrow({ where: { id: f.claim.id } })).status, "UNVERIFIED");
  for (const method of ["put", "patch", "delete"] as const) assert.equal((await request(f.app)[method](url(f.outgoing.projectId, f.gap.id)).set("Cookie", f.outgoing.cookie).send({ answerText: "Overwrite" })).status, 404);
}));

test("only outgoing members submit; only reviewers/outgoing read, including after role revocation", async () => scenario(async db => {
  const f = await fixture(db); const endpoint = url(f.outgoing.projectId, f.gap.id);
  assert.equal((await request(f.app).post(endpoint).send({ answerText: "No session" })).status, 401);
  assert.equal((await request(f.app).get(endpoint)).status, 401);
  for (const denied of [f.reviewer, f.incoming]) assert.equal((await answer(f.app, denied, f.gap.id, { answerText: "Not outgoing" })).status, 403);
  const created = await answer(f.app, f.outgoing, f.gap.id, { answerText: "Private pending answer" }); assert.equal(created.status, 201);
  assert.equal((await request(f.app).get(endpoint).set("Cookie", f.outgoing.cookie)).status, 200);
  assert.equal((await request(f.app).get(endpoint).set("Cookie", f.incoming.cookie)).status, 403);
  for (const path of [`/api/projects/${f.outgoing.projectId}/gaps`, `/api/projects/${f.outgoing.projectId}/gaps/${f.gap.id}`, `/api/projects/${f.outgoing.projectId}/claims`]) {
    const res = await request(f.app).get(path).set("Cookie", f.incoming.cookie);
    assert.equal(res.status, 200); assert.doesNotMatch(JSON.stringify(res.body), /Private pending answer|answerText|PENDING_REVIEW/);
  }
  await db.projectMember.update({ where: { id: f.outgoing.membershipId }, data: { role: "INCOMING" } });
  assert.equal((await request(f.app).get(endpoint).set("Cookie", f.outgoing.cookie)).status, 403);
  assert.equal((await answer(f.app, f.outgoing, f.gap.id, { answerText: "Revoked role" })).status, 403);
  assert.equal((await request(f.app).post(endpoint).set("Cookie", f.reviewer.cookie).set("Origin", "https://foreign.test").send({ answerText: "Blocked origin" })).status, 403);
}));

test("strict bounded inputs and evidence quotes reject invalid responses without partial history", async () => scenario(async db => {
  const f = await fixture(db);
  const evidence = { documentId: f.documentId, quote: "Ada owns deployment." };
  for (const body of [
    {}, { answerText: "" }, { answerText: " \n\t" }, { answerText: "x".repeat(10_001) }, { answerText: "bad\u0000text" },
    { answerText: "Answer", authorId: f.reviewer.userId }, { answerText: "Answer", status: "APPROVED" }, { answerText: "Answer", createdAt: new Date().toISOString() },
    { answerText: "Answer", evidence: [{ ...evidence, documentId: "invalid" }] },
    { answerText: "Answer", evidence: [{ ...evidence, quote: "" }] },
    { answerText: "Answer", evidence: [{ ...evidence, quote: "Ada owns Deployment." }] },
    { answerText: "Answer", evidence: [{ ...evidence, extra: true }] },
    { answerText: "Answer", evidence: [evidence, { documentId: f.documentId, quote: "Fabricated quotation" }] },
    { answerText: "Answer", evidence: [evidence, evidence] },
    { answerText: "Answer", evidence: Array.from({ length: 11 }, () => evidence) },
  ]) assert.equal((await answer(f.app, f.outgoing, f.gap.id, body)).status, 400);
  assert.equal((await answer(f.app, f.outgoing, f.gap.id, { answerText: "Answer", evidence: [{ documentId: randomUUID(), quote: "Missing" }] })).status, 404);
  assert.equal((await answer(f.app, f.outgoing, "not-a-uuid", { answerText: "Answer" })).status, 400);
  assert.equal((await answer(f.app, f.outgoing, randomUUID(), { answerText: "Missing gap" })).status, 404);
  assert.equal(await db.clarificationResponse.count({ where: { projectId: f.outgoing.projectId } }), 0);
}));

test("foreign gaps, foreign evidence and outsiders cannot cross project boundaries", async () => scenario(async db => {
  const f = await fixture(db); const other = await fixture(db);
  const foreignGap = url(f.outgoing.projectId, other.gap.id);
  assert.equal((await request(f.app).post(foreignGap).set("Cookie", f.outgoing.cookie).send({ answerText: "Wrong gap" })).status, 404);
  assert.equal((await request(f.app).get(foreignGap).set("Cookie", f.outgoing.cookie)).status, 404);
  assert.equal((await answer(f.app, f.outgoing, f.gap.id, { answerText: "Wrong evidence", evidence: [{ documentId: other.documentId, quote: "Ada owns deployment." }] })).status, 404);
  const endpoint = url(f.outgoing.projectId, f.gap.id);
  assert.equal((await request(f.app).get(endpoint).set("Cookie", other.outgoing.cookie)).status, 404);
  assert.equal((await request(f.app).post(endpoint).set("Cookie", other.outgoing.cookie).send({ answerText: "Wrong project" })).status, 404);
  assert.equal(await db.clarificationResponse.count({ where: { projectId: f.outgoing.projectId } }), 0);
}));

test("answer pagination is chronological, scoped to its gap, and validates queries", async () => scenario(async db => {
  const f = await fixture(db);
  const first = await answer(f.app, f.outgoing, f.gap.id, { answerText: "First response" }); assert.equal(first.status, 201);
  const second = await answer(f.app, f.outgoing, f.gap.id, { answerText: "Second response" }); assert.equal(second.status, 201);
  const endpoint = url(f.outgoing.projectId, f.gap.id);
  const page = await request(f.app).get(`${endpoint}?limit=1`).set("Cookie", f.reviewer.cookie);
  assert.equal(page.status, 200); assert.equal(page.body.answers.length, 1); assert.equal(page.body.answers[0].id, first.body.answer.id);
  assert.equal(page.body.nextCursor, first.body.answer.id);
  const next = await request(f.app).get(`${endpoint}?limit=1&cursor=${page.body.nextCursor}`).set("Cookie", f.reviewer.cookie);
  assert.equal(next.status, 200); assert.equal(next.body.answers[0].id, second.body.answer.id); assert.equal(next.body.nextCursor, null);
  for (const query of ["limit=0", "limit=101", "cursor=bad-id", "status=PENDING_REVIEW"]) assert.equal((await request(f.app).get(`${endpoint}?${query}`).set("Cookie", f.outgoing.cookie)).status, 400);
  const foreign = await fixture(db);
  const foreignAnswer = await answer(f.app, foreign.outgoing, foreign.gap.id, { answerText: "Other project's private response" }); assert.equal(foreignAnswer.status, 201);
  const scoped = await request(f.app).get(`${endpoint}?cursor=${foreignAnswer.body.answer.id}`).set("Cookie", f.outgoing.cookie);
  assert.equal(scoped.status, 404); assert.doesNotMatch(JSON.stringify(scoped.body), /Other project's private response/);
}));

test("database failure responses do not leak answer text or internal errors", async () => scenario(async db => {
  const f = await fixture(db);
  const failingDb = new Proxy(db, { get(target, property) {
    if (property === "$transaction") return undefined; // Retain the enclosing fixture transaction and mocked delegate.
    if (property === "clarificationResponse") return new Proxy(target.clarificationResponse, { get(delegate, operation) {
      if (operation === "findMany" || operation === "create") return async () => { throw new Error("private SQL credentials: secret answer text"); };
      return Reflect.get(delegate, operation);
    } });
    return Reflect.get(target, property);
  } });
  const app = createApp(failingDb);
  for (const res of [await answer(app, f.outgoing, f.gap.id, { answerText: "secret answer text" }), await request(app).get(url(f.outgoing.projectId, f.gap.id)).set("Cookie", f.reviewer.cookie)]) {
    assert.equal(res.status, 500); assert.equal(res.body.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(res.body), /private SQL|credentials|secret answer text/);
  }
  assert.equal(await db.clarificationResponse.count({ where: { projectId: f.outgoing.projectId } }), 0);
}));

test("full Prisma transactions preserve concurrent identical answers as separate responses", async () => {
  const f = await fixture(prisma);
  try {
    const responses = await Promise.all([answer(f.app, f.outgoing, f.gap.id, { answerText: "Same clarification" }), answer(f.app, f.outgoing, f.gap.id, { answerText: "Same clarification" })]);
    assert.ok(responses.every(res => res.status === 201)); assert.notEqual(responses[0]!.body.answer.id, responses[1]!.body.answer.id);
    const stored = await prisma.clarificationResponse.findMany({ where: { projectId: f.outgoing.projectId } });
    assert.equal(stored.length, 2); assert.ok(stored.every(item => item.answerText === "Same clarification" && item.status === "PENDING_REVIEW"));
    assert.equal((await prisma.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } })).status, "OPEN");
  } finally {
    await prisma.clarificationResponse.deleteMany({ where: { projectId: f.outgoing.projectId } });
    await prisma.knowledgeGap.deleteMany({ where: { projectId: f.outgoing.projectId } });
    await prisma.extractionRun.deleteMany({ where: { projectId: f.outgoing.projectId } });
    await prisma.project.delete({ where: { id: f.outgoing.projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [f.outgoing.userId, f.reviewer.userId, f.incoming.userId] } } });
  }
});
