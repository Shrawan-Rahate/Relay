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
  || [...target.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) throw new Error("Review tests require local relay_dev");
after(() => prisma.$disconnect());
async function scenario(work: (db: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error("rollback review fixtures");
  try { await prisma.$transaction(async db => { await work(db); throw rollback; }, { timeout: 30_000 }); }
  catch (error) { if (error !== rollback) throw error; }
}
async function actor(db: Prisma.TransactionClient, role: ProjectRole, projectId?: string) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: { email: `${randomUUID()}@relay.test`, name: "Review member", passwordHash: "review-fixture",
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } } } });
  projectId ??= (await db.project.create({ data: { name: "Review fixture" } })).id;
  const membership = await db.projectMember.create({ data: { projectId, userId: user.id, role } });
  return { projectId, userId: user.id, membershipId: membership.id, cookie: `relay_session=${token}` };
}
async function fixture(db: Prisma.TransactionClient) {
  const reviewer = await actor(db, "REVIEWER"); const outgoing = await actor(db, "OUTGOING", reviewer.projectId);
  const incoming = await actor(db, "INCOMING", reviewer.projectId); const app = createApp(db);
  const gap = await db.knowledgeGap.create({ data: { projectId: reviewer.projectId, category: "UNCLEAR_STATUS", question: "What is the deployment status?", fingerprint: createHash("sha256").update(randomUUID()).digest("hex"), provenance: {} } });
  const run = await db.extractionRun.create({ data: { projectId: reviewer.projectId, requestedById: outgoing.userId, model: "mock-model", status: "SUCCEEDED", provenance: {} } });
  const claim = await db.knowledgeClaim.create({ data: { projectId: reviewer.projectId, runId: run.id, type: "STATUS", text: "Deployment status: unknown." } });
  const created = await request(app).post(`/api/projects/${reviewer.projectId}/gaps/${gap.id}/answers`).set("Cookie", outgoing.cookie).send({ answerText: "Original outgoing answer" });
  assert.equal(created.status, 201);
  return { app, reviewer, outgoing, incoming, gap, claim, answer: created.body.answer };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const root = (f: Fixture) => `/api/projects/${f.reviewer.projectId}/gaps/${f.gap.id}/answers/${f.answer.id}`;
const review = (f: Fixture, body: object, who = f.reviewer) => request(f.app).post(`${root(f)}/review`).set("Cookie", who.cookie).send(body);
const history = (f: Fixture, who = f.reviewer) => request(f.app).get(`${root(f)}/reviews`).set("Cookie", who.cookie);
const queue = (f: Fixture, query = "") => request(f.app).get(`/api/projects/${f.reviewer.projectId}/reviews/queue${query}`).set("Cookie", f.reviewer.cookie);

test("approve records a final human decision, optionally resolves the gap and never mutates the answer or AI claim", async () => scenario(async db => {
  const f = await fixture(db); const original = await db.clarificationResponse.findUniqueOrThrow({ where: { id: f.answer.id } });
  const pending = await queue(f); assert.equal(pending.status, 200); assert.equal(pending.body.answers[0].effectiveReviewStatus, "PENDING_REVIEW");
  const res = await review(f, { action: "APPROVE", resolveGap: true }); assert.equal(res.status, 201);
  assert.equal(res.body.decision.action, "APPROVE"); assert.equal(res.body.decision.reviewerId, f.reviewer.userId); assert.equal(res.body.decision.sequence, 1);
  assert.equal(res.body.answer.effectiveReviewStatus, "APPROVED"); assert.equal(res.body.answer.effectiveText, original.answerText);
  assert.deepEqual(await db.clarificationResponse.findUniqueOrThrow({ where: { id: f.answer.id } }), original);
  assert.equal((await db.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } })).status, "RESOLVED");
  assert.equal((await db.knowledgeClaim.findUniqueOrThrow({ where: { id: f.claim.id } })).status, "UNVERIFIED");
  assert.deepEqual((await queue(f)).body.answers, []);
  assert.equal((await review(f, { action: "REJECT", reason: "Disagree" })).status, 409);
  assert.equal((await history(f)).body.reviews.length, 1);
}));

