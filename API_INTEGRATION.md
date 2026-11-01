# Relay frontend API integration

Contract source: the current routers/serializers in `server/src/{app,auth,projects,sources,extractions,gaps,clarifications,reviews,handovers}.ts`, `evidence.ts`, `review-state.ts`, and scalar fields in `server/prisma/schema.prisma`. Wire types and the full endpoint map are in [shared/api-types.ts](shared/api-types.ts). They are standalone browser types, without Prisma or server imports; they do not validate runtime JSON.

## Transport and session

Default API origin: `http://localhost:4000` (`PORT` can override). Prefix `/api`; no version prefix. UUIDs are strings; dates are ISO strings, never JavaScript `Date` objects. JSON requests use `Content-Type: application/json`; validated object schemas reject unknown body fields. JSON parser limit is 1 MiB. Success bodies are endpoint-specific wrappers, not a common `data` envelope. On `204`, do not call `response.json()`.

Use `credentials: "include"` for fetch. Register/login set `relay_session`, an HttpOnly, SameSite=Lax cookie scoped to `/api`, lasting seven days; Secure in production. JavaScript must not read/store its value. There is no bearer token, refresh endpoint, or CSRF-token endpoint. `/auth/me` restores the current user; `401` on protected routes clears the cookie. Logout revokes that session and returns `204`, including when no session exists.

CORS allows credentials for `CLIENT_ORIGIN` (default `http://localhost:5173`). Auth/project mutations reject a supplied foreign `Origin` with `403`. Use a same-site deployment or proxy compatible with the Lax cookie; CORS alone does not permit cross-site cookies. Auth/project data uses `Cache-Control: no-store` (origin rejection occurs before this header in auth routes).

```ts
import type { ApiResponse } from "./shared/api-types";
const response = await fetch(`${apiOrigin}/api/projects`, { credentials: "include" });
if (!response.ok) throw await response.json();
const { projects } = await response.json() as ApiResponse<"GET /api/projects">;
```

## Endpoint inventory

Paths below are relative to `/api`. `P` = `/projects/:id`; `A` = `P/gaps/:gapId/answers/:answerId`. Role keys: **U** authenticated user; **M** any project member; **R** reviewer; **O** outgoing; **I** incoming. Outsiders generally receive `404`, while members with the wrong role receive `403`. IDs and evidence must belong to the specified project. All success statuses are `200` unless shown.

