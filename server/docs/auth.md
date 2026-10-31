# Authentication API

| Method | Route | JSON body | Success |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `email`, `password`, optional `name` | 201, `{ user }`, session cookie |
| POST | `/api/auth/login` | `email`, `password` | 200, `{ user }`, session cookie |
| POST | `/api/auth/logout` | none | 204, current session revoked and cookie cleared |
| GET | `/api/auth/me` | none | 200, `{ user }`; 401 if unauthenticated |

Public user fields: `id`, `email`, `name`, `createdAt`. Errors use `{ error: { code, message } }`; internal diagnostics and hashes are never returned. Registration returns 409 for duplicate normalized email. Unknown fields and invalid bodies return 400. Login failures return the same 401 response for unknown email and wrong password.

Emails are trimmed and lowercased. Registration passwords must be 12–128 characters; passwords are never trimmed. Names are optional, trimmed, and limited to 100 characters. Passwords use Argon2id with 64 MiB memory, three iterations, and one lane.

Sessions last seven days and use 32 cryptographically random bytes. Only SHA-256 token hashes are stored. The `relay_session` cookie has Path `/api`, HttpOnly, SameSite=Lax, and Secure when `NODE_ENV=production`. Logout is idempotent and revokes only the current session. Expired or revoked sessions cannot authenticate.

Browser requests must include credentials (`credentials: "include"`). Set `CLIENT_ORIGIN` to the exact frontend origin. Auth responses use `Cache-Control: no-store`; foreign browser origins cannot make state-changing auth requests. Add `createAuthMiddleware(db)` after the app's cookie parser to protect further routes; authenticated user/session context is available in `res.locals.auth`.

Login permits ten attempts per IP per 15 minutes; registration permits ten per hour. Limits use process-local memory and the actual peer IP. Proxy headers are not trusted. A deployment behind a proxy needs an explicit trusted-proxy policy; multiple processes need shared rate-limit storage.

Run `npm test` from `server/` with local `relay_dev` available and migrated. Tests enforce the local database target, exercise real HTTP/Prisma behavior, roll back each scenario, and verify no test users or sessions persist. `npm run typecheck` includes tests and Prisma config; `npm run build` compiles production sources. No additional schema migration is needed for authentication.
