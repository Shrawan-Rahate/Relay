import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { Router, type CookieOptions, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Prisma, type PrismaClient } from "./generated/prisma/client.js";
import { createSupabaseVerifier, SupabaseAuthError, type SupabaseAuthOptions } from "./supabase-auth.js";

export type AuthDatabase = Pick<PrismaClient, "user" | "authSession">;
export type AuthOptions = {
  now?: () => Date; production?: boolean; clientOrigin?: string;
  authMode?: "legacy" | "supabase";
  supabase?: SupabaseAuthOptions;
};

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = "relay_session";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const passwordOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;
const publicUser = { id: true, email: true, name: true, createdAt: true } satisfies Prisma.UserSelect;
const email = z.string().trim().toLowerCase().max(254).email();
const loginInput = z.object({ email, password: z.string().min(1).max(128) }).strict();
const supabaseInput = z.object({ accessToken: z.string().min(1).max(16384).regex(/^[A-Za-z0-9._~-]+$/) }).strict();
const registerInput = loginInput.extend({
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(100).optional(),
});
let dummyPasswordHash: Promise<string> | undefined;

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(options: AuthOptions): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: options.production ?? process.env.NODE_ENV === "production", path: "/api" };
}

function sessionToken(cookies: unknown): string | undefined {
  if (!cookies || typeof cookies !== "object") return;
  const token = (cookies as Record<string, unknown>)[COOKIE];
  return typeof token === "string" && TOKEN_PATTERN.test(token) ? token : undefined;
}

function newSession(now: Date) {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: digest(token), expiresAt: new Date(now.getTime() + SESSION_MS) };
}

export function createAuthMiddleware(db: AuthDatabase, options: AuthOptions = {}): RequestHandler {
  const now = options.now ?? (() => new Date());
  return async (req, res, next) => {
    const token = sessionToken(req.cookies);
    const session = token ? await db.authSession.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: { select: publicUser } },
    }) : null;
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now().getTime()) {
      res.clearCookie(COOKIE, cookieOptions(options));
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
      return;
    }
    res.locals.auth = { user: session.user, sessionId: session.id };
    next();
  };
}

export function createAuthRouter(db: AuthDatabase, options: AuthOptions = {}) {
  const router = Router();
  const mode = options.authMode ?? process.env.RELAY_AUTH_MODE ?? "legacy";
  if (mode !== "legacy" && mode !== "supabase") throw new Error("Invalid RELAY_AUTH_MODE");
  const verifySupabase = mode === "supabase" ? createSupabaseVerifier(options.supabase ?? {
    url: process.env.SUPABASE_URL ?? "", publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
  }, options.production ?? process.env.NODE_ENV === "production") : undefined;
  const requireMode = (expected: typeof mode): RequestHandler => (_req, res, next) => {
    if (mode !== expected) {
      res.status(404).json({ error: { code: "AUTH_MODE_DISABLED", message: "Authentication method is disabled" } });
      return;
    }
    next();
  };
  const now = options.now ?? (() => new Date());
  const clientOrigin = options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
  const cookies = cookieOptions(options);
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // The app does not trust proxy headers: key by the actual peer IP.
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
  });
  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
  });

  router.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("Origin") && req.get("Origin") !== clientOrigin) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed" } });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/register", requireMode("legacy"), registrationLimiter, async (req, res) => {
    const parsed = registerInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid registration details" } });
      return;
    }
    const { email, password, name } = parsed.data;
    const passwordHash = await argon2.hash(password, passwordOptions);
    const session = newSession(now());
    try {
      // Nested creation keeps account and session creation atomic.
      const user = await db.user.create({
        data: { email, passwordHash, name, sessions: { create: { tokenHash: session.tokenHash, expiresAt: session.expiresAt } } },
        select: publicUser,
      });
      res.cookie(COOKIE, session.token, { ...cookies, maxAge: SESSION_MS });
      res.status(201).json({ user });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        res.status(409).json({ error: { code: "REGISTRATION_FAILED", message: "Unable to register with those details" } });
        return;
      }
      throw error;
    }
  });

  router.post("/login", requireMode("legacy"), loginLimiter, async (req, res) => {
    const parsed = loginInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid login details" } });
      return;
    }
    const { email, password } = parsed.data;
    const user = await db.user.findUnique({ where: { email } });
    // Unknown accounts still pay for Argon2 verification.
    const legacyHash = user && !user.supabaseUserId ? user.passwordHash : null;
    if (!legacyHash) dummyPasswordHash ??= argon2.hash(randomBytes(32), passwordOptions);
    const valid = await argon2.verify(legacyHash ?? await dummyPasswordHash!, password);
    if (!user || !legacyHash || !valid) {
      res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } });
      return;
    }
    const session = newSession(now());
    await db.authSession.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
    res.cookie(COOKIE, session.token, { ...cookies, maxAge: SESSION_MS });
    res.json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } });
  });

  router.post("/supabase-session", requireMode("supabase"), loginLimiter, async (req, res) => {
    const parsed = supabaseInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid session exchange details" } });
      return;
    }
    try {
      const identity = await verifySupabase!(parsed.data.accessToken);
      const session = newSession(now());
      const sessionData = { tokenHash: session.tokenHash, expiresAt: session.expiresAt };
      let user = await db.user.findUnique({ where: { supabaseUserId: identity.id }, select: publicUser });
      let sessionCreated = false;
      if (!user) {
        const conflict = () => new SupabaseAuthError(409, "IDENTITY_CONFLICT", "Identity cannot be provisioned; account review required");
        // Email is contact information, never proof that two identities are one.
        if (await db.user.findUnique({ where: { email: identity.email }, select: { id: true } })) {
          // Another request may have provisioned this UUID between lookups.
          user = await db.user.findUnique({ where: { supabaseUserId: identity.id }, select: publicUser });
          if (!user) throw conflict();
        }
        if (!user) {
          try {
            user = await db.user.create({ data: {
              supabaseUserId: identity.id, email: identity.email,
              sessions: { create: sessionData },
            }, select: publicUser });
            sessionCreated = true;
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
            // Concurrent first exchanges may race. Only the same immutable ID can
            // reuse the winner; an email conflict must never acquire its account.
            user = await db.user.findUnique({ where: { supabaseUserId: identity.id }, select: publicUser });
            if (!user) throw conflict();
          }
        }
      }
      if (!sessionCreated) {
        await db.authSession.create({ data: { userId: user.id, ...sessionData } });
      }
      res.cookie(COOKIE, session.token, { ...cookies, maxAge: SESSION_MS });
      res.json({ user });
    } catch (error) {
      if (!(error instanceof SupabaseAuthError)) throw error;
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
  });

  router.post("/logout", async (req, res) => {
    const token = sessionToken(req.cookies);
    if (token) {
      await db.authSession.updateMany({ where: { tokenHash: digest(token), revokedAt: null }, data: { revokedAt: now() } });
    }
    res.clearCookie(COOKIE, cookies);
    res.sendStatus(204);
  });

  router.get("/me", createAuthMiddleware(db, options), (_req, res) => {
    res.json({ user: res.locals.auth.user });
  });
  return router;
}