| Method and path | Access | Request → success body / shared type |
| --- | --- | --- |
| GET `/health` | Public | `{status:"ok", service:"relay-api", timestamp}` |
| POST `/auth/register` | Public | `RegisterRequest` → `201 {user: User}` |
| POST `/auth/login` | Public | `LoginRequest` → `{user: User}` |
| POST `/auth/logout` | Public | No body → `204` |
| GET `/auth/me` | U | `{user: User}` |
| POST `/projects` | U | `CreateProjectRequest` → `201 {project: Project}`; creator becomes R |
| GET `/projects` | U | `{projects: Project[]}`; only own memberships |
| GET `P` | M | `{project: Project}`; includes caller's `role` |
| GET `P/members` | R | `{members: ProjectMember[]}` |
| POST `P/members` | R | `AddMemberRequest` → `201 {member: ProjectMember}`; email must already be registered |
| DELETE `P/members/:memberId` | R | No body → `204`; cannot remove last reviewer |
| POST `P/sources` | R/O | `ImportSourceRequest` **or** multipart → `201 {source: Source}` |
| POST `P/sources/github` | R/O | `{repository:"owner/repo"}` → `201 {source: Source}`; public repositories only |
| GET `P/sources` | M | `{sources: SourceSummary[]}`; count only, no original text/documents |
| GET `P/sources/:sourceId` | M | `{source: Source}`; includes original text and ordered documents |
| GET `P/sources/:sourceId/documents/:documentId` | M | `{document: SourceDocument}` |
| POST `P/extractions` | R/O | `{documentIds: UUID[]}` → `201 {run: ExtractionRunDetail}` |
| GET `P/extractions/:runId` | M | `{run: ExtractionRunDetail}` |
| GET `P/claims` | M | `{claims: ListedClaim[], nextCursor}` |
| POST `P/gaps/scan` | R/O | `{}` (or omitted body) → `GapScanResponse` |
| GET `P/gaps` | M | `{gaps: KnowledgeGap[], nextCursor}` |
| GET `P/gaps/:gapId` | M | `{gap: KnowledgeGap}` |
| POST `P/gaps/:gapId/answers` | O only | `AnswerRequest` → `201 {answer: Answer}` |
| GET `P/gaps/:gapId/answers` | R/O | `{answers: Answer[], nextCursor}` |
| GET `P/reviews/queue` | R | `{answers: QueuedAnswer[], nextCursor}` |
| POST `A/review` | R | `ReviewRequest` → `201 ReviewResponse` |
| GET `A/reviews` | R | `ReviewHistoryResponse` |
| POST `P/handovers` | R | `{}` (or omitted body) → `201 {handover: Handover}` |
| GET `P/handovers` | M | `{handovers: HandoverSummary[], nextBeforeVersion}` |
| GET `P/handovers/:handoverId` | M | R: `{handover, receipts, nextReceiptCursor}`; O/I: `{handover, receipt}` (own receipt or null) |
| POST `P/handovers/:handoverId/acknowledge` | I only | `{}` (or omitted body) → `{receipt}`; `201` first time, `200` repeat |

There are no project/source edit/delete, membership role-update, standalone claim/document-list, gap-status mutation, review undo, draft handover, or automatic workflow endpoints. Do not build calls for them. User identity does not imply a project role; use each returned project's `role`. Incoming users cannot fetch answer history or private review details even after publication.

## Connect → Reconstruct → Verify → Review → Handover

1. **Connect:** register/login, call `/auth/me`, list/create/select a project. A reviewer adds already-registered members. Import through `P/sources` or `P/sources/github`. Read source detail to obtain `documents[].id` (the source list contains only counts). Hash duplicates in the same project return `409 SOURCE_EXISTS`, even across filenames/types; they are allowed in another project. Do not assume an existing source ID is returned on duplicate.
2. **Reconstruct:** R/O selects document IDs and POSTs `P/extractions`. This is a synchronous operation, not `202`/a queued job; the returned run has claims. GET by a known run ID retrieves it later; no run-list endpoint exists. Display every extracted claim as `UNVERIFIED`, including evidence and model provenance. Empty successful claims are valid.
3. **Verify:** follow claim `evidence[].sourceUrl` / `documentUrl` with credentials. Show the exact quote; offsets are zero-based UTF-16 string offsets, end-exclusive (`content.slice(startOffset,endOffset)`), not UTF-8 byte offsets. Source/CSV metadata byte ranges are a separate concept. Use `githubUrl` only when non-null; never manufacture a link. POST `P/gaps/scan`, then list/filter gaps. Findings express uncertainty, not confirmed facts. O answers a gap with exact evidence quotes. Responses are append-only; a clarification does not approve a claim or resolve a gap.
4. **Review:** R loads `P/reviews/queue` and submits `APPROVE`, `EDIT`, `REJECT` or `DEFER` to `A/review`. EDIT requires `correctedText`; REJECT/DEFER require `reason`. Optional `resolveGap:true` is allowed only for APPROVE/EDIT (default false); dismissed gaps cannot be resolved by review. APPROVE/EDIT/REJECT are final for that answer (`409` if reviewed again); DEFER allows later review. Show `effectiveReviewStatus` and `effectiveText`: the stored answer `status` stays `PENDING_REVIEW` even after approval. `effectiveText` is null for pending/rejected/deferred answers. Review mutation/history `answer` omits author/evidence relations; answer list/create and queue include them. History includes private reasons and is reviewer-only.
5. **Handover:** R POSTs `P/handovers` to publish a new immutable version; client content is not accepted. The snapshot selects the latest effective APPROVE/EDIT decision per gap (review timestamp descending, then decision ID descending), uses corrected text for EDIT, and excludes pending/rejected/deferred answers and private reasons. `confirmedKnowledge` and `unresolvedGaps` (`UNKNOWN`, from OPEN gaps) are separate; approval need not close a gap. `nextActions` comes only from nonblank `Next action:` lines of approved text (case-insensitive, optional `-`/`*` bullet). Actions follow selected review order then line order, have 1-based `order`/`lineNumber`, preserve action text, and carry evidence/reviewer provenance. No owner/deadline is inferred. List versions, read selected detail, then I acknowledges the exact snapshot/version. Receipt is idempotent per incoming user and snapshot. R alone sees all receipts; O/I see only their own. Old immutable snapshots can lack evidence navigation and action order/provenance fields: shared types mark those additions optional; retain their array order and match legacy document IDs against source detail documents when navigation fields are absent. A resolved source document is live; frozen quote/hash remain the publication evidence if content later differs.

