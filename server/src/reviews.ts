import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { finalReviewActions, latestReview, reviewedAnswer } from "./review-state.js";

type Store = Pick<Prisma.TransactionClient, "reviewDecision" | "clarificationResponse" | "knowledgeGap" | "projectMember" | "$queryRaw">;
export type ReviewsDatabase = Store & Partial<Pick<PrismaClient, "$transaction">>;
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const reason = text(5000);
const reviewInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), reason: reason.optional(), resolveGap: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("EDIT"), correctedText: text(10_000), reason: reason.optional(), resolveGap: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("REJECT"), reason, resolveGap: z.literal(false).default(false) }).strict(),
  z.object({ action: z.literal("DEFER"), reason, resolveGap: z.literal(false).default(false) }).strict(),
]);
const decisionInclude = { reviewer: { select: { id: true, name: true } } };
class ReviewError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const notFound = () => new ReviewError(404, "NOT_FOUND", "Project, answer or review not found");
const finalConflict = () => new ReviewError(409, "ANSWER_ALREADY_REVIEWED", "This answer already has a final review decision");
async function reviewer(db: Store, projectId: string, userId: string) {
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!member) throw notFound();
  if (member.role !== "REVIEWER") throw new ReviewError(403, "FORBIDDEN", "Reviewer role required");
}
function answerIds(gapId: string, answerId: string) {
  if (!z.uuid().safeParse(gapId).success || !z.uuid().safeParse(answerId).success) throw new ReviewError(400, "INVALID_INPUT", "Invalid gap or answer ID");
}
async function answer(db: Store, projectId: string, gapId: string, answerId: string) {
  const response = await db.clarificationResponse.findFirst({ where: { id: answerId, projectId, gapId }, include: { reviews: latestReview } });
  if (!response) throw notFound();
  return response;
}

export function createReviewsRouter(db: ReviewsDatabase) {
  // Mounted under authenticated project routes; inherits origin and project UUID checks.
  const router = Router({ mergeParams: true });
  router.get<{ id: string }>("/reviews/queue", async (req, res) => {
    const projectId = req.params.id;
    await reviewer(db, projectId, res.locals.auth.user.id);
    const parsed = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(req.query);
    if (!parsed.success) throw new ReviewError(400, "INVALID_INPUT", "Invalid review queue pagination");
    const { cursor, limit } = parsed.data;
    const previous = cursor ? await db.clarificationResponse.findFirst({ where: { id: cursor, projectId }, select: { id: true, createdAt: true } }) : null;
    if (cursor && !previous) throw notFound();
    const answers = await db.clarificationResponse.findMany({ where: { projectId, reviews: { none: { action: { in: finalReviewActions } } }, ...(previous ? { OR: [
      { createdAt: { gt: previous.createdAt } }, { createdAt: previous.createdAt, id: { gt: previous.id } },
    ] } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1,
      include: { reviews: latestReview, author: { select: { id: true, name: true } }, evidence: { orderBy: { id: "asc" } }, gap: { select: { id: true, category: true, question: true, status: true } } } });
    res.json({ answers: answers.slice(0, limit).map(reviewedAnswer), nextCursor: answers.length > limit ? answers[limit - 1]!.id : null });
  });
  router.post<{ id: string; gapId: string; answerId: string }>("/gaps/:gapId/answers/:answerId/review", async (req, res) => {
    const { id: projectId, gapId, answerId } = req.params;
    const reviewerId = res.locals.auth.user.id as string;
    await reviewer(db, projectId, reviewerId);
    answerIds(gapId, answerId);
    const parsed = reviewInput.safeParse(req.body);
    if (!parsed.success) throw new ReviewError(400, "INVALID_INPUT", "Invalid review action, reason, corrected text or resolution option");
    const work = async (tx: Store) => {
      // Matches membership mutations, scans and answer submission. Recheck role under the lock.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
      if (!rows.length) throw notFound();
      await reviewer(tx, projectId, reviewerId);
      await tx.$queryRaw`SELECT "id" FROM "ClarificationResponse" WHERE "id" = ${answerId}::uuid AND "projectId" = ${projectId}::uuid AND "gapId" = ${gapId}::uuid FOR UPDATE`;
      const response = await answer(tx, projectId, gapId, answerId);
      if (await tx.reviewDecision.findFirst({ where: { responseId: answerId, projectId, action: { in: finalReviewActions } }, select: { id: true } })) throw finalConflict();
      const previous = await tx.reviewDecision.findFirst({ where: { responseId: answerId, projectId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
      const data = parsed.data;
      const gap = data.resolveGap ? await tx.knowledgeGap.findFirst({ where: { id: gapId, projectId }, select: { status: true } }) : null;
      if (data.resolveGap && !gap) throw notFound();
      if (gap?.status === "DISMISSED") throw new ReviewError(409, "GAP_DISMISSED", "A dismissed gap cannot be resolved by an answer review");
      const decision = await tx.reviewDecision.create({ data: { projectId, responseId: answerId, reviewerId, sequence: (previous?.sequence ?? 0) + 1,
        action: data.action, reason: data.reason, correctedText: data.action === "EDIT" ? data.correctedText : undefined, resolveGap: data.resolveGap, createdAt: new Date() }, include: decisionInclude });
      if (gap?.status === "OPEN") await tx.knowledgeGap.update({ where: { id: gapId, projectId }, data: { status: "RESOLVED" } });
      return { decision, answer: reviewedAnswer({ ...response, reviews: [decision] }) };
    };
    res.status(201).json(db.$transaction ? await db.$transaction(tx => work(tx)) : await work(db));
  });
  router.get<{ id: string; gapId: string; answerId: string }>("/gaps/:gapId/answers/:answerId/reviews", async (req, res) => {
    const { id: projectId, gapId, answerId } = req.params;
    await reviewer(db, projectId, res.locals.auth.user.id);
    answerIds(gapId, answerId);
    const parsed = z.object({ after: z.coerce.number().int().min(0).max(2_147_483_647).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(req.query);
    if (!parsed.success) throw new ReviewError(400, "INVALID_INPUT", "Invalid review history pagination");
    const response = await answer(db, projectId, gapId, answerId);
    const { after, limit } = parsed.data;
    const reviews = await db.reviewDecision.findMany({ where: { projectId, responseId: answerId, sequence: { gt: after } }, orderBy: { sequence: "asc" }, take: limit + 1, include: decisionInclude });
    res.json({ answer: reviewedAnswer(response), reviews: reviews.slice(0, limit), nextAfter: reviews.length > limit ? reviews[limit - 1]!.sequence : null });
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    const safe = error instanceof ReviewError ? error : error && typeof error === "object" && "code" in error && error.code === "P2002" ? finalConflict() : null;
    if (safe) { res.status(safe.status).json({ error: { code: safe.code, message: safe.message } }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
