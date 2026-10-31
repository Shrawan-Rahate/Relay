import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createAuthRouter, type AuthOptions } from "./auth.js";
import { createProjectsRouter, type ProjectsDatabase } from "./projects.js";

export function createApp(db: ProjectsDatabase, options: AuthOptions = {}) {
  const app = express();
  const clientOrigin = options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: clientOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api/auth", createAuthRouter(db, { ...options, clientOrigin }));
  app.use("/api/projects", createProjectsRouter(db, { ...options, clientOrigin }));
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "relay-api", timestamp: new Date().toISOString() });
  });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) { _next(error); return; }
    const type = error && typeof error === "object" && "type" in error ? error.type : undefined;
    if (type === "entity.parse.failed" || type === "entity.too.large") {
      res.status(type === "entity.too.large" ? 413 : 400).json({ error: { code: "INVALID_INPUT", message: "Invalid request body" } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to complete request" } });
  };
  app.use(errorHandler);
  return app;
}
