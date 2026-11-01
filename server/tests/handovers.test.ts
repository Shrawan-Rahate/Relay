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
  || [...target.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) throw new Error("Handover tests require local relay_dev");
after(() => prisma.$disconnect());
async function scenario(work: (db: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error("rollback handover fixtures");
  try { await prisma.$transaction(async db => { await work(db); throw rollback; }, { timeout: 30_000 }); }
  catch (error) { if (error !== rollback) throw error; }
}
async function actor(db: Prisma.TransactionClient, role: ProjectRole, projectId?: string) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: { email: `${randomUUID()}@relay.test`, name: "Handover member", passwordHash: "handover-fixture",
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } } } });
  projectId ??= (await db.project.create({ data: { name: "Handover fixture" } })).id;
  const membership = await db.projectMember.create({ data: { projectId, userId: user.id, role } });
  return { projectId, userId: user.id, membershipId: membership.id, cookie: `relay_session=${token}` };
}
async function fixture(db: Prisma.TransactionClient) {
  const reviewer = await actor(db, "REVIEWER"); const outgoing = await actor(db, "OUTGOING", reviewer.projectId); const incoming = await actor(db, "INCOMING", reviewer.projectId);
  const app = createApp(db);
  const imported = await request(app).post(`/api/projects/${reviewer.projectId}/sources`).set("Cookie", outgoing.cookie).send({ type: "MARKDOWN", filename: "handoff.md", content: "Ada owns deployment.\nReview the release checklist." });
  assert.equal(imported.status, 201);
  return { app, reviewer, outgoing, incoming, document: imported.body.source.documents[0] };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function gap(db: Prisma.TransactionClient, f: Fixture, question = "What is the deployment status?") {
  return db.knowledgeGap.create({ data: { projectId: f.reviewer.projectId, category: "UNCLEAR_STATUS", question, fingerprint: createHash("sha256").update(randomUUID()).digest("hex"), provenance: {} } });
}
async function response(f: Fixture, gapId: string, answerText: string, action?: "APPROVE" | "EDIT" | "REJECT" | "DEFER", correctedText?: string) {
  const base = `/api/projects/${f.reviewer.projectId}/gaps/${gapId}/answers`;
  const res = await request(f.app).post(base).set("Cookie", f.outgoing.cookie).send({ answerText, evidence: [{ documentId: f.document.id, quote: "Ada owns deployment." }] });
  assert.equal(res.status, 201);
  if (!action) return { answer: res.body.answer, decision: null };
  const review = await request(f.app).post(`${base}/${res.body.answer.id}/review`).set("Cookie", f.reviewer.cookie).send({ action,
    ...(action === "EDIT" ? { correctedText } : {}), ...(action === "REJECT" || action === "DEFER" ? { reason: "PRIVATE REVIEW REASON" } : {}) });
  assert.equal(review.status, 201);
  return { answer: res.body.answer, decision: review.body.decision };
}
const base = (f: Fixture) => `/api/projects/${f.reviewer.projectId}/handovers`;
const publish = (f: Fixture, who = f.reviewer, body = {}) => request(f.app).post(base(f)).set("Cookie", who.cookie).send(body);
const details = (f: Fixture, id: string, who = f.incoming) => request(f.app).get(`${base(f)}/${id}`).set("Cookie", who.cookie);
const acknowledge = (f: Fixture, id: string, who = f.incoming, body = {}) => request(f.app).post(`${base(f)}/${id}/acknowledge`).set("Cookie", who.cookie).send(body);

test("published handovers contain only latest approved knowledge, frozen evidence and reviewer provenance", async () => scenario(async db => {
  const f = await fixture(db); const approvedGap = await gap(db, f); const editedGap = await gap(db, f, "Who owns the handover?");
  await response(f, approvedGap.id, "SUPERSEDED APPROVAL", "APPROVE");
  const approved = await response(f, approvedGap.id, "Ada owns deployment.\nNext action: Review the release checklist.", "APPROVE");
  const edited = await response(f, editedGap.id, "UNAPPROVED ORIGINAL SECRET", "EDIT", "Reviewer corrected ownership");
  const open = await gap(db, f, "Which deployment details need clarification?");
  await response(f, open.id, "PENDING SECRET\nNext action: Invent a task.");
  await response(f, open.id, "REJECTED SECRET", "REJECT"); await response(f, open.id, "DEFERRED SECRET", "DEFER");
  const res = await publish(f); assert.equal(res.status, 201); assert.equal(res.body.handover.version, 1);
  const read = await details(f, res.body.handover.id); assert.equal(read.status, 200);
  const content = read.body.handover.content;
  assert.equal(content.confirmedKnowledge.length, 2);
  const item = content.confirmedKnowledge.find((entry: { answerId: string }) => entry.answerId === approved.answer.id);
  assert.equal(item.status, "CONFIRMED"); assert.equal(item.text, "Ada owns deployment.\nNext action: Review the release checklist.");
  assert.equal(item.review.decisionId, approved.decision.id); assert.equal(item.review.reviewerId, f.reviewer.userId); assert.equal(item.review.action, "APPROVE");
  assert.equal(item.evidence[0].documentId, f.document.id); assert.equal(item.evidence[0].quote, "Ada owns deployment."); assert.equal(item.evidence[0].documentSha256, f.document.sha256);
  assert.equal(content.confirmedKnowledge.find((entry: { answerId: string }) => entry.answerId === edited.answer.id).text, "Reviewer corrected ownership");
  assert.ok(content.unresolvedGaps.some((entry: { gapId: string; status: string }) => entry.gapId === open.id && entry.status === "UNKNOWN"));
  assert.deepEqual(content.nextActions.map((entry: { text: string }) => entry.text), ["Review the release checklist."]);
  assert.ok(content.nextActions.every((entry: object) => !("owner" in entry) && !("deadline" in entry)));
  for (const secret of ["SUPERSEDED APPROVAL", "UNAPPROVED ORIGINAL SECRET", "PENDING SECRET", "REJECTED SECRET", "DEFERRED SECRET", "PRIVATE REVIEW REASON", "Invent a task"]) assert.ok(!JSON.stringify(read.body).includes(secret));
}));

test("republishing creates immutable versions and keeps evidence and old gap states frozen", async () => scenario(async db => {
  const f = await fixture(db); const g = await gap(db, f);
  await response(f, g.id, "First approved fact", "APPROVE");
  const first = await publish(f); assert.equal(first.status, 201);
  const original = (await details(f, first.body.handover.id)).body.handover;
  await response(f, g.id, "New original private text", "EDIT", "Second approved fact");
  await db.knowledgeGap.update({ where: { id: g.id }, data: { status: "RESOLVED" } });
  await db.sourceDocument.update({ where: { id: f.document.id }, data: { content: "Changed source content" } });
  const second = await publish(f); assert.equal(second.status, 201); assert.equal(second.body.handover.version, 2);
  const old = await details(f, first.body.handover.id); assert.deepEqual(old.body.handover, original);
  assert.equal(second.body.handover.content.confirmedKnowledge[0].text, "Second approved fact");
  assert.equal(original.content.confirmedKnowledge[0].text, "First approved fact");
  assert.equal(original.content.confirmedKnowledge[0].evidence[0].quote, "Ada owns deployment.");
  assert.equal(second.body.handover.content.unresolvedGaps.length, 0); assert.equal(original.content.unresolvedGaps[0].status, "UNKNOWN");
  const listed = await request(f.app).get(base(f)).set("Cookie", f.incoming.cookie);
  assert.equal(listed.status, 200); assert.deepEqual(listed.body.handovers.map((item: { version: number }) => item.version), [2, 1]);
  assert.ok(listed.body.handovers.every((item: object) => !("content" in item)));
}));

test("publication and acknowledgement roles, sessions, input validation and membership revocation are enforced", async () => scenario(async db => {
  const f = await fixture(db);
  for (const who of [f.outgoing, f.incoming]) assert.equal((await publish(f, who)).status, 403);
  assert.equal((await request(f.app).post(base(f)).send({})).status, 401);
  assert.equal((await publish(f, f.reviewer, { content: { confirmedKnowledge: ["Injected"] } })).status, 400);
  const made = await publish(f); assert.equal(made.status, 201); const id = made.body.handover.id;
  for (const who of [f.reviewer, f.outgoing, f.incoming]) {
    assert.equal((await details(f, id, who)).status, 200);
    assert.equal((await request(f.app).get(base(f)).set("Cookie", who.cookie)).status, 200);
  }
  for (const who of [f.reviewer, f.outgoing]) assert.equal((await acknowledge(f, id, who)).status, 403);
  assert.equal((await acknowledge(f, id, f.incoming, { userId: f.reviewer.userId })).status, 400);
  assert.equal((await details(f, "bad-id")).status, 400); assert.equal((await details(f, randomUUID())).status, 404);
  assert.equal((await request(f.app).get(base(f))).status, 401);
  assert.equal((await request(f.app).get(`${base(f)}/${id}`)).status, 401);
  assert.equal((await request(f.app).post(`${base(f)}/${id}/acknowledge`).send({})).status, 401);
  assert.equal((await request(f.app).post(base(f)).set("Cookie", f.reviewer.cookie).set("Origin", "https://foreign.test").send({})).status, 403);
  await db.projectMember.delete({ where: { id: f.incoming.membershipId } });
  assert.equal((await details(f, id)).status, 404); assert.equal((await acknowledge(f, id)).status, 404);
}));

test("receipts are idempotent per incoming user and exact snapshot version, with role-aware visibility", async () => scenario(async db => {
  const f = await fixture(db); const secondIncoming = await actor(db, "INCOMING", f.reviewer.projectId);
  const made = await publish(f); assert.equal(made.status, 201); const id = made.body.handover.id;
  const first = await acknowledge(f, id); assert.equal(first.status, 201);
  assert.equal(first.body.receipt.userId, f.incoming.userId); assert.equal(first.body.receipt.snapshotVersion, 1); assert.ok(first.body.receipt.createdAt);
  const repeated = await acknowledge(f, id); assert.equal(repeated.status, 200); assert.deepEqual(repeated.body.receipt, first.body.receipt);
  assert.equal((await acknowledge(f, id, secondIncoming)).status, 201);
  const own = await details(f, id); assert.equal(own.body.receipt.id, first.body.receipt.id); assert.ok(!("receipts" in own.body));
  const reviewerView = await details(f, id, f.reviewer); assert.equal(reviewerView.body.receipts.length, 2);
  const newVersion = await publish(f); assert.equal(newVersion.status, 201);
  const next = await acknowledge(f, newVersion.body.handover.id); assert.equal(next.status, 201); assert.equal(next.body.receipt.snapshotVersion, 2);
  assert.equal(await db.handoverReceipt.count({ where: { projectId: f.reviewer.projectId } }), 3);
}));

test("foreign handovers and receipt references cannot cross project boundaries", async () => scenario(async db => {
  const f = await fixture(db); const other = await fixture(db);
  const foreign = await publish(other); assert.equal(foreign.status, 201);
  assert.equal((await details(f, foreign.body.handover.id)).status, 404); assert.equal((await acknowledge(f, foreign.body.handover.id)).status, 404);
  assert.equal((await request(f.app).get(base(f)).set("Cookie", other.incoming.cookie)).status, 404);
  assert.equal((await request(f.app).post(base(f)).set("Cookie", other.reviewer.cookie).send({})).status, 404);
  assert.equal((await request(f.app).get(`${base(f)}?limit=0`).set("Cookie", f.incoming.cookie)).status, 400);
}));

test("concurrent publishing allocates unique versions; concurrent acknowledgements store one immutable receipt", async () => {
  const f = await fixture(prisma);
  try {
    const published = await Promise.all([publish(f), publish(f)]); assert.ok(published.every(res => res.status === 201));
    assert.deepEqual(published.map(res => res.body.handover.version).sort(), [1, 2]);
    const id = published[0]!.body.handover.id;
    const receipts = await Promise.all([acknowledge(f, id), acknowledge(f, id)]);
    assert.deepEqual(receipts.map(res => res.status).sort(), [200, 201]); assert.deepEqual(receipts[0]!.body.receipt, receipts[1]!.body.receipt);
    assert.equal(await prisma.handoverReceipt.count({ where: { snapshotId: id } }), 1);
    await assert.rejects(prisma.handoverSnapshot.update({ where: { id }, data: { content: { tampered: true } } }));
    await assert.rejects(prisma.handoverReceipt.update({ where: { id: receipts[0]!.body.receipt.id }, data: { createdAt: new Date("2000-01-01") } }));
    assert.equal((await details(f, id)).body.handover.version, published[0]!.body.handover.version);
  } finally {
    await prisma.handoverSnapshot?.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.reviewDecision.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.clarificationResponse.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.knowledgeGap.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.source.deleteMany({ where: { projectId: f.reviewer.projectId } });
    await prisma.project.delete({ where: { id: f.reviewer.projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [f.reviewer.userId, f.outgoing.userId, f.incoming.userId] } } });
  }
});

