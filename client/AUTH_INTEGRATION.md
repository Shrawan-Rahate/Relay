# Live authentication and API integration boundary

Design: use the official Supabase browser SDK with PKCE for email/password identity, confirmation callbacks and resend. Only a successful backend exchange or `/api/auth/me` restores a Relay identity. Relay cookies remain HttpOnly. Supabase metadata and demo role selection never authorize a live project.

Execution:
- [x] Add behavioral tests for signup pending, confirmation/callback failure, verified exchange, restoration, logout failures, expiry, and project roles; observe missing behavior.
- [x] Add a shared credentialed API transport and auth controller/context. Use exclusive explicit demo/live mode; invalid or missing live configuration shows an actionable error.
- [x] Connect the existing auth form to live actions, retaining the demo form and theme. Add live project list/create/selection and role-derived navigation, without displaying workflow fixtures as live data.
- [x] Document environment names, callbacks, session semantics and the workflow integration boundary; run tests, typecheck and build.

API coordination: `src/lib/api.ts` owns credentialed Relay HTTP calls and typed errors. The auth controller owns identity and 401 invalidation; project/workflow consumers use the same transport, keep 403 as a permission error, and reload project membership. Workflow API integration can consume `useAuth()` and the backend-returned `Project`/role; it must not instantiate another auth client, exchange tokens itself, send Supabase credentials to project routes, or reuse demo fixtures. Existing workflow previews remain available only in explicit DEMO mode. Live workflow pages show a clear integration boundary until their data is connected.

Scope: client auth/project navigation plus integration docs only. No backend behavior, database operations, secrets, deployments, commits or pushes.

## Client configuration

Set `VITE_SUPABASE_URL` to the Supabase project origin and `VITE_SUPABASE_PUBLISHABLE_KEY` to its publishable key (a legacy anon key is also accepted). Both are public browser configuration. Never place a Supabase secret key, service-role key, database URL, or any server credential in a `VITE_` variable. Runtime and build-time validation reject known secret/service-role key forms before the browser bundle is generated. Only the named public configuration is read by the runtime. `VITE_RELAY_MODE=live` is the default; `demo` explicitly opts into isolated previews. No missing/invalid config falls back to fake auth.

`VITE_API_ORIGIN` is optional. Leave it empty to call `/api` on the same origin. The Vite dev server proxies `/api` to `http://localhost:4000`. A production host must provide its own same-origin API proxy, or set this variable to the backend origin. Origins require HTTPS, except loopback HTTP for local development. Vite variables are build-time configuration; restart dev/rebuild after changes.

## Required backend setup

- `RELAY_AUTH_MODE=supabase` enables only the Supabase session exchange and disables legacy credential endpoints.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must match the client's Supabase project. Do not change projects without a reviewed identity migration.
- `DATABASE_URL` remains the Relay PostgreSQL connection, entirely server-side. Existing identity migrations must already be applied through normal review; this client change runs no database migrations or resets.
- `CLIENT_ORIGIN` must exactly match the browser origin (default `http://localhost:5173`), including scheme and port.
- `NODE_ENV=production` makes Relay session cookies Secure; `PORT` is optional (default `4000`). `SHADOW_DATABASE_URL` is needed by the Prisma CLI configuration when running migration tooling, not by browser auth.

Relay uses HttpOnly, SameSite=Lax cookies scoped to `/api`. Deploy the frontend and API same-site (prefer a same-origin proxy); CORS alone cannot make a cross-site Lax cookie work. All Relay calls use `credentials: include`; project requests never carry Supabase tokens. No backend env values or secret keys are exposed in these docs.

## Confirmation and session behavior