## Input limits

- Registration: email ≤254 characters (trimmed/lowercased), password 12–128, optional trimmed name 1–100. Login password 1–128. Project name trimmed 1–200; optional description ≤5000.
- JSON source: `MARKDOWN` (`.md`/`.markdown`), `TXT` (`.txt`), `CSV` (`.csv`). Filename 1–255, no separators/control characters. Nonblank valid UTF-8 text; disallowed controls/binary content rejected. Content ≤262144 UTF-8 bytes; optional metadata JSON object ≤8192 UTF-8 bytes when serialized. Original text/BOM/newlines are preserved.
- Multipart: exactly one field named `file`, extensions `.md`, `.txt`, `.csv` (case-insensitive). MIME: matching `text/markdown`, `text/plain`, `text/csv`, or generic `text/plain` / `application/octet-stream`. Optional `metadata` field contains serialized JSON object; no `type`/`filename`/`content` fields. The browser sets the boundary: **do not set Content-Type manually**. Metadata field ≤8192 bytes; full wire payload ≤278528 bytes.
- CSV: 1–1000 tasks after header, ≤50 nonempty distinct headers (trimmed/case-insensitive), mandatory `title`, nonblank titles, consistent column counts; parser record-size cap 65536. Quoted/multiline rows are supported; strings/formulas are not evaluated.
- GitHub uses an `owner/repo` string, not a URL or OAuth token. Import is bounded (README ≤128 KiB, other documents ≤64 KiB, canonical `originalContent` ≤1 MiB; document rows are stored additionally); pagination limits are recorded in source provenance. This is not a full repository sync. API tokens/provider keys are configured server-side.
- Extraction: 1–20 unique same-project document IDs, combined content ≤100000 UTF-8 bytes; provider timeout at most 30 seconds. No model/prompt/key fields accepted from frontend.
- Answer: nonblank text ≤10000 characters; optional ≤10 distinct `{documentId,quote}` entries, each nonblank quote ≤4000 and an exact substring of a same-project document. Evidence can be empty. Review corrected text ≤10000, reason ≤5000; text/quotes reject disallowed controls.
- Publication: at most 1000 selected confirmed items, 1000 unresolved gaps, and 2000000 serialized bytes. No destructive overwrite; publish again for a new version.

```ts
const form = new FormData();
form.append("file", file); // File with its original filename
form.append("metadata", JSON.stringify({ origin: "handoff" })); // optional
await fetch(`${apiOrigin}/api/projects/${projectId}/sources`, {
  method: "POST", credentials: "include", body: form,
});
```

## Pagination

All paginated lists default to 50, accept integer `limit` 1–100, and return null continuation when finished. Send only supported query keys (these list schemas are strict). Keep project/filter scope stable between pages; there are no totals.

