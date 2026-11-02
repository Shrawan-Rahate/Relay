/** Relay HTTP wire types, derived from server/src routes and Prisma scalar fields.
 * Dates are JSON strings. These types do not perform runtime validation.
 * See API_INTEGRATION.md for permissions, limits and pagination semantics.
 */
export type UUID = string;
export type ISODateTime = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type EmptyRequest = Record<string, never>;
export type ProjectRole = "REVIEWER" | "OUTGOING" | "INCOMING";
export type SourceType = "MARKDOWN" | "TXT" | "CSV" | "GITHUB";
export type ClaimType = "DECISION" | "OWNER" | "DEPENDENCY" | "STATUS" | "RISK";
export type ExtractionStatus = "RUNNING" | "SUCCEEDED" | "FAILED";
export type GapCategory = "MISSING_OWNER" | "UNCLEAR_STATUS" | "UNRESOLVED_DEPENDENCY" | "POTENTIAL_CONFLICT";
export type GapStatus = "OPEN" | "RESOLVED" | "DISMISSED";
export type ReviewAction = "APPROVE" | "EDIT" | "REJECT" | "DEFER";
export type EffectiveReviewStatus = "PENDING_REVIEW" | "APPROVED" | "EDITED" | "REJECTED" | "DEFERRED";
export interface Timestamps { createdAt: ISODateTime; updatedAt: ISODateTime }
export interface User { id: UUID; email: string; name: string | null; createdAt: ISODateTime }
export interface NamedUser { id: UUID; name: string | null }
export interface Project extends Timestamps { id: UUID; name: string; description: string | null; role: ProjectRole }
export interface ProjectMember extends Timestamps {
  id: UUID; projectId: UUID; userId: UUID; role: ProjectRole;
  user: NamedUser & { email: string };
}
export interface RegisterRequest { email: string; password: string; name?: string }
export interface LoginRequest { email: string; password: string }
/** Supabase access token exchanged once for an HttpOnly Relay session. */
export interface SupabaseSessionRequest { accessToken: string }
export interface CreateProjectRequest { name: string; description?: string }
export interface AddMemberRequest { email: string; role: ProjectRole }
export interface ImportSourceRequest {
  type: Exclude<SourceType, "GITHUB">; filename: string; content: string; metadata?: JsonObject;
}
/** FormData entries, not a JSON body. metadata is JSON.stringify(JsonObject). */
export interface UploadSourceFields { file: File; metadata?: string }
export interface GitHubImportRequest { repository: string }
export interface SourceDocument extends Timestamps {
  id: UUID; sourceId: UUID; projectId: UUID; position: number; content: string; sha256: string; metadata: JsonValue;
}
export interface SourceFields extends Timestamps {
  id: UUID; projectId: UUID; importedById: UUID; type: SourceType; filename: string;
  sha256: string; byteSize: number; metadata: JsonValue; provenance: JsonValue;
}
export interface SourceSummary extends SourceFields { _count: { documents: number } }
export interface Source extends SourceFields { originalContent: string; documents: SourceDocument[] }
export interface EvidenceReference {
  sourceId: UUID; filename: string; sourceType: SourceType;
  /** Relative same-project API URLs; fetch with session credentials. */
  sourceUrl: string; documentUrl: string; githubUrl: string | null;
}
export interface Quote { documentId: UUID; quote: string; startOffset: number; endOffset: number }
export interface ClaimEvidence extends Quote, EvidenceReference {
  id: UUID; projectId: UUID; claimId: UUID; createdAt: ISODateTime;
}
export interface Claim extends Timestamps {
  id: UUID; projectId: UUID; runId: UUID; type: ClaimType; text: string; status: "UNVERIFIED"; evidence: ClaimEvidence[];
}
/** The /claims list adds this projection; extraction run claims do not have it. */
export interface ListedClaim extends Claim {
  run: { provider: string; model: string; modelVersion: string | null; provenance: JsonValue };
}
export interface ExtractionRequest { documentIds: UUID[] }
export interface ExtractionRun extends Timestamps {
  id: UUID; projectId: UUID; requestedById: UUID; provider: string; model: string; modelVersion: string | null;
  provenance: JsonValue; status: ExtractionStatus; errorCode: string | null; errorMessage: string | null;
  startedAt: ISODateTime; completedAt: ISODateTime | null;
}
export interface ExtractionRunDetail extends ExtractionRun { claims: Claim[] }
export interface GapClaimLink {
  gapId: UUID; claimId: UUID; projectId: UUID; provenance: JsonValue; createdAt: ISODateTime;
}
export interface KnowledgeGap extends Timestamps {
  id: UUID; projectId: UUID; category: GapCategory; status: GapStatus; question: string;
  fingerprint: string; provenance: JsonValue; claimLinks: GapClaimLink[]; claimIds: UUID[];
}
export interface GapScanResponse { gaps: KnowledgeGap[]; createdCount: number; existingCount: number; scannedClaimCount: number }
export interface AnswerRequest { answerText: string; evidence?: { documentId: UUID; quote: string }[] }
export interface AnswerEvidence extends Quote {
  id: UUID; responseId: UUID; projectId: UUID; documentSha256: string; createdAt: ISODateTime;
}
/** Review mutation/history return this shape, without author or evidence relations. */
export interface ReviewedAnswer {
  id: UUID; projectId: UUID; gapId: UUID; authorId: UUID; answerText: string;
  status: "PENDING_REVIEW"; createdAt: ISODateTime; effectiveReviewStatus: EffectiveReviewStatus; effectiveText: string | null;
}
export interface Answer extends ReviewedAnswer { author: NamedUser; evidence: AnswerEvidence[] }
export interface QueuedAnswer extends Answer { gap: Pick<KnowledgeGap, "id" | "category" | "question" | "status"> }
export type ReviewRequest =
  | { action: "APPROVE"; reason?: string; resolveGap?: boolean }
  | { action: "EDIT"; correctedText: string; reason?: string; resolveGap?: boolean }
  | { action: "REJECT" | "DEFER"; reason: string; resolveGap?: false };
