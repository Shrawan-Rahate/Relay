import { createHash, randomUUID } from "node:crypto";
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { evidenceDocument, evidenceReference } from "./evidence.js";
import { Prisma, type PrismaClient, type ProjectRole } from "./generated/prisma/client.js";

type Store = Pick<Prisma.TransactionClient, "handoverSnapshot" | "handoverReceipt" | "reviewDecision" | "knowledgeGap" | "projectMember" | "$queryRaw">;
export type HandoversDatabase = Store & Partial<Pick<PrismaClient, "$transaction">>;
const summary = { id: true, projectId: true, version: true, authorId: true, createdAt: true, publishedAt: true, contentSha256: true };
class HandoverError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const notFound = () => new HandoverError(404, "NOT_FOUND", "Project or published handover not found");
async function membership(db: Store, projectId: string, userId: string, role?: ProjectRole) {
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!member) throw notFound();
  if (role && member.role !== role) throw new HandoverError(403, "FORBIDDEN", role === "REVIEWER" ? "Reviewer role required" : "Incoming role required");
  return member;
}
function snapshotId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new HandoverError(400, "INVALID_INPUT", "Invalid handover ID");
}
function emptyBody(body: unknown) {
  if (!z.object({}).strict().safeParse(body ?? {}).success) throw new HandoverError(400, "INVALID_INPUT", "This operation accepts an empty request body");
}
async function locked<T>(db: HandoversDatabase, projectId: string, userId: string, role: ProjectRole, work: (tx: Store) => Promise<T>) {
  const run = async (tx: Store) => {
    // Shares the lock used by review decisions and membership changes: one publication boundary.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound();
    await membership(tx, projectId, userId, role);
    return work(tx);
  };
  return db.$transaction ? db.$transaction(tx => run(tx), { timeout: 30_000 }) : run(db);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function buildContent(tx: Store, projectId: string, publishedAt: Date) {
  // Select effective knowledge before applying output limits; superseded history is not content.
  const selected = await tx.$queryRaw<{ id: string }[]>`
    SELECT latest."id" FROM (
      SELECT DISTINCT ON (r."gapId") d."id", d."createdAt"
      FROM "ReviewDecision" d
      JOIN "ClarificationResponse" r ON r."id" = d."responseId" AND r."projectId" = d."projectId"
      WHERE d."projectId" = ${projectId}::uuid AND d."action" IN ('APPROVE', 'EDIT')
      AND NOT EXISTS (
        SELECT 1 FROM "ReviewDecision" newer WHERE newer."responseId" = d."responseId"
          AND newer."projectId" = d."projectId" AND newer."sequence" > d."sequence"
      )
      ORDER BY r."gapId", d."createdAt" DESC, d."id" DESC
    ) latest ORDER BY latest."createdAt" DESC, latest."id" DESC LIMIT 1001`;
  if (selected.length > 1000) throw new HandoverError(413, "HANDOVER_TOO_LARGE", "Publication supports at most 1000 confirmed knowledge items");
  // Never load reasons or serialize original text for EDIT decisions.
  const decisions = selected.length ? await tx.reviewDecision.findMany({ where: { projectId, id: { in: selected.map(item => item.id) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, action: true, correctedText: true, reviewerId: true, sequence: true, createdAt: true,
      reviewer: { select: { name: true } }, response: { select: { id: true, gapId: true, answerText: true,
        reviews: { orderBy: { sequence: "desc" }, take: 1, select: { id: true } },
        evidence: { orderBy: { id: "asc" }, take: 11, select: { id: true, documentId: true, quote: true, documentSha256: true, startOffset: true, endOffset: true, document: evidenceDocument } } } } } }) : [];
  const gaps = await tx.knowledgeGap.findMany({ where: { projectId, status: "OPEN" }, orderBy: { id: "asc" }, take: 1001, select: { id: true, category: true, question: true } });
  if (gaps.length > 1000) throw new HandoverError(413, "HANDOVER_TOO_LARGE", "Publication supports at most 1000 unresolved gaps");
  const seen = new Set<string>();
  const confirmedKnowledge = [];
  const nextActions: Prisma.InputJsonObject[] = [];
  for (const decision of decisions) {
    const response = decision.response;
    // Finality alone is insufficient: the approval must still be the answer's latest decision.
    if (response.reviews[0]?.id !== decision.id || seen.has(response.gapId)) continue;
    seen.add(response.gapId);
    const text = decision.action === "EDIT" ? decision.correctedText : response.answerText;
    if (!text?.trim() || response.evidence.length > 10) throw new HandoverError(409, "INVALID_APPROVED_CONTENT", "Approved content could not be published safely");
    const knowledge = { status: "CONFIRMED", gapId: response.gapId, answerId: response.id, text,
      review: { decisionId: decision.id, action: decision.action, reviewerId: decision.reviewerId, reviewerName: decision.reviewer.name,
        sequence: decision.sequence, reviewedAt: decision.createdAt.toISOString() },
      evidence: response.evidence.map(item => ({ evidenceId: item.id, documentId: item.documentId, quote: item.quote,
        documentSha256: item.documentSha256, startOffset: item.startOffset, endOffset: item.endOffset, ...evidenceReference(item.document, projectId) })) };
    confirmedKnowledge.push(knowledge);
    // Copy explicit action lines verbatim; no inference of tasks, owners or dates.
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const match = line.match(/^[ \t]*(?:[-*][ \t]*)?Next action:[ \t]?(.*)$/i);
      if (match?.[1]?.trim()) nextActions.push({ order: nextActions.length + 1, text: match[1], lineNumber: index + 1,
        answerId: response.id, reviewDecisionId: decision.id, review: knowledge.review, evidence: knowledge.evidence });
    }
  }
  return { schemaVersion: 1, publishedAt: publishedAt.toISOString(), confirmedKnowledge,
    unresolvedGaps: gaps.map(gap => ({ status: "UNKNOWN", gapId: gap.id, category: gap.category, question: gap.question })), nextActions } satisfies Prisma.InputJsonObject;
}

export function createHandoversRouter(db: HandoversDatabase) {
  // Parent project router supplies authentication, origin protection and project UUID validation.
  const router = Router({ mergeParams: true });
  router.post<{ id: string }>("/", async (req, res) => {
    const projectId = req.params.id;
    const authorId = res.locals.auth.user.id as string;
    await membership(db, projectId, authorId, "REVIEWER"); emptyBody(req.body);
    const handover = await locked(db, projectId, authorId, "REVIEWER", async tx => {
      const previous = await tx.handoverSnapshot.aggregate({ where: { projectId }, _max: { version: true } });
      const version = (previous._max.version ?? 0) + 1;
      if (version > 2_147_483_647) throw new HandoverError(409, "VERSION_LIMIT", "Handover version limit reached");
      const publishedAt = new Date();
      const content = await buildContent(tx, projectId, publishedAt);
      const serialized = canonical(content);
      if (Buffer.byteLength(serialized) > 2_000_000) throw new HandoverError(413, "HANDOVER_TOO_LARGE", "Published handover content exceeds 2000000 bytes");
      return tx.handoverSnapshot.create({ data: { projectId, version, authorId, content, createdAt: publishedAt, publishedAt,
        contentSha256: createHash("sha256").update(serialized).digest("hex") } });
    });
    res.status(201).json({ handover });
  });
  router.get<{ id: string }>("/", async (req, res) => {
    const projectId = req.params.id;
    await membership(db, projectId, res.locals.auth.user.id);
    const parsed = z.object({ beforeVersion: z.coerce.number().int().min(1).max(2_147_483_647).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(req.query);
    if (!parsed.success) throw new HandoverError(400, "INVALID_INPUT", "Invalid handover pagination");
    const { beforeVersion, limit } = parsed.data;
    const handovers = await db.handoverSnapshot.findMany({ where: { projectId, ...(beforeVersion ? { version: { lt: beforeVersion } } : {}) }, orderBy: { version: "desc" }, take: limit + 1, select: summary });
    res.json({ handovers: handovers.slice(0, limit), nextBeforeVersion: handovers.length > limit ? handovers[limit - 1]!.version : null });
  });
  router.get<{ id: string; handoverId: string }>("/:handoverId", async (req, res) => {
    const { id: projectId, handoverId } = req.params;
    const userId = res.locals.auth.user.id as string;
    const member = await membership(db, projectId, userId); snapshotId(handoverId);
    const handover = await db.handoverSnapshot.findFirst({ where: { id: handoverId, projectId } });
    if (!handover) throw notFound();
    if (member.role === "REVIEWER") {
      const parsed = z.object({ receiptCursor: z.uuid().optional(), receiptLimit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(req.query);
      if (!parsed.success) throw new HandoverError(400, "INVALID_INPUT", "Invalid receipt pagination");
      const { receiptCursor, receiptLimit } = parsed.data;
      if (receiptCursor && !await db.handoverReceipt.findFirst({ where: { id: receiptCursor, projectId, snapshotId: handoverId }, select: { id: true } })) throw notFound();
      const receipts = await db.handoverReceipt.findMany({ where: { projectId, snapshotId: handoverId, ...(receiptCursor ? { id: { gt: receiptCursor } } : {}) }, orderBy: { id: "asc" }, take: receiptLimit + 1 });
      res.json({ handover, receipts: receipts.slice(0, receiptLimit), nextReceiptCursor: receipts.length > receiptLimit ? receipts[receiptLimit - 1]!.id : null });
    } else {
      if (Object.keys(req.query).length) throw new HandoverError(400, "INVALID_INPUT", "Invalid handover query");
      const receipt = await db.handoverReceipt.findFirst({ where: { projectId, snapshotId: handoverId, userId } });
      res.json({ handover, receipt });
    }
  });
  router.post<{ id: string; handoverId: string }>("/:handoverId/acknowledge", async (req, res) => {
    const { id: projectId, handoverId } = req.params;
    const userId = res.locals.auth.user.id as string;
    await membership(db, projectId, userId, "INCOMING"); snapshotId(handoverId); emptyBody(req.body);
    const { receipt, created } = await locked(db, projectId, userId, "INCOMING", async tx => {
      const handover = await tx.handoverSnapshot.findFirst({ where: { id: handoverId, projectId }, select: { version: true } });
      if (!handover) throw notFound();
      // ON CONFLICT DO NOTHING preserves the first acknowledgement and timestamp.
      const inserted = await tx.handoverReceipt.createMany({ data: { id: randomUUID(), projectId, snapshotId: handoverId,
        snapshotVersion: handover.version, userId, createdAt: new Date() }, skipDuplicates: true });
      const receipt = await tx.handoverReceipt.findUniqueOrThrow({ where: { snapshotId_userId: { snapshotId: handoverId, userId } } });
      return { receipt, created: inserted.count > 0 };
    });
    res.status(created ? 201 : 200).json({ receipt });
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (error instanceof HandoverError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
