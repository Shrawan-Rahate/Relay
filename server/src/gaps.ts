import { randomUUID } from "node:crypto";
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "./generated/prisma/client.js";
import { detectKnowledgeGaps } from "./gap-detection.js";

import { createClarificationsRouter, type ClarificationsDatabase } from "./clarifications.js";

type Store = Pick<Prisma.TransactionClient, "knowledgeGap" | "knowledgeGapClaim" | "knowledgeClaim" | "projectMember" | "$queryRaw">;
export type GapsDatabase = Store & ClarificationsDatabase & Partial<Pick<PrismaClient, "$transaction">>;
const MAX_CLAIMS = 1000;
const MAX_FINDINGS = 200;
const include = { claimLinks: { orderBy: { claimId: "asc" as const } } };
type Gap = Prisma.KnowledgeGapGetPayload<{ include: typeof include }>;
const serialize = (gap: Gap) => ({ ...gap, claimIds: gap.claimLinks.map(link => link.claimId) });
class GapError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const notFound = () => new GapError(404, "NOT_FOUND", "Project or knowledge gap not found");
async function membership(db: Store, projectId: string, userId: string, write = false) {
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!member) throw notFound();
  if (write && member.role !== "REVIEWER" && member.role !== "OUTGOING") throw new GapError(403, "FORBIDDEN", "Reviewer or outgoing role required");
}

async function scan(db: GapsDatabase, projectId: string, userId: string) {
  const run = async (tx: Store) => {
    // Same project lock as membership mutations and extraction commits: scans are serialized.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound();
    await membership(tx, projectId, userId, true);
    const claims = await tx.knowledgeClaim.findMany({ where: { projectId, run: { status: "SUCCEEDED" } }, take: MAX_CLAIMS + 1, orderBy: { id: "asc" },
      include: { run: { select: { id: true, provider: true, model: true, modelVersion: true, createdAt: true } }, evidence: { take: 6, orderBy: { id: "asc" },
        include: { document: { select: { id: true, sha256: true, metadata: true, createdAt: true, updatedAt: true } } } } } });
    if (claims.length > MAX_CLAIMS) throw new GapError(413, "SCAN_TOO_LARGE", "Gap scans support at most 1000 extracted claims; no findings were changed");
    if (!claims.length) return { gaps: [], createdCount: 0, existingCount: 0, scannedClaimCount: 0 };
    // Validate exact quotes in PostgreSQL without transferring entire source documents.
    // Offsets use UTF-16 in extraction, so PostgreSQL's character offsets must not be substituted.
    const evidence = await tx.$queryRaw<{ id: string }[]>`
      SELECT e."id" FROM "ClaimEvidence" e
      JOIN "KnowledgeClaim" c ON c."id" = e."claimId" AND c."projectId" = e."projectId"
      JOIN "SourceDocument" d ON d."id" = e."documentId" AND d."projectId" = e."projectId"
      WHERE c."projectId" = ${projectId}::uuid AND c."id" IN (${Prisma.join(claims.map(claim => claim.id))})
      AND e."quote" = c."text" AND length(btrim(e."quote")) > 0 AND position(e."quote" IN d."content") > 0`;
    const valid = new Set(evidence.map(item => item.id));
    const grounded = claims.filter(claim => claim.text.length <= 2000 && claim.evidence.length > 0 && claim.evidence.length <= 5 && claim.evidence.every(item => valid.has(item.id)));
    const byId = new Map(grounded.map(claim => [claim.id, claim]));
    const candidates = detectKnowledgeGaps(grounded);
    if (candidates.length > MAX_FINDINGS) throw new GapError(413, "SCAN_TOO_LARGE", "Gap scan exceeds 200 findings; no findings were changed");
    const now = new Date();
    const gaps: Gap[] = [];
    let createdCount = 0;
    for (const candidate of candidates) {
      const existing = await tx.knowledgeGap.findUnique({ where: { projectId_fingerprint: { projectId, fingerprint: candidate.fingerprint } }, include });
      const links = candidate.claimIds.filter(id => !existing?.claimLinks.some(link => link.claimId === id)).map(claimId => {
        const claim = byId.get(claimId)!;
        return { claimId, provenance: {
          claimText: claim.text, claimType: claim.type, claimStatus: claim.status, claimCreatedAt: claim.createdAt.toISOString(),
          extraction: { runId: claim.runId, provider: claim.run.provider, model: claim.run.model, modelVersion: claim.run.modelVersion, createdAt: claim.run.createdAt.toISOString() },
          evidence: claim.evidence.map(item => ({ evidenceId: item.id, documentId: item.documentId, quote: item.quote,
            startOffset: item.startOffset, endOffset: item.endOffset, sha256: item.document.sha256, sourceMetadata: item.document.metadata,
            documentImportedAt: item.document.createdAt.toISOString() })),
        } satisfies Prisma.InputJsonObject };
      });
      if (existing) {
        // Preserve question, first provenance and human dispositions. Append only new claim links.
        gaps.push(links.length ? await tx.knowledgeGap.update({ where: { id: existing.id, projectId }, data: { claimLinks: { create: links } }, include }) : existing);
      } else {
        gaps.push(await tx.knowledgeGap.create({ data: { id: randomUUID(), projectId, category: candidate.category, question: candidate.question,
          fingerprint: candidate.fingerprint, provenance: { method: "deterministic_claim_rules", ruleVersion: "1", subject: candidate.subject, field: candidate.field,
            reason: candidate.reason, detectedAt: now.toISOString(), scannedById: userId,
            temporalPolicy: "Source dates are retained as supplied metadata, not verified event dates. Extraction/import times do not establish fact chronology. Findings express uncertainty." },
          claimLinks: { create: links } }, include }));
        createdCount++;
      }
    }
    return { gaps: gaps.map(serialize), createdCount, existingCount: gaps.length - createdCount, scannedClaimCount: grounded.length };
  };
  return db.$transaction ? db.$transaction(tx => run(tx), { timeout: 30_000 }) : run(db);
}

