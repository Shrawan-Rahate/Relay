import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { createAuthMiddleware, type AuthDatabase, type AuthOptions } from "./auth.js";
import { type Prisma } from "./generated/prisma/client.js";
import { createSourcesRouter, type SourcesDatabase } from "./sources.js";
import type { GitHubOptions } from "./github.js";

type ProjectStore = Pick<Prisma.TransactionClient, "project" | "projectMember" | "user" | "$queryRaw">;
export type ProjectsDatabase = AuthDatabase & ProjectStore & SourcesDatabase;

const projectInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
}).strict();
const memberInput = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  role: z.enum(["REVIEWER", "OUTGOING", "INCOMING"]),
}).strict();
const memberSelect = {
  id: true, projectId: true, userId: true, role: true, createdAt: true, updatedAt: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.ProjectMemberSelect;

class ProjectError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const notFound = () => new ProjectError(404, "NOT_FOUND", "Project or membership not found");

async function membership(db: ProjectStore, projectId: string, userId: string) {
  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } }, include: { project: true },
  });
  if (!member) throw notFound();
  return member;
}

function requireReviewer(role: string) {
  if (role !== "REVIEWER") throw new ProjectError(403, "FORBIDDEN", "Reviewer role required");
}

async function withReviewerLock<T>(db: ProjectsDatabase, projectId: string, userId: string, work: (tx: ProjectStore) => Promise<T>): Promise<T> {
  const run = async (tx: ProjectStore) => {
    // Serialize all membership mutations per project, including authorization.
    // This prevents concurrent reviewer removals from both passing the count check.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound();
    requireReviewer((await membership(tx, projectId, userId)).role);
    return work(tx);
  };
  // Interactive transactions already provide the enclosing boundary in tests.
  return db.$transaction ? db.$transaction(tx => run(tx)) : run(db);
}

export function createProjectsRouter(db: ProjectsDatabase, options: AuthOptions & GitHubOptions = {}) {
  const router = Router();
  const clientOrigin = options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(createAuthMiddleware(db, options));
  router.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("Origin") && req.get("Origin") !== clientOrigin) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed" } });
      return;
    }
    next();
  });
  for (const name of ["id", "memberId"]) {
    router.param(name, (_req, res, next, value: string) => {
      if (!z.string().uuid().safeParse(value).success) {
        res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid project or member id" } });
        return;
      }
      next();
    });
  }

  router.use("/:id/sources", createSourcesRouter(db, options));

  router.post("/", async (req, res) => {
    const parsed = projectInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid project details" } });
      return;
    }
    const { members, ...project } = await db.project.create({
      data: { ...parsed.data, members: { create: { userId: res.locals.auth.user.id, role: "REVIEWER" } } },
      include: { members: { select: { role: true } } },
    });
    res.status(201).json({ project: { ...project, role: members[0]!.role } });
  });

  router.get("/", async (_req, res) => {
    const memberships = await db.projectMember.findMany({
      where: { userId: res.locals.auth.user.id }, include: { project: true },
      orderBy: [{ project: { createdAt: "desc" } }, { id: "asc" }],
    });
    res.json({ projects: memberships.map(({ project, role }) => ({ ...project, role })) });
  });

  router.get("/:id", async (req, res) => {
    const member = await membership(db, req.params.id, res.locals.auth.user.id);
    res.json({ project: { ...member.project, role: member.role } });
  });

  router.get("/:id/members", async (req, res) => {
    requireReviewer((await membership(db, req.params.id, res.locals.auth.user.id)).role);
    const members = await db.projectMember.findMany({ where: { projectId: req.params.id }, select: memberSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    res.json({ members });
  });

  router.post("/:id/members", async (req, res) => {
    const parsed = memberInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid member details" } });
      return;
    }
    const { email, role } = parsed.data;
    const member = await withReviewerLock(db, req.params.id, res.locals.auth.user.id, async tx => {
      const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) throw new ProjectError(404, "USER_NOT_FOUND", "Registered user not found");
      // On conflict, never update an existing role (including the caller's role).
      const inserted = await tx.projectMember.createMany({ data: { projectId: req.params.id, userId: user.id, role }, skipDuplicates: true });
      if (!inserted.count) throw new ProjectError(409, "MEMBERSHIP_EXISTS", "User is already a project member");
      return tx.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: req.params.id, userId: user.id } }, select: memberSelect });
    });
    res.status(201).json({ member });
  });

  router.delete("/:id/members/:memberId", async (req, res) => {
    await withReviewerLock(db, req.params.id, res.locals.auth.user.id, async tx => {
      const member = await tx.projectMember.findFirst({ where: { id: req.params.memberId, projectId: req.params.id } });
      if (!member) throw notFound();
      if (member.role === "REVIEWER" && await tx.projectMember.count({ where: { projectId: req.params.id, role: "REVIEWER" } }) <= 1) {
        throw new ProjectError(409, "LAST_REVIEWER", "Project must retain at least one reviewer");
      }
      await tx.projectMember.deleteMany({ where: { id: member.id, projectId: req.params.id } });
    });
    res.sendStatus(204);
  });

  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (error instanceof ProjectError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
