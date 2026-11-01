import { randomUUID } from "node:crypto";
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { readUpload } from "./uploads.js";
import { IngestionError, prepareImport } from "./ingestion.js";
import { parseGitHubInput, prepareGitHubImport, type GitHubOptions } from "./github.js";

type SourceStore = Pick<Prisma.TransactionClient, "source" | "sourceDocument" | "projectMember" | "$queryRaw">;
export type SourcesDatabase = SourceStore & Partial<Pick<PrismaClient, "$transaction">>;
const notFound = () => new IngestionError(404, "NOT_FOUND", "Source or project not found");
const summary = {
  id: true, projectId: true, importedById: true, type: true, filename: true, sha256: true, byteSize: true,
  metadata: true, provenance: true, createdAt: true, updatedAt: true, _count: { select: { documents: true } },
} satisfies Prisma.SourceSelect;

async function membership(db: SourceStore, projectId: string, userId: string) {
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!member) throw notFound();
  return member;
}

export function createSourcesRouter(db: SourcesDatabase, options: GitHubOptions = {}) {
  // Mounted inside the project router: inherits auth, origin checks, and project-id validation.
  const router = Router({ mergeParams: true });
  router.param("sourceId", (_req, res, next, value: string) => {
    if (!z.string().uuid().safeParse(value).success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid source id" } });
      return;
    }
    next();
  });

  router.post<{ id: string }>("/github", async (req, res) => {
    const projectId = req.params.id;
    const userId = res.locals.auth.user.id as string;
    const checkRole = async (tx: SourceStore) => {
      const member = await membership(tx, projectId, userId);
      if (member.role !== "REVIEWER" && member.role !== "OUTGOING") throw new IngestionError(403, "FORBIDDEN", "Reviewer or outgoing role required");
    };
    await checkRole(db);
    const repository = parseGitHubInput(req.body);
    // Network work happens outside the database transaction and project lock.
    const { documents, ...data } = await prepareGitHubImport(repository, options);
    const run = async (tx: SourceStore) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
      if (!rows.length) throw notFound();
      await checkRole(tx);
      const id = randomUUID();
      const created = await tx.source.createMany({ data: { id, projectId, importedById: userId, ...data }, skipDuplicates: true });
      if (!created.count) throw new IngestionError(409, "SOURCE_EXISTS", "This content is already imported in the project");
      if (documents.length) await tx.sourceDocument.createMany({ data: documents.map(document => ({ ...document, sourceId: id, projectId })) });
      return tx.source.findUniqueOrThrow({ where: { id }, include: { documents: { orderBy: { position: "asc" } } } });
    };
    const source = db.$transaction ? await db.$transaction(tx => run(tx)) : await run(db);
    res.status(201).json({ source });
  });

  router.post<{ id: string }>("/", async (req, res) => {
    const projectId = req.params.id!;
    const userId = res.locals.auth.user.id as string;
    const multipart = req.is("multipart/form-data");
    let body = req.body;
    if (multipart) {
      const member = await membership(db, projectId, userId);
      if (member.role !== "REVIEWER" && member.role !== "OUTGOING") {
        throw new IngestionError(403, "FORBIDDEN", "Reviewer or outgoing role required");
      }
      body = await readUpload(req);
    }
    const run = async (tx: SourceStore) => {
      // Shares the membership mutation lock: removal cannot race the import's role check.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
      if (!rows.length) throw notFound();
      const member = await membership(tx, projectId, userId);
      if (member.role !== "REVIEWER" && member.role !== "OUTGOING") {
        throw new IngestionError(403, "FORBIDDEN", "Reviewer or outgoing role required");
      }
      const { documents, ...data } = prepareImport(body);
      if (multipart) data.provenance.method = "file_upload";
      const id = randomUUID();
      // Database uniqueness, including parallel imports, without aborting the transaction on conflict.
      const created = await tx.source.createMany({ data: { id, projectId, importedById: userId, ...data }, skipDuplicates: true });
      if (!created.count) throw new IngestionError(409, "SOURCE_EXISTS", "This content is already imported in the project");
      await tx.sourceDocument.createMany({ data: documents.map(document => ({ ...document, sourceId: id, projectId })) });
      return tx.source.findUniqueOrThrow({ where: { id }, include: { documents: { orderBy: { position: "asc" } } } });
    };
    const source = db.$transaction ? await db.$transaction(tx => run(tx)) : await run(db);
    res.status(201).json({ source });
  });

  router.get<{ id: string }>("/", async (req, res) => {
    const projectId = req.params.id!;
    await membership(db, projectId, res.locals.auth.user.id);
    const sources = await db.source.findMany({
      where: { projectId, project: { members: { some: { userId: res.locals.auth.user.id } } } },
      select: summary, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    res.json({ sources });
  });

  router.get<{ id: string; sourceId: string }>("/:sourceId", async (req, res) => {
    const source = await db.source.findFirst({
      where: { id: req.params.sourceId, projectId: req.params.id!, project: { members: { some: { userId: res.locals.auth.user.id } } } },
      include: { documents: { orderBy: { position: "asc" } } },
    });
    if (!source) throw notFound();
    res.json({ source });
  });

  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (error instanceof IngestionError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