test("superseded approval history does not prevent publishing a bounded effective handover", async () => scenario(async db => {
  const f = await fixture(db); const g = await gap(db, f);
  const responseIds = Array.from({ length: 1001 }, () => randomUUID());
  await db.clarificationResponse.createMany({ data: responseIds.map((id, index) => ({ id, projectId: f.reviewer.projectId, gapId: g.id, authorId: f.outgoing.userId, answerText: `Approved observation ${index}` })) });
  await db.reviewDecision.createMany({ data: responseIds.map((responseId, index) => ({ projectId: f.reviewer.projectId, responseId, reviewerId: f.reviewer.userId, sequence: 1, action: "APPROVE" as const, createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000) })) });
  const res = await publish(f); assert.equal(res.status, 201);
  assert.equal(res.body.handover.content.confirmedKnowledge.length, 1);
  assert.equal(res.body.handover.content.confirmedKnowledge[0].text, "Approved observation 1000");
}));

test("knowledge selection follows latest effective review order rather than answer submission order", async () => scenario(async db => {
  const f = await fixture(db); const g = await gap(db, f);
  const older = await response(f, g.id, "Older submitted answer"); const newer = await response(f, g.id, "Newer submitted answer");
  const reviewRoot = `/api/projects/${f.reviewer.projectId}/gaps/${g.id}/answers`;
  const firstReview = await request(f.app).post(`${reviewRoot}/${newer.answer.id}/review`).set("Cookie", f.reviewer.cookie).send({ action: "APPROVE" }); assert.equal(firstReview.status, 201);
  const lastReview = await request(f.app).post(`${reviewRoot}/${older.answer.id}/review`).set("Cookie", f.reviewer.cookie).send({ action: "EDIT", correctedText: "Most recently approved correction" }); assert.equal(lastReview.status, 201);
  const made = await publish(f); assert.equal(made.status, 201);
  assert.equal(made.body.handover.content.confirmedKnowledge[0].text, "Most recently approved correction");
  // A later non-approval makes an approval ineffective, even for externally imported history.
  await db.reviewDecision.create({ data: { projectId: f.reviewer.projectId, responseId: older.answer.id, reviewerId: f.reviewer.userId, sequence: 2, action: "DEFER", reason: "Imported later review", createdAt: new Date() } });
  const after = await publish(f); assert.equal(after.status, 201);
  assert.equal(after.body.handover.content.confirmedKnowledge[0].text, "Newer submitted answer");
  assert.ok(!JSON.stringify(after.body).includes("Most recently approved correction"));
}));