test("edit stores approved corrected text separately and resolution is explicit", async () => scenario(async db => {
  const f = await fixture(db);
  const res = await review(f, { action: "EDIT", correctedText: "Reviewer corrected answer", reason: "Corrected the status" }); assert.equal(res.status, 201);
  assert.equal(res.body.decision.correctedText, "Reviewer corrected answer"); assert.equal(res.body.answer.effectiveReviewStatus, "EDITED");
  assert.equal(res.body.answer.effectiveText, "Reviewer corrected answer"); assert.equal(res.body.answer.answerText, "Original outgoing answer");
  assert.equal((await db.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } })).status, "OPEN");
  const outgoingHistory = await request(f.app).get(`/api/projects/${f.reviewer.projectId}/gaps/${f.gap.id}/answers`).set("Cookie", f.outgoing.cookie);
  assert.equal(outgoingHistory.body.answers[0].effectiveText, "Reviewer corrected answer");
  assert.equal(outgoingHistory.body.answers[0].answerText, "Original outgoing answer");
  assert.equal((await review(f, { action: "APPROVE" })).status, 409);
}));

test("defer preserves audit history and allows later approval while reject stays final and neither resolves a gap", async () => scenario(async db => {
  const f = await fixture(db);
  const first = await review(f, { action: "DEFER", reason: "Need source confirmation" }); assert.equal(first.status, 201);
  assert.equal(first.body.answer.effectiveReviewStatus, "DEFERRED"); assert.equal(first.body.answer.effectiveText, null);
  assert.equal((await db.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } })).status, "OPEN");
  assert.equal((await queue(f)).body.answers[0].effectiveReviewStatus, "DEFERRED");
  assert.equal((await review(f, { action: "DEFER", reason: "Still awaiting evidence" })).status, 201);
  const final = await review(f, { action: "REJECT", reason: "Evidence does not support this answer" }); assert.equal(final.status, 201);
  assert.equal(final.body.answer.effectiveReviewStatus, "REJECTED"); assert.equal(final.body.answer.effectiveText, null);
  assert.equal((await db.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } })).status, "OPEN");
  const result = await history(f); assert.equal(result.status, 200);
  assert.deepEqual(result.body.reviews.map((item: { action: string }) => item.action), ["DEFER", "DEFER", "REJECT"]);
  assert.deepEqual(result.body.reviews.map((item: { sequence: number }) => item.sequence), [1, 2, 3]);
  assert.equal(result.body.reviews[0].reason, "Need source confirmation");
  assert.equal((await review(f, { action: "DEFER", reason: "Reopen" })).status, 409);
  assert.deepEqual((await queue(f)).body.answers, []);
}));

test("reviewer-only APIs enforce sessions, roles, revoked membership, origins and project/answer/gap isolation", async () => scenario(async db => {
  const f = await fixture(db); const other = await fixture(db);
  for (const who of [f.outgoing, f.incoming]) {
    assert.equal((await review(f, { action: "APPROVE" }, who)).status, 403); assert.equal((await history(f, who)).status, 403);
    assert.equal((await request(f.app).get(`/api/projects/${f.reviewer.projectId}/reviews/queue`).set("Cookie", who.cookie)).status, 403);
  }
  assert.equal((await request(f.app).post(`${root(f)}/review`).send({ action: "APPROVE" })).status, 401);
  assert.equal((await request(f.app).get(`${root(f)}/reviews`)).status, 401);
  assert.equal((await request(f.app).get(`/api/projects/${f.reviewer.projectId}/reviews/queue`)).status, 401);
  assert.equal((await review(f, { action: "APPROVE" }, other.reviewer)).status, 404); assert.equal((await history(f, other.reviewer)).status, 404);
  const mismatched = `/api/projects/${f.reviewer.projectId}/gaps/${f.gap.id}/answers/${other.answer.id}`;
  assert.equal((await request(f.app).post(`${mismatched}/review`).set("Cookie", f.reviewer.cookie).send({ action: "APPROVE" })).status, 404);
  assert.equal((await request(f.app).get(`${mismatched}/reviews`).set("Cookie", f.reviewer.cookie)).status, 404);
  const gapMismatch = `/api/projects/${f.reviewer.projectId}/gaps/${other.gap.id}/answers/${f.answer.id}/reviews`;
  assert.equal((await request(f.app).get(gapMismatch).set("Cookie", f.reviewer.cookie)).status, 404);
  assert.equal((await request(f.app).post(`${root(f)}/review`).set("Cookie", f.reviewer.cookie).set("Origin", "https://foreign.test").send({ action: "APPROVE" })).status, 403);
  await db.projectMember.update({ where: { id: f.reviewer.membershipId }, data: { role: "OUTGOING" } });
  assert.equal((await review(f, { action: "APPROVE" })).status, 403);
}));