Enable email/password and email confirmation in Supabase. Configure its Site URL and add the exact client redirect URL to the Auth redirect allowlist: for local Vite, `http://localhost:5173/?auth_callback=1`; for other hosts/base paths, use that origin and path with `?auth_callback=1`. Keep the Supabase confirmation template using the provider confirmation URL so verification completes before redirect. The SDK uses PKCE. The callback consumes only a provider-issued `code` (and optional `sb_flow_id`), exchanges it with Supabase, then exchanges the confirmed access token with Relay. Query flags or user metadata never confirm an email. Callback credentials/errors are removed from the address bar; expired/missing codes, missing verifier or opening a different browser result in an actionable error. Users can then sign in with their password after confirming, or request a new confirmation email. Implicit token fragments are not accepted as a substitute for PKCE.

Signup without a Supabase session displays pending confirmation and a non-enumerating message; it never claims an account was created or an email was delivered. Resend reports only that the request succeeded, not that verification occurred. The optional name is profile metadata, never a project role. Backend `409 IDENTITY_CONFLICT` requires administrator review; no email-based linking is attempted.

Relay identity comes only from the exchange response or `/api/auth/me`. The SDK manages its own access/refresh session in browser storage and auto-refreshes it; Relay cookies remain inaccessible to JavaScript. Only the access token is sent to the exchange. Reload restores the Relay cookie via `/me`, not a stored identity or local role. Focus/visibility and a 60-second check revalidate Relay auth; ordinary protected API 401s immediately hide identity/content. A Relay session expiry requires sign-in; Supabase refresh does not silently renew it. Verification/refresh failures show retry states rather than fake success.

Sign-out hides protected content immediately, waits for pending auth exchanges, revokes the Relay session, and signs out the current Supabase session (`scope: local`). Both must succeed before the UI reports success; failures offer sign-out retry. Other-tab Supabase sign-out also triggers Relay logout, including during an exchange. Auth operations are serialized independently of UI state. Session epochs prevent old workflow 401s from unlocking a newer sign-in. Failed callbacks do not restore an unrelated cookie as callback success; a later ordinary reload may still restore a previously existing Relay cookie, under the documented `/me` contract.

## Workflow integration contract

Use the provided `AuthProvider` and `useAuth()`; do not create a second Supabase client or an independent identity store. The controller owns all credential/callback/exchange/logout operations. `api.request<T>(path, init)` is the only shared Relay transport, handles timeouts/204/non-JSON errors and strips Authorization headers. `401` invalidates current identity; `403` remains a permission error and should trigger a displayed error plus `refreshAccess()` to reload roles. Handle 404 as an inaccessible/removed project resource. Do not retry mutations automatically.

`LiveApp` accepts `renderProjectPage(context)`, where context has the backend `Project` (including current `role`), page, shared API instance and `refreshAccess`. It calls this renderer only after membership and page-role checks; the server remains authoritative for every action. Clear project-specific data on project/identity changes and on errors, and avoid retaining reviewer-only cached data after role changes. The current live shell refreshes memberships on focus and every 60 seconds; manual Refresh access is available. No role selector or DEMO bypass exists in the live shell. Demo workflow fixtures and local request previews belong solely to `DemoApp`.

## Verification and live-test limits

`npm test` runs the existing theme tests plus controller, SDK-boundary, transport/config and rendered navigation tests. Supabase SDK calls are real, with external HTTP responses simulated; no live signup, email delivery, hosted callback, or production cookie flow is claimed by these tests. Live end-to-end testing needs the running Supabase-mode backend, a reachable matching project, allowed callback URLs, and a test mailbox/password. No live account is created by this implementation.

Independent review found stale-401/exchange ordering and provider-sign-out-during-exchange races; both were reproduced by deferred HTTP tests and fixed with auth serialization, session scoping and post-exchange revocation.

Final local verification: 30 client tests passed (6 existing theme tests and 24 auth/config/transport/navigation tests), typecheck passed, and production build passed. Build retains a bundle-size advisory. A separate negative build check rejected a test `sb_secret_` credential before bundling. No backend source changes, database operations, deployment, commits or pushes were performed. Existing Vite/CSS dependency audit advisories remain outside this auth change; the newly added test runner was upgraded to its current patched release after audit.