export interface ReviewDecision {
  id: UUID; projectId: UUID; responseId: UUID; reviewerId: UUID; sequence: number; action: ReviewAction;
  correctedText: string | null; reason: string | null; resolveGap: boolean; createdAt: ISODateTime; reviewer: NamedUser;
}
export interface ReviewResponse { decision: ReviewDecision; answer: ReviewedAnswer }
export interface ReviewHistoryResponse { answer: ReviewedAnswer; reviews: ReviewDecision[]; nextAfter: number | null }
export interface PublishedReview {
  decisionId: UUID; action: "APPROVE" | "EDIT"; reviewerId: UUID; reviewerName: string | null;
  sequence: number; reviewedAt: ISODateTime;
}
/** Old immutable snapshots predate navigation fields; new publications include all of them. */
export interface PublishedEvidence extends Quote, Partial<EvidenceReference> { evidenceId: UUID; documentSha256: string }
export interface ConfirmedKnowledge {
  status: "CONFIRMED"; gapId: UUID; answerId: UUID; text: string; review: PublishedReview; evidence: PublishedEvidence[];
}
export interface UnknownGap { status: "UNKNOWN"; gapId: UUID; category: GapCategory; question: string }
export interface NextAction {
  text: string; answerId: UUID; reviewDecisionId: UUID;
  /** Added after initial immutable snapshots; absent on older versions. */
  order?: number; lineNumber?: number; review?: PublishedReview; evidence?: PublishedEvidence[];
}
export interface HandoverContent {
  schemaVersion: 1; publishedAt: ISODateTime; confirmedKnowledge: ConfirmedKnowledge[]; unresolvedGaps: UnknownGap[]; nextActions: NextAction[];
}
export interface HandoverSummary {
  id: UUID; projectId: UUID; version: number; authorId: UUID; createdAt: ISODateTime; publishedAt: ISODateTime; contentSha256: string;
}
export interface Handover extends HandoverSummary { content: HandoverContent }
export interface HandoverReceipt {
  id: UUID; projectId: UUID; snapshotId: UUID; snapshotVersion: number; userId: UUID; createdAt: ISODateTime;
}
export type HandoverDetailResponse =
  | { handover: Handover; receipts: HandoverReceipt[]; nextReceiptCursor: UUID | null }
  | { handover: Handover; receipt: HandoverReceipt | null };
export interface CursorQuery { cursor?: UUID; limit?: number }
export interface GapQuery extends CursorQuery { status?: GapStatus; category?: GapCategory }
export interface ReviewHistoryQuery { after?: number; limit?: number }
export interface HandoverListQuery { beforeVersion?: number; limit?: number }
/** Only reviewers may send query parameters on handover detail. */
export interface HandoverDetailQuery { receiptCursor?: UUID; receiptLimit?: number }
export type ErrorCode =
  | "INVALID_INPUT" | "UNAUTHENTICATED" | "INVALID_CREDENTIALS" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR"
  | "AUTH_MODE_DISABLED" | "EMAIL_UNVERIFIED" | "IDENTITY_CONFLICT" | "AUTH_UNAVAILABLE"
  | "RATE_LIMITED" | "REGISTRATION_FAILED" | "USER_NOT_FOUND" | "MEMBERSHIP_EXISTS" | "LAST_REVIEWER"
  | "SOURCE_EXISTS" | "PAYLOAD_TOO_LARGE" | "PUBLIC_REPOSITORY_REQUIRED" | "GITHUB_FORBIDDEN" | "GITHUB_NOT_FOUND"
  | "GITHUB_RATE_LIMITED" | "GITHUB_IMPORT_TOO_LARGE" | "GITHUB_UNAVAILABLE" | "INPUT_TOO_LARGE" | "SOURCE_CHANGED"
  | "AI_CONFIGURATION_ERROR" | "AI_NOT_CONFIGURED" | "AI_TIMEOUT" | "INVALID_AI_OUTPUT" | "UNGROUNDED_AI_OUTPUT"
  | "AI_EXTRACTION_FAILED" | "SCAN_TOO_LARGE" | "INVALID_EVIDENCE" | "ANSWER_ALREADY_REVIEWED" | "GAP_DISMISSED"
  | "HANDOVER_TOO_LARGE" | "INVALID_APPROVED_CONTENT" | "VERSION_LIMIT";