| Endpoint | Query and order | Next page |
| --- | --- | --- |
| `P/claims` | `cursor?`, `limit?`; ID ascending | `cursor=nextCursor` |
| `P/gaps` | Same, plus `status?` OPEN/RESOLVED/DISMISSED and `category?` | `cursor=nextCursor` |
| `P/gaps/:gapId/answers` | `cursor?`, `limit?`; createdAt then ID ascending; cursor must be an existing answer in that gap | `cursor=nextCursor` |
| `P/reviews/queue` | Same chronological order; existing same-project answer cursor; pending/deferred queue only | `cursor=nextCursor` |
| `A/reviews` | `after?` integer 0–2147483647, default 0; sequence ascending; `limit?` | `after=nextAfter` |
| `P/handovers` | `beforeVersion?` integer 1–2147483647; version descending; `limit?` | `beforeVersion=nextBeforeVersion` |
| `P/handovers/:handoverId` (R only) | `receiptCursor?` existing receipt of this snapshot; `receiptLimit?` 1–100, default 50; receipt ID ascending | `receiptCursor=nextReceiptCursor` |

Nonreviewers must send no query parameters on handover detail. Projects, members and sources are unpaginated; do not expect cursors there. Claims/gaps cursors are ID comparison boundaries, not offset/page numbers; answer/queue/receipt cursors are validated against the current scope.

## Errors and UI handling

Handled errors use `{error:{code,message}}`; extraction POST can additionally return scalar `run` data (without `claims`) after a run exists. Earlier validation/config errors may have no `run`. Auth failure during extraction can hide run details. Unknown routes use Express's default 404, so defensively handle non-JSON failures too. Do not infer success from receiving JSON; check HTTP status first.

| Status | Actual codes / handling |
| --- | --- |
| 400 | `INVALID_INPUT`, `INVALID_EVIDENCE`; correct fields/quotes; no field-level error map |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`; restore login state |
| 403 | `FORBIDDEN`, `PUBLIC_REPOSITORY_REQUIRED`, `GITHUB_FORBIDDEN`; role/origin/public-repository restriction |
| 404 | `NOT_FOUND`, `USER_NOT_FOUND`, `GITHUB_NOT_FOUND`; inaccessible and absent project resources are intentionally indistinguishable |
| 409 | `REGISTRATION_FAILED`, `MEMBERSHIP_EXISTS`, `LAST_REVIEWER`, `SOURCE_EXISTS`, `SOURCE_CHANGED`, `ANSWER_ALREADY_REVIEWED`, `GAP_DISMISSED`, `INVALID_APPROVED_CONTENT`, `VERSION_LIMIT`; refresh relevant state before retry |
| 413 | `PAYLOAD_TOO_LARGE`, `INPUT_TOO_LARGE`, `GITHUB_IMPORT_TOO_LARGE`, `SCAN_TOO_LARGE`, `HANDOVER_TOO_LARGE`; reduce input. JSON parser overflow instead uses `INVALID_INPUT` |
| 429 | `RATE_LIMITED`, `GITHUB_RATE_LIMITED`; back off. Login 10 attempts/15 min; registration 10/hour per peer IP, with standard rate-limit headers |
| 502 | `GITHUB_UNAVAILABLE`, `INVALID_AI_OUTPUT`, `UNGROUNDED_AI_OUTPUT`, `AI_EXTRACTION_FAILED`; show safe error, no confirmed data inferred |
| 503 | `AI_NOT_CONFIGURED`, `AI_CONFIGURATION_ERROR`; server configuration required |
| 504 | `AI_TIMEOUT`; extraction failed, not queued |
| 500 | `INTERNAL_ERROR`; generic safe failure |

Treat all source/answer/quote text as untrusted display data; render as text or sanitized Markdown. Hide role-ineligible controls, but always handle server `401`/`403`/`404` because memberships/sessions can be revoked immediately. Never expose reviewer-only queue/history/reasons to incoming users by reusing cached responses.
