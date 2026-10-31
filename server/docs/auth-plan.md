# Backend authentication implementation plan

Goal: implement registration, login, logout, and current-user endpoints in the existing Express API.

Constraints: server-only changes; no destructive SQL, resets, commits, or pushes; only Relay databases. The current schema already supports password hashes and expiring, revocable sessions, so no migration is planned.

Design: retain Express/Prisma and extract an app factory from the listener for HTTP tests. Use Argon2id (64 MiB, three iterations, one lane); 32-byte random bearer tokens with only SHA-256 digests persisted; seven-day HttpOnly, SameSite=Lax cookies, Secure in production. Validate inputs with Zod, normalize email, limit auth attempts per IP, reject foreign browser origins on state-changing auth requests, and suppress internal errors. PostgreSQL unique constraints handle registration races.

Execution:
- [x] Write real HTTP integration tests for registration/login/me, hashes, invalid credentials, validation, duplicate accounts, cookies, expiry, revocation, logout, protected middleware, safe errors, origin checks, and rate limits. Run against the existing app to observe missing auth behavior.
- [x] Install pinned Argon2, cookie-parser, express-rate-limit, and Supertest dependencies. Add test/typecheck configuration.
- [x] Implement auth router and authentication middleware; minimally extract createApp and keep the listener/health behavior.
- [x] Run the auth suite against local relay_dev in individually rolled-back transactions. Verify no persisted fixtures and no schema changes.
- [x] Run typecheck/build, obtain an independent review, fix material findings with regression tests, and report results.

Test isolation: each HTTP scenario uses a real Prisma transaction with injected delegates and a deliberate rollback sentinel. Tests validate the local relay_dev URL before connecting, never query other databases, and never delete records. Inject a clock for deterministic expiration. Typechecking includes tests and Prisma config separately from the production build.

Review focus: session cookie replay after logout; expired/revoked/malformed tokens; case-normalized duplicate emails and unique races; timing and error disclosure for unknown users; spoofed forwarded headers and cross-origin state changes.

Review result: independent read-only review found no critical or important issues. Rate limits use single-process memory, appropriate for the hackathon deployment; shared multi-instance limits and expired-session cleanup remain future operational work.