test("handover and reviewer receipt pagination stay scoped and immutable API routes reject edits", async () => scenario(async db => {
  const f = await fixture(db); const otherIncoming = await actor(db, "INCOMING", f.reviewer.projectId);
  const first = await publish(f); const second = await publish(f); assert.equal(first.status, 201); assert.equal(second.status, 201);
  const page = await request(f.app).get(`${base(f)}?limit=1`).set("Cookie", f.incoming.cookie);
  assert.equal(page.body.handovers[0].version, 2); assert.equal(page.body.nextBeforeVersion, 2);
  const next = await request(f.app).get(`${base(f)}?limit=1&beforeVersion=2`).set("Cookie", f.incoming.cookie);
  assert.equal(next.body.handovers[0].version, 1); assert.equal(next.body.nextBeforeVersion, null);
  for (const query of ["limit=101", "beforeVersion=0", "status=DRAFT"]) assert.equal((await request(f.app).get(`${base(f)}?${query}`).set("Cookie", f.incoming.cookie)).status, 400);
  const id = first.body.handover.id;
  await acknowledge(f, id); await acknowledge(f, id, otherIncoming);
  const receipts = await request(f.app).get(`${base(f)}/${id}?receiptLimit=1`).set("Cookie", f.reviewer.cookie);
  assert.equal(receipts.status, 200); assert.equal(receipts.body.receipts.length, 1); assert.ok(receipts.body.nextReceiptCursor);
  const more = await request(f.app).get(`${base(f)}/${id}?receiptLimit=1&receiptCursor=${receipts.body.nextReceiptCursor}`).set("Cookie", f.reviewer.cookie);
  assert.equal(more.status, 200); assert.equal(more.body.receipts.length, 1); assert.notEqual(more.body.receipts[0].id, receipts.body.receipts[0].id); assert.equal(more.body.nextReceiptCursor, null);
  const another = await acknowledge(f, second.body.handover.id);
  assert.equal((await request(f.app).get(`${base(f)}/${id}?receiptCursor=${another.body.receipt.id}`).set("Cookie", f.reviewer.cookie)).status, 404);
  for (const method of ["put", "patch", "delete"] as const) assert.equal((await request(f.app)[method](`${base(f)}/${id}`).set("Cookie", f.reviewer.cookie).send({ content: "Overwrite" })).status, 404);
}));