test("strict review input requires reasons and edit text and prevents status/author spoofing", async () => scenario(async db => {
  const f = await fixture(db);
  for (const body of [{}, { action: "OTHER" }, { action: "REJECT" }, { action: "DEFER", reason: " " },
    { action: "EDIT" }, { action: "EDIT", correctedText: " " }, { action: "EDIT", correctedText: "x".repeat(10_001) },
    { action: "APPROVE", correctedText: "Cannot edit here" }, { action: "APPROVE", reviewerId: f.outgoing.userId },
    { action: "APPROVE", createdAt: new Date().toISOString() }, { action: "REJECT", reason: "No", resolveGap: true },
    { action: "DEFER", reason: "Later", resolveGap: true }, { action: "EDIT", correctedText: "bad\u0000text" },
    { action: "REJECT", reason: "x".repeat(5001) }]) assert.equal((await review(f, body)).status, 400);
  assert.equal(await db.reviewDecision.count({ where: { projectId: f.reviewer.projectId } }), 0);
  assert.equal((await queue(f, "?limit=0")).status, 400);
  assert.equal((await request(f.app).get(`/api/projects/${f.reviewer.projectId}/gaps/${f.gap.id}/answers/bad-id/reviews`).set("Cookie", f.reviewer.cookie)).status, 400);
}));

test("real concurrent final reviews allow one winner and retain exactly one final audit record", async () => {
  const f = await fixture(prisma); const secondReviewer = await actor(prisma, "REVIEWER", f.reviewer.projectId);
  try {
    const responses = await Promise.all([review(f, { action: "APPROVE", resolveGap: true }), review(f, { action: "REJECT", reason: "Different reviewer" }, secondReviewer)]);
    assert.deepEqual(responses.map(res => res.status).sort(), [201, 409]);
    const decisions = await prisma.reviewDecision.findMany({ where: { responseId: f.answer.id } }); assert.equal(decisions.length, 1);
    const currentGap = await prisma.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } });
    assert.equal(currentGap.status, decisions[0]!.action === "APPROVE" ? "RESOLVED" : "OPEN");
    assert.equal((await prisma.clarificationResponse.findUniqueOrThrow({ where: { id: f.answer.id } })).answerText, "Original outgoing answer");
  } finally {
    await prisma.reviewDecision.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.clarificationResponse.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.knowledgeGap.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.extractionRun.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.project.delete({ where: { id: f.reviewer.projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [f.reviewer.userId, f.outgoing.userId, f.incoming.userId, secondReviewer.userId] } } });
  }
});

test("deferred answers can be approved or edited later, with explicit resolution and private audit history", async () => scenario(async db => {
  for (const action of ["APPROVE", "EDIT"] as const) {
    const f = await fixture(db);
    assert.equal((await review(f, { action: "DEFER", reason: "Await confirmation" })).status, 201);
    const res = await review(f, { action, ...(action === "EDIT" ? { correctedText: "Human-approved correction" } : {}), resolveGap: true });
    assert.equal(res.status, 201); assert.equal(res.body.decision.sequence, 2);
    assert.equal(res.body.answer.effectiveReviewStatus, action === "EDIT" ? "EDITED" : "APPROVED");
    assert.equal((await db.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } })).status, "RESOLVED");
    const audit = await history(f); assert.deepEqual(audit.body.reviews.map((row: { action: string }) => row.action), ["DEFER", action]);
    assert.equal((await db.clarificationResponse.findUniqueOrThrow({ where: { id: f.answer.id } })).answerText, "Original outgoing answer");
    const incomingGap = await request(f.app).get(`/api/projects/${f.reviewer.projectId}/gaps/${f.gap.id}`).set("Cookie", f.incoming.cookie);
    assert.equal(incomingGap.status, 200); assert.doesNotMatch(JSON.stringify(incomingGap.body), /Original outgoing answer|Human-approved correction|Await confirmation/);
    for (const method of ["put", "patch", "delete"] as const) assert.equal((await request(f.app)[method](`${root(f)}/review`).set("Cookie", f.reviewer.cookie).send({ action: "APPROVE" })).status, 404);
  }
}));

