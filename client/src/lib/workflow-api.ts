import type { Claim, ClaimEvidence, ExtractionRunDetail, GapQuery, GapScanResponse, KnowledgeGap, ListedClaim, SourceDocument } from '../../../shared/api-types';
import { ApiError, type RelayApi } from './api';

export const claimTypes = ['DECISION', 'OWNER', 'DEPENDENCY', 'STATUS', 'RISK'] as const;
export const gapCategories = ['MISSING_OWNER', 'UNCLEAR_STATUS', 'UNRESOLVED_DEPENDENCY', 'POTENTIAL_CONFLICT'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const invalidWorkflow = () => new ApiError(502, 'INVALID_RESPONSE', 'Relay returned invalid workflow data. Refresh to retry.');
function id(value: string) { if (!uuid.test(value)) throw invalidWorkflow(); return encodeURIComponent(value); }
const base = (projectId: string) => `/api/projects/${id(projectId)}`;
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
function cursor(value: string | null, previous?: string) {
  if (value !== null && (typeof value !== 'string' || !uuid.test(value) || value === previous)) throw invalidWorkflow();
}
function provenance(run: ListedClaim['run']) {
  if (!run || typeof run.provider !== 'string' || typeof run.model !== 'string'
    || !(run.modelVersion === null || typeof run.modelVersion === 'string') || run.provenance === undefined) throw invalidWorkflow();
}
function checkClaim(claim: Claim, projectId: string) {
  if (!claim || !uuid.test(claim.id) || !uuid.test(claim.runId) || claim.projectId !== projectId || claim.status !== 'UNVERIFIED'
    || !claimTypes.includes(claim.type) || typeof claim.text !== 'string' || !Array.isArray(claim.evidence)) throw invalidWorkflow();
  claim.evidence.forEach(e => {
    if (!e || e.projectId !== projectId || e.claimId !== claim.id || !uuid.test(e.sourceId) || !uuid.test(e.documentId)
      || typeof e.quote !== 'string' || typeof e.filename !== 'string' || !count(e.startOffset) || !count(e.endOffset) || e.endOffset < e.startOffset
      || e.sourceUrl !== `${base(projectId)}/sources/${e.sourceId}` || e.documentUrl !== `${base(projectId)}/sources/${e.sourceId}/documents/${e.documentId}`) throw invalidWorkflow();
  });
}
function checkGap(gap: KnowledgeGap, projectId: string) {
  if (!gap || !uuid.test(gap.id) || gap.projectId !== projectId || !gapCategories.includes(gap.category)
    || !['OPEN', 'RESOLVED', 'DISMISSED'].includes(gap.status) || typeof gap.question !== 'string' || gap.provenance === undefined
    || !Array.isArray(gap.claimLinks) || !Array.isArray(gap.claimIds) || gap.claimIds.some(value => !uuid.test(value))) throw invalidWorkflow();
  gap.claimLinks.forEach(link => {
    if (!link || link.projectId !== projectId || link.gapId !== gap.id || !uuid.test(link.claimId)
      || !gap.claimIds.includes(link.claimId) || link.provenance === undefined) throw invalidWorkflow();
  });
}
export async function fetchClaims(api: RelayApi, projectId: string, after?: string) {
  const query = new URLSearchParams({ limit: '50' }); if (after) query.set('cursor', id(after));
  const body = await api.request<{ claims: ListedClaim[]; nextCursor: string | null }>(`${base(projectId)}/claims?${query}`);
  if (!Array.isArray(body?.claims)) throw invalidWorkflow();
  body.claims.forEach(claim => { checkClaim(claim, projectId); provenance(claim.run); }); cursor(body.nextCursor, after);
  return body;
}
export async function extractClaims(api: RelayApi, projectId: string, documentIds: string[]) {
  if (!documentIds.length || documentIds.length > 20 || new Set(documentIds).size !== documentIds.length || documentIds.some(value => !uuid.test(value))) {
    throw new ApiError(400, 'INVALID_INPUT', 'Select 1 to 20 distinct source documents.');
  }
  const body = await api.request<{ run: ExtractionRunDetail }>(`${base(projectId)}/extractions`, {
    method: 'POST', body: JSON.stringify({ documentIds }), signal: AbortSignal.timeout(45_000),
  });
  const run = body?.run;
  if (!run || !uuid.test(run.id) || run.projectId !== projectId || run.status !== 'SUCCEEDED' || !Array.isArray(run.claims)) throw invalidWorkflow();
  provenance(run); run.claims.forEach(claim => {
    checkClaim(claim, projectId);
    if (claim.runId !== run.id || claim.evidence.some(e => !documentIds.includes(e.documentId))) throw invalidWorkflow();
  });
  return run;
}
export async function fetchGaps(api: RelayApi, projectId: string, filters: GapQuery = {}) {
  const query = new URLSearchParams({ limit: '50' });
  if (filters.cursor) query.set('cursor', id(filters.cursor));
  if (filters.status) query.set('status', filters.status);
  if (filters.category) query.set('category', filters.category);
  const body = await api.request<{ gaps: KnowledgeGap[]; nextCursor: string | null }>(`${base(projectId)}/gaps?${query}`);
  if (!Array.isArray(body?.gaps)) throw invalidWorkflow();
  body.gaps.forEach(gap => checkGap(gap, projectId)); cursor(body.nextCursor, filters.cursor); return body;
}
export async function fetchGap(api: RelayApi, projectId: string, gapId: string) {
  const body = await api.request<{ gap: KnowledgeGap }>(`${base(projectId)}/gaps/${id(gapId)}`);
  checkGap(body?.gap, projectId); if (body.gap.id !== gapId) throw invalidWorkflow(); return body.gap;
}
export async function scanGaps(api: RelayApi, projectId: string) {
  const body = await api.request<GapScanResponse>(`${base(projectId)}/gaps/scan`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(45_000) });
  if (!body || !Array.isArray(body.gaps) || !count(body.createdCount) || !count(body.existingCount) || !count(body.scannedClaimCount)
    || body.createdCount + body.existingCount !== body.gaps.length) throw invalidWorkflow();
  body.gaps.forEach(gap => checkGap(gap, projectId)); return body;
}
export async function fetchEvidenceDocument(api: RelayApi, projectId: string, evidence: ClaimEvidence) {
  const url = `${base(projectId)}/sources/${id(evidence.sourceId)}/documents/${id(evidence.documentId)}`;
  if (url !== evidence.documentUrl || evidence.projectId !== projectId) throw invalidWorkflow();
  const body = await api.request<{ document: SourceDocument }>(url);
  const doc = body?.document;
  if (!doc || doc.id !== evidence.documentId || doc.projectId !== projectId || doc.sourceId !== evidence.sourceId || typeof doc.content !== 'string') throw invalidWorkflow();
  return doc;
}
const errors: Record<string, string> = {
  AI_NOT_CONFIGURED: 'AI extraction is not configured on the backend. Ask an administrator to configure the provider.',
  AI_CONFIGURATION_ERROR: 'The backend AI configuration is invalid. Ask an administrator to check it.',
  AI_TIMEOUT: 'The provider timed out. No successful extraction is confirmed. You can retry explicitly.',
  INVALID_AI_OUTPUT: 'The provider returned invalid output. No successful extraction is confirmed.',
  UNGROUNDED_AI_OUTPUT: 'The provider returned unsupported evidence. No successful extraction is confirmed.',
  AI_EXTRACTION_FAILED: 'The provider could not complete extraction. No successful extraction is confirmed.',
  INPUT_TOO_LARGE: 'Selected documents exceed 100,000 UTF-8 bytes. Select less source material.',
  SCAN_TOO_LARGE: 'The project exceeds the backend gap scan limits. No successful scan is confirmed.',
  SOURCE_CHANGED: 'Source documents changed during extraction. Reload the documents before retrying.',
  RATE_LIMITED: 'Too many requests. Wait before retrying; no automatic retry will run.',
  NOT_FOUND: 'This project or resource is unavailable, or your membership was removed. Refresh project access.',
  REQUEST_TIMEOUT: 'The request timed out; the server outcome is unknown. Refresh stored results before starting another operation.',
  NETWORK_ERROR: 'Unable to reach Relay; the server outcome may be unknown. Refresh stored results before retrying a mutation.',
};
export function workflowError(error: unknown) {
  if (!(error instanceof ApiError)) return 'Workflow data could not be loaded. Please retry.';
  return `${errors[error.code] ?? error.message} (${error.code})`;
}