test("failed publication and acknowledgement remain atomic and return safe errors", async () => scenario(async db => {
  const f = await fixture(db);
  const failingDb = new Proxy(db, { get(target, property) {
    if (property === "$transaction") return undefined;
    if (property === "handoverSnapshot" || property === "handoverReceipt") return new Proxy(target[property], { get(delegate, operation) {
      if (operation === "create" || operation === "createMany") return async () => { throw new Error("private database credentials and pending answer secret"); };
      return Reflect.get(delegate, operation);
    } });
    return Reflect.get(target, property);
  } });
  const failing = { ...f, app: createApp(failingDb) };
  const badPublish = await publish(failing); assert.equal(badPublish.status, 500); assert.equal(badPublish.body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(badPublish.body), /credentials|pending answer secret/);
  assert.equal(await db.handoverSnapshot.count({ where: { projectId: f.reviewer.projectId } }), 0);
  const made = await publish(f); assert.equal(made.status, 201); assert.equal(made.body.handover.version, 1);
  const badAck = await acknowledge(failing, made.body.handover.id); assert.equal(badAck.status, 500); assert.doesNotMatch(JSON.stringify(badAck.body), /credentials|pending answer secret/);
  assert.equal(await db.handoverReceipt.count({ where: { projectId: f.reviewer.projectId } }), 0);
}));