test("queue/history pagination is stable and scoped; history retains effective state beyond a page", async () => scenario(async db => {
  const f = await fixture(db); const other = await fixture(db);
  const second = await request(f.app).post(`/api/projects/${f.reviewer.projectId}/gaps/${f.gap.id}/answers`).set("Cookie", f.outgoing.cookie).send({ answerText: "Second original answer" });
  assert.equal(second.status, 201);
  const stamp = new Date("2026-01-01T00:00:00Z");
  await db.clarificationResponse.updateMany({ where: { projectId: f.reviewer.projectId }, data: { createdAt: stamp } });
  const ids = [f.answer.id, second.body.answer.id].sort();
  const page = await queue(f, "?limit=1"); assert.equal(page.status, 200); assert.equal(page.body.answers[0].id, ids[0]);
  assert.equal(page.body.nextCursor, ids[0]);
  const next = await queue(f, `?limit=1&cursor=${page.body.nextCursor}`); assert.equal(next.body.answers[0].id, ids[1]); assert.equal(next.body.nextCursor, null);
  assert.equal((await queue(f, `?cursor=${other.answer.id}`)).status, 404);
  for (const query of ["?limit=101", "?cursor=bad-id", "?extra=1"]) assert.equal((await queue(f, query)).status, 400);
  await review(f, { action: "DEFER", reason: "First deferral" }); await review(f, { action: "APPROVE" });
  const firstHistory = await request(f.app).get(`${root(f)}/reviews?limit=1`).set("Cookie", f.reviewer.cookie);
  assert.equal(firstHistory.status, 200); assert.equal(firstHistory.body.reviews[0].sequence, 1); assert.equal(firstHistory.body.nextAfter, 1);
  assert.equal(firstHistory.body.answer.effectiveReviewStatus, "APPROVED");
  const lastHistory = await request(f.app).get(`${root(f)}/reviews?after=1&limit=1`).set("Cookie", f.reviewer.cookie);
  assert.equal(lastHistory.body.reviews[0].action, "APPROVE"); assert.equal(lastHistory.body.nextAfter, null);
  assert.equal((await request(f.app).get(`${root(f)}/reviews?after=-1`).set("Cookie", f.reviewer.cookie)).status, 400);
}));

test("dismissed gaps retain their disposition and rejected/deferred reviews never reopen resolved gaps", async () => scenario(async db => {
  const dismissed = await fixture(db);
  await db.knowledgeGap.update({ where: { id: dismissed.gap.id }, data: { status: "DISMISSED" } });
  assert.equal((await review(dismissed, { action: "APPROVE", resolveGap: true })).status, 409);
  assert.equal(await db.reviewDecision.count({ where: { responseId: dismissed.answer.id } }), 0);
  assert.equal((await review(dismissed, { action: "APPROVE" })).status, 201);
  assert.equal((await db.knowledgeGap.findUniqueOrThrow({ where: { id: dismissed.gap.id } })).status, "DISMISSED");
  for (const action of ["REJECT", "DEFER"] as const) {
    const f = await fixture(db);
    await db.knowledgeGap.update({ where: { id: f.gap.id }, data: { status: "RESOLVED" } });
    assert.equal((await review(f, { action, reason: "Answer still needs work" })).status, 201);
    assert.equal((await db.knowledgeGap.findUniqueOrThrow({ where: { id: f.gap.id } })).status, "RESOLVED");
  }
}));