export function createGapsRouter(db: GapsDatabase) {
  const router = Router({ mergeParams: true });
  router.post<{ id: string }>("/scan", async (req, res) => {
    await membership(db, req.params.id, res.locals.auth.user.id, true);
    if (!z.object({}).strict().safeParse(req.body ?? {}).success) throw new GapError(400, "INVALID_INPUT", "Gap scans accept an empty request body");
    res.json(await scan(db, req.params.id, res.locals.auth.user.id));
  });
  router.get<{ id: string }>("/", async (req, res) => {
    await membership(db, req.params.id, res.locals.auth.user.id);
    const parsed = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
      status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]).optional(), category: z.enum(["MISSING_OWNER", "UNCLEAR_STATUS", "UNRESOLVED_DEPENDENCY", "POTENTIAL_CONFLICT"]).optional() }).strict().safeParse(req.query);
    if (!parsed.success) throw new GapError(400, "INVALID_INPUT", "Invalid gap filters or pagination");
    const { cursor, limit, status, category } = parsed.data;
    const gaps = await db.knowledgeGap.findMany({ where: { projectId: req.params.id, status, category, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: limit + 1, include });
    res.json({ gaps: gaps.slice(0, limit).map(serialize), nextCursor: gaps.length > limit ? gaps[limit - 1]!.id : null });
  });
  router.use("/:gapId/answers", createClarificationsRouter(db));
  router.get<{ id: string; gapId: string }>("/:gapId", async (req, res) => {
    await membership(db, req.params.id, res.locals.auth.user.id);
    if (!z.uuid().safeParse(req.params.gapId).success) throw new GapError(400, "INVALID_INPUT", "Invalid knowledge gap ID");
    const gap = await db.knowledgeGap.findFirst({ where: { id: req.params.gapId, projectId: req.params.id }, include });
    if (!gap) throw notFound();
    res.json({ gap: serialize(gap) });
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (error instanceof GapError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