export interface ApiError { error: { code: ErrorCode; message: string } }
/** Extraction failures after a run is created can include scalar run data, without claims. */
export interface ExtractionErrorResponse extends ApiError { run?: ExtractionRun }
export interface HealthResponse { status: "ok"; service: "relay-api"; timestamp: ISODateTime }

/** Compile-time endpoint inventory, not an HTTP client. Response means success JSON;
 * errors use ApiError (ExtractionErrorResponse for extraction POST). void means no body.
 * Query numbers are serialized as query strings. Replace :parameters with UUIDs.
 */
export interface Contract<Request, Response, Query = never, Status extends number = 200> {
  request: Request; response: Response; query: Query; successStatus: Status;
}
export interface ApiContracts {
  "GET /api/health": Contract<never, HealthResponse>;
  "POST /api/auth/register": Contract<RegisterRequest, { user: User }, never, 201>;
  "POST /api/auth/login": Contract<LoginRequest, { user: User }>;
  "POST /api/auth/supabase-session": Contract<SupabaseSessionRequest, { user: User }>;
  "POST /api/auth/logout": Contract<never, void, never, 204>;
  "GET /api/auth/me": Contract<never, { user: User }>;
  "POST /api/projects": Contract<CreateProjectRequest, { project: Project }, never, 201>;
  "GET /api/projects": Contract<never, { projects: Project[] }>;
  "GET /api/projects/:id": Contract<never, { project: Project }>;
  "GET /api/projects/:id/members": Contract<never, { members: ProjectMember[] }>;
  "POST /api/projects/:id/members": Contract<AddMemberRequest, { member: ProjectMember }, never, 201>;
  "DELETE /api/projects/:id/members/:memberId": Contract<never, void, never, 204>;
  "POST /api/projects/:id/sources": Contract<ImportSourceRequest | FormData, { source: Source }, never, 201>;
  "POST /api/projects/:id/sources/github": Contract<GitHubImportRequest, { source: Source }, never, 201>;
  "GET /api/projects/:id/sources": Contract<never, { sources: SourceSummary[] }>;
  "GET /api/projects/:id/sources/:sourceId": Contract<never, { source: Source }>;
  "GET /api/projects/:id/sources/:sourceId/documents/:documentId": Contract<never, { document: SourceDocument }>;
  "POST /api/projects/:id/extractions": Contract<ExtractionRequest, { run: ExtractionRunDetail }, never, 201>;
  "GET /api/projects/:id/extractions/:runId": Contract<never, { run: ExtractionRunDetail }>;
  "GET /api/projects/:id/claims": Contract<never, { claims: ListedClaim[]; nextCursor: UUID | null }, CursorQuery>;
  "POST /api/projects/:id/gaps/scan": Contract<EmptyRequest, GapScanResponse>;
  "GET /api/projects/:id/gaps": Contract<never, { gaps: KnowledgeGap[]; nextCursor: UUID | null }, GapQuery>;
  "GET /api/projects/:id/gaps/:gapId": Contract<never, { gap: KnowledgeGap }>;
  "POST /api/projects/:id/gaps/:gapId/answers": Contract<AnswerRequest, { answer: Answer }, never, 201>;
  "GET /api/projects/:id/gaps/:gapId/answers": Contract<never, { answers: Answer[]; nextCursor: UUID | null }, CursorQuery>;
  "GET /api/projects/:id/reviews/queue": Contract<never, { answers: QueuedAnswer[]; nextCursor: UUID | null }, CursorQuery>;
  "POST /api/projects/:id/gaps/:gapId/answers/:answerId/review": Contract<ReviewRequest, ReviewResponse, never, 201>;
  "GET /api/projects/:id/gaps/:gapId/answers/:answerId/reviews": Contract<never, ReviewHistoryResponse, ReviewHistoryQuery>;
  "POST /api/projects/:id/handovers": Contract<EmptyRequest, { handover: Handover }, never, 201>;
  "GET /api/projects/:id/handovers": Contract<never, { handovers: HandoverSummary[]; nextBeforeVersion: number | null }, HandoverListQuery>;
  "GET /api/projects/:id/handovers/:handoverId": Contract<never, HandoverDetailResponse, HandoverDetailQuery>;
  "POST /api/projects/:id/handovers/:handoverId/acknowledge": Contract<EmptyRequest, { receipt: HandoverReceipt }, never, 200 | 201>;
}
export type ApiEndpoint = keyof ApiContracts;
export type ApiRequest<E extends ApiEndpoint> = ApiContracts[E]["request"];
export type ApiResponse<E extends ApiEndpoint> = ApiContracts[E]["response"];
export type ApiQuery<E extends ApiEndpoint> = ApiContracts[E]["query"];
