# Authentication API

| Method | Route | JSON body | Success |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `email`, `password`, optional `name` | 201, `{ user }`, session cookie |
| POST | `/api/auth/login` | `email`, `password` | 200, `{ user }`, session cookie |
| POST | `/api/auth/supabase-session` | `accessToken` | 200, `{ user }`, session cookie |
| POST | `/api/auth/logout` | none | 204, current session revoked and cookie cleared |
| GET | `/api/auth/me` | none | 200, `{ user }`; 401 if unauthenticated |

Public user fields: `id`, `email`, `name`, `createdAt`. Errors use `{ error: { code, message } }`; internal diagnostics and hashes are never returned. Registration returns 409 for duplicate normalized email. Unknown fields and invalid bodies return 400. Login failures return the same 401 response for unknown email and wrong password.

Emails are trimmed and lowercased. Registration passwords must be 12–128 characters; passwords are never trimmed. Names are optional, trimmed, and limited to 100 characters. Passwords use Argon2id with 64 MiB memory, three iterations, and one lane.

Sessions last seven days and use 32 cryptographically random bytes. Only SHA-256 token hashes are stored. The `relay_session` cookie has Path `/api`, HttpOnly, SameSite=Lax, and Secure when `NODE_ENV=production`. Logout is idempotent and revokes only the current session. Expired or revoked sessions cannot authenticate.

Browser requests must include credentials (`credentials: "include"`). Set `CLIENT_ORIGIN` to the exact frontend origin. Auth responses use `Cache-Control: no-store`; foreign browser origins cannot make state-changing auth requests. Add `createAuthMiddleware(db)` after the app's cookie parser to protect further routes; authenticated user/session context is available in `res.locals.auth`.

Login/session exchange permit ten attempts per IP per 15 minutes; registration permits ten per hour. Limits use process-local memory and the actual peer IP. Proxy headers are not trusted. A deployment behind a proxy needs an explicit trusted-proxy policy; multiple processes need shared rate-limit storage.

Auth modes are exclusive: `RELAY_AUTH_MODE=legacy` (default for compatibility) enables only register/login; `RELAY_AUTH_MODE=supabase` enables only session exchange. Disabled credential endpoints return `404 AUTH_MODE_DISABLED`. Unknown modes fail startup. Supabase mode requires `SUPABASE_URL` (the project origin) and `SUPABASE_PUBLISHABLE_KEY` (the publishable/anon key, never a service-role key); missing/invalid configuration fails startup without falling back to legacy. HTTPS is required except loopback HTTP in development. Configure Supabase email/password auth with email confirmation enabled. Relay receives no Supabase passwords or refresh tokens. No configuration secrets are included here.

Session exchange accepts only `{accessToken: string}`, 1–16,384 token characters, and calls the configured `/auth/v1/user` using the token and publishable key. Redirects are prohibited and verification times out after five seconds. This follows [Supabase's server-side user validation guidance](https://supabase.com/docs/reference/javascript/auth-getuser). Relay requires an authenticated, non-anonymous UUID identity, valid email and `email_confirmed_at`; user metadata such as `email_verified`, name or role is ignored. Forged/expired/invalid identities return `401 INVALID_CREDENTIALS`, unconfirmed email returns `403 EMAIL_UNVERIFIED`, and upstream/network failures return `503 AUTH_UNAVAILABLE`. No failed exchange issues a cookie.

Identity is mapped solely through unique `User.supabaseUserId`. First exchange atomically creates the Relay user and Relay session, with no password hash or memberships. A conflicting normalized email returns `409 IDENTITY_CONFLICT`; it never links, merges or changes existing records. Concurrent provisioning is protected by database uniqueness. A previously linked UUID keeps its Relay user ID, stored contact email, records and memberships even if the provider email changes. Supabase roles/metadata cannot confer Relay project roles. Existing users require a separate, reviewed migration that independently proves both identities and preserves the Relay ID; no automatic backfill or public linking route is supplied. Do not repoint `SUPABASE_URL` to another project without an identity migration: UUIDs are scoped to the configured Supabase project.

All auth modes retain the seven-day HttpOnly Relay session flow and existing sessions. Linked accounts cannot use their old Relay password even in legacy mode. Supabase expiration/revocation is checked on exchange; it does not retroactively revoke an already-issued Relay cookie. Relay logout/revocation and expiry remain authoritative for those sessions, and Relay logout does not end the Supabase session. Protected routes still accept only Relay cookies.

The forward-only `20261102000000_supabase_identity` migration adds a nullable unique UUID and relaxes the password hash to nullable. It preserves all existing rows, IDs, sessions and foreign keys; it does not migrate identity by email. Apply via the normal reviewed deployment process before enabling Supabase mode; no production migration is part of this change.

Run `npm test` from `server/` with local `relay_dev` available and migrated. Tests enforce the local database target, exercise real HTTP/Prisma behavior, roll back scenarios (concurrency fixtures use scoped cleanup), and verify no test records persist. Supabase responses are simulated at the external HTTP boundary, covering rejection/verification and network failure without live credentials. `npm run typecheck` includes tests and Prisma config; `npm run build` compiles production sources.