test("continuation actions preserve approved order, exact text, frozen evidence and reviewer provenance", async () => scenario(async db => {
  const f = await fixture(db); const firstGap = await gap(db, f); const secondGap = await gap(db, f);
  const older = await response(f, firstGap.id, "Next action: Third action.  ", "APPROVE");
  const newer = await response(f, secondGap.id, "ORIGINAL SECRET\nNext action: Unapproved action", "EDIT", "Next action: First action.\r\n- Next action: Second action.\nNot a Next action: Ignore\nNext action:   ");
  await db.reviewDecision.update({ where: { id: older.decision.id }, data: { createdAt: new Date("2026-01-01") } });
  await db.reviewDecision.update({ where: { id: newer.decision.id }, data: { createdAt: new Date("2026-01-02") } });
  const open = await gap(db, f, "UNKNOWN question");
  await response(f, open.id, "Next action: PENDING ACTION");
  await response(f, open.id, "Next action: REJECTED ACTION", "REJECT");
  await response(f, open.id, "Next action: DEFERRED ACTION", "DEFER");
  const sourceId = f.document.sourceId;
  await db.source.update({ where: { id: sourceId }, data: { type: "GITHUB" } });
  const githubUrl = "https://github.com/relay/example/blob/main/handoff.md";
  await db.sourceDocument.update({ where: { id: f.document.id }, data: { metadata: { githubUrl, secret: "RESTRICTED METADATA" } } });
  const made = await publish(f); assert.equal(made.status, 201);
  const content = made.body.handover.content;
  assert.deepEqual(content.nextActions.map((item: { order: number; text: string }) => [item.order, item.text]), [[1, "First action."], [2, "Second action."], [3, "Third action.  "]]);
  assert.deepEqual(content.nextActions.map((item: { lineNumber: number }) => item.lineNumber), [1, 2, 1]);
  for (const action of content.nextActions) {
    const knowledge = content.confirmedKnowledge.find((item: { answerId: string }) => item.answerId === action.answerId);
    assert.deepEqual(action.review, knowledge.review); assert.deepEqual(action.evidence, knowledge.evidence);
    assert.equal(action.reviewDecisionId, knowledge.review.decisionId);
    const evidence = action.evidence[0];
    assert.equal(evidence.sourceId, sourceId); assert.equal(evidence.filename, "handoff.md"); assert.equal(evidence.sourceType, "GITHUB");
    assert.equal(evidence.quote, "Ada owns deployment."); assert.equal(evidence.githubUrl, githubUrl);
    const resolved = await request(f.app).get(evidence.documentUrl).set("Cookie", f.incoming.cookie);
    assert.equal(resolved.status, 200); assert.equal(resolved.body.document.id, f.document.id);
    assert.equal(resolved.body.document.content.slice(evidence.startOffset, evidence.endOffset), evidence.quote);
  }
  assert.ok(content.unresolvedGaps.some((item: { status: string; gapId: string }) => item.gapId === open.id && item.status === "UNKNOWN"));
  for (const who of [f.reviewer, f.outgoing, f.incoming]) {
    const read = await details(f, made.body.handover.id, who); assert.equal(read.status, 200); assert.deepEqual(read.body.handover.content, content);
    assert.doesNotMatch(JSON.stringify(read.body), /ORIGINAL SECRET|Unapproved action|PENDING ACTION|REJECTED ACTION|DEFERRED ACTION|RESTRICTED METADATA|PRIVATE REVIEW REASON/);
  }
  const other = await fixture(db);
  assert.equal((await request(f.app).get(content.nextActions[0].evidence[0].documentUrl).set("Cookie", other.incoming.cookie)).status, 404);
  await db.sourceDocument.update({ where: { id: f.document.id }, data: { metadata: { githubUrl: "javascript:alert(1)" } } });
  assert.deepEqual((await details(f, made.body.handover.id)).body.handover.content, content);
  const next = await publish(f); assert.equal(next.status, 201);
  assert.equal(next.body.handover.content.nextActions[0].evidence[0].githubUrl, null);
}));
