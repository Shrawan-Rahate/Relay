import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "./generated/prisma/client.js";

import { latestReview, reviewedAnswer } from "./review-state.js";

type Store = Pick<Prisma.TransactionClient, "clarificationResponse" | "knowledgeGap" | "projectMember" | "sourceDocument" | "$queryRaw">;
export type ClarificationsDatabase = Store & Partial<Pick<PrismaClient, "$transaction">>;
const validText = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const answerInput = z.object({
  answerText: validText(10_000),
  evidence: z.array(z.object({ documentId: z.uuid(), quote: validText(4000) }).strict()).max(10)
    .refine(items => new Set(items.map(item => JSON.stringify([item.documentId, item.quote]))).size === items.length).default([]),
}).strict();
const include = { author: { select: { id: true, name: true } }, evidence: { orderBy: { id: "asc" as const } } };
class ClarificationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const notFound = () => new ClarificationError(404, "NOT_FOUND", "Project, gap or evidence not found");
async function authorize(db: Store, projectId: string, gapId: string, userId: string, write: boolean) {
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!member) throw notFound();
  if (write ? member.role !== "OUTGOING" : member.role !== "REVIEWER" && member.role !== "OUTGOING") {
    throw new ClarificationError(403, "FORBIDDEN", write ? "Outgoing role required" : "Reviewer or outgoing role required");
  }
  if (!z.uuid().safeParse(gapId).success) throw new ClarificationError(400, "INVALID_INPUT", "Invalid knowledge gap ID");
  const gap = await db.knowledgeGap.findFirst({ where: { id: gapId, projectId }, select: { id: true } });
  if (!gap) throw notFound();
}

export function createClarificationsRouter(db: ClarificationsDatabase) {
  // Inherits project authentication, origin checks and project UUID validation.
  const router = Router({ mergeParams: true });
  router.post<{ id: string; gapId: string }>("/", async (req, res) => {
    const { id: projectId, gapId } = req.params;
    const authorId = res.locals.auth.user.id as string;
    await authorize(db, projectId, gapId, authorId, true);
    const parsed = answerInput.safeParse(req.body);
    if (!parsed.success) throw new ClarificationError(400, "INVALID_INPUT", "Invalid answer text or source evidence");
    const save = async (tx: Store) => {
      // Serialize with membership changes, so a revoked outgoing role cannot create a response.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
      if (!rows.length) throw notFound();
      await authorize(tx, projectId, gapId, authorId, true);
      const documentIds = [...new Set(parsed.data.evidence.map(item => item.documentId))];
      const evidence: Prisma.ClarificationResponseEvidenceUncheckedCreateWithoutResponseInput[] = [];
      if (documentIds.length) {
        // Quotes remain valid through insertion, including concurrent source changes/deletion.
        await tx.$queryRaw`SELECT "id" FROM "SourceDocument" WHERE "projectId" = ${projectId}::uuid AND "id" IN (${Prisma.join(documentIds)}) FOR SHARE`;
        const documents = await tx.sourceDocument.findMany({ where: { projectId, id: { in: documentIds } }, select: { id: true, content: true, sha256: true } });
        if (documents.length !== documentIds.length) throw notFound();
        const byId = new Map(documents.map(doc => [doc.id, doc]));
        for (const item of parsed.data.evidence) {
          const document = byId.get(item.documentId)!;
          const startOffset = document.content.indexOf(item.quote);
          if (startOffset < 0) throw new ClarificationError(400, "INVALID_EVIDENCE", "Evidence quote must exactly match the source document");
          evidence.push({ ...item, startOffset, endOffset: startOffset + item.quote.length, documentSha256: document.sha256 });
        }
      }
      // Create only: responses never update a previous answer, gap, claim or approval state.
      return tx.clarificationResponse.create({ data: { projectId, gapId, authorId, answerText: parsed.data.answerText,
        status: "PENDING_REVIEW", createdAt: new Date(), evidence: { create: evidence } }, include });
    };
    const answer = db.$transaction ? await db.$transaction(tx => save(tx)) : await save(db);
    res.status(201).json({ answer: reviewedAnswer({ ...answer, reviews: [] }) });
  });
  router.get<{ id: string; gapId: string }>("/", async (req, res) => {
    const { id: projectId, gapId } = req.params;
    await authorize(db, projectId, gapId, res.locals.auth.user.id, false);
    const parsed = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(req.query);
    if (!parsed.success) throw new ClarificationError(400, "INVALID_INPUT", "Invalid answer history pagination");
    const { cursor, limit } = parsed.data;
    const previous = cursor ? await db.clarificationResponse.findFirst({ where: { id: cursor, projectId, gapId }, select: { createdAt: true, id: true } }) : null;
    if (cursor && !previous) throw notFound();
    const answers = await db.clarificationResponse.findMany({ where: { projectId, gapId, ...(previous ? { OR: [
      { createdAt: { gt: previous.createdAt } }, { createdAt: previous.createdAt, id: { gt: previous.id } },
    ] } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1, include: { ...include, reviews: latestReview } });
    res.json({ answers: answers.slice(0, limit).map(reviewedAnswer), nextCursor: answers.length > limit ? answers[limit - 1]!.id : null });
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (error instanceof ClarificationError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
