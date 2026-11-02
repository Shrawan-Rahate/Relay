# Supabase authentication implementation plan

Goal: exchange a server-validated, email-confirmed Supabase identity for an existing-format Relay session. Supabase owns credentials; Relay PostgreSQL owns users, projects, records and roles.

Design: exclusive `legacy` (default for compatibility) and `supabase` auth modes. Invalid modes or missing Supabase configuration fail startup. Supabase mode disables password login/registration, while existing Relay cookies remain valid. Validate each exchanged token with the configured Supabase `/auth/v1/user` endpoint, with bounded timeout and no redirects. Identity lookup uses only a unique immutable Supabase UUID. Email conflicts return 409 without updates or linking. Existing users require a separately reviewed identity migration; no email-based migration is provided.

Execution (in this worktree; no commits, pushes or production access):
- [x] Add HTTP tests for mode isolation, token rejection, confirmation, identity collisions, session lifecycle and project-scoped permissions; observe failure before implementation.
- [x] Add a forward-only nullable unique Supabase UUID and nullable password hash; preserve all existing IDs, relationships and sessions.
- [x] Implement server validation and atomic user/session provisioning with safe errors and existing origin, rate-limit and cookie policies.
- [x] Update auth documentation and shared API contracts; run all backend tests, typecheck and build.

Review focus: concurrent first sign-ins and email collisions; changed email for an already linked UUID; metadata role/verification spoofing; legacy password bypass for linked accounts; provider failures never mint sessions. New Supabase accounts have no memberships. No frontend, secret or unrelated route changes.

Review: independent read-only review found a same-UUID race between the UUID lookup and email precheck. A deterministic HTTP regression reproduced the false 409; recovery now re-queries only the immutable UUID. Real concurrent PostgreSQL insert tests cover same-UUID reuse and rejection of competing UUIDs sharing an email. No additional important security issues were reported.
