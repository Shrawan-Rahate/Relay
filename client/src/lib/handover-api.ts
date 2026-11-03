import type { Handover, HandoverDetailResponse, HandoverReceipt, HandoverSummary, Project, PublishedEvidence, PublishedReview, SourceDocument } from '../../../shared/api-types';
import { ApiError, type RelayApi } from './api';
import { gapCategories, invalidWorkflow, workflowError } from './workflow-api';
import { getSource, listSources } from './source-api';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const positive = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function id(value: string) { if (!uuid.test(value)) throw invalidWorkflow(); return value; }
function base(project: Project) {
  if (!['REVIEWER', 'OUTGOING', 'INCOMING'].includes(project.role)) throw new ApiError(403, 'FORBIDDEN', 'Project membership required.');
  return `/api/projects/${id(project.id)}`;
}
function requireRole(project: Project, role: 'REVIEWER' | 'INCOMING') {
  if (project.role !== role) throw new ApiError(403, 'FORBIDDEN', `${role === 'REVIEWER' ? 'Reviewer' : 'Incoming'} role required.`);
}
function checkSummary(value: HandoverSummary, projectId: string) {
  if (!value || !uuid.test(value.id) || value.projectId !== projectId || !positive(value.version) || !uuid.test(value.authorId)
    || typeof value.createdAt !== 'string' || typeof value.publishedAt !== 'string' || !/^[a-f0-9]{64}$/i.test(value.contentSha256)) throw invalidWorkflow();
}
function checkReview(review: PublishedReview) {
  if (!review || !uuid.test(review.decisionId) || !['APPROVE', 'EDIT'].includes(review.action) || !uuid.test(review.reviewerId)
    || !(review.reviewerName === null || typeof review.reviewerName === 'string') || !positive(review.sequence) || typeof review.reviewedAt !== 'string') throw invalidWorkflow();
}
function checkEvidence(e: PublishedEvidence, projectId: string) {
  if (!e || !uuid.test(e.evidenceId) || !uuid.test(e.documentId) || typeof e.quote !== 'string' || typeof e.documentSha256 !== 'string'
    || !Number.isSafeInteger(e.startOffset) || e.startOffset < 0 || e.endOffset !== e.startOffset + e.quote.length) throw invalidWorkflow();
  const sourcePath = e.sourceId ? `/api/projects/${projectId}/sources/${id(e.sourceId)}` : undefined;
  if ((e.sourceUrl !== undefined && e.sourceUrl !== sourcePath) || (e.documentUrl !== undefined && (!sourcePath || e.documentUrl !== `${sourcePath}/documents/${e.documentId}`))
    || (e.filename !== undefined && typeof e.filename !== 'string') || (e.sourceType !== undefined && !['MARKDOWN', 'TXT', 'CSV', 'GITHUB'].includes(e.sourceType))) throw invalidWorkflow();
}
function checkHandover(value: Handover, projectId: string) {
  checkSummary(value, projectId); const content = value.content;
  if (!content || content.schemaVersion !== 1 || content.publishedAt !== value.publishedAt || !Array.isArray(content.confirmedKnowledge) || !Array.isArray(content.unresolvedGaps) || !Array.isArray(content.nextActions)) throw invalidWorkflow();
  for (const item of content.confirmedKnowledge) {
    if (!item || item.status !== 'CONFIRMED' || !uuid.test(item.gapId) || !uuid.test(item.answerId) || typeof item.text !== 'string' || !item.text.trim() || !Array.isArray(item.evidence)) throw invalidWorkflow();
    checkReview(item.review); item.evidence.forEach(e => checkEvidence(e, projectId));
  }
  for (const gap of content.unresolvedGaps) if (!gap || gap.status !== 'UNKNOWN' || !uuid.test(gap.gapId) || !gapCategories.includes(gap.category) || typeof gap.question !== 'string') throw invalidWorkflow();
  for (const action of content.nextActions) {
    if (!action || typeof action.text !== 'string' || !action.text.trim() || !uuid.test(action.answerId) || !uuid.test(action.reviewDecisionId)
      || !content.confirmedKnowledge.some(item => item.answerId === action.answerId && item.review.decisionId === action.reviewDecisionId)
      || (action.order !== undefined && !positive(action.order)) || (action.lineNumber !== undefined && !positive(action.lineNumber))) throw invalidWorkflow();
    if (action.review !== undefined) { checkReview(action.review); if (action.review.decisionId !== action.reviewDecisionId) throw invalidWorkflow(); }
    if (action.evidence !== undefined) { if (!Array.isArray(action.evidence)) throw invalidWorkflow(); action.evidence.forEach(e => checkEvidence(e, projectId)); }
  }
}
function checkReceipt(receipt: HandoverReceipt, snapshot: HandoverSummary, userId?: string) {
  if (!receipt || !uuid.test(receipt.id) || receipt.projectId !== snapshot.projectId || receipt.snapshotId !== snapshot.id || receipt.snapshotVersion !== snapshot.version
    || !uuid.test(receipt.userId) || (userId !== undefined && receipt.userId !== userId) || typeof receipt.createdAt !== 'string') throw invalidWorkflow();
}
export async function fetchHandovers(api: RelayApi, project: Project, beforeVersion?: number) {
  const path = base(project), query = new URLSearchParams({ limit: '50' });
  if (beforeVersion !== undefined) { if (!positive(beforeVersion)) throw invalidWorkflow(); query.set('beforeVersion', String(beforeVersion)); }
  const body = await api.request<{ handovers: HandoverSummary[]; nextBeforeVersion: number | null }>(`${path}/handovers?${query}`);
  if (!Array.isArray(body?.handovers)) throw invalidWorkflow();
  let previous = beforeVersion ?? Infinity;
  for (const snapshot of body.handovers) { checkSummary(snapshot, project.id); if (snapshot.version >= previous) throw invalidWorkflow(); previous = snapshot.version; }
  if (body.nextBeforeVersion !== null && (!positive(body.nextBeforeVersion) || body.nextBeforeVersion !== previous || !body.handovers.length)) throw invalidWorkflow();
  return body;
}
export async function publishHandover(api: RelayApi, project: Project) {
  requireRole(project, 'REVIEWER');
  const body = await api.request<{ handover: Handover }>(`${base(project)}/handovers`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(45_000) });
  checkHandover(body?.handover, project.id); return body.handover;
}
export async function fetchHandover(api: RelayApi, project: Project, snapshot: HandoverSummary, currentUserId: string, receiptCursor?: string): Promise<HandoverDetailResponse> {
  const path = `${base(project)}/handovers/${id(snapshot.id)}`; checkSummary(snapshot, project.id);
  let query = '';
  if (project.role === 'REVIEWER') {
    const params = new URLSearchParams({ receiptLimit: '50' }); if (receiptCursor) params.set('receiptCursor', id(receiptCursor)); query = `?${params}`;
  } else { id(currentUserId); if (receiptCursor !== undefined) throw new ApiError(403, 'FORBIDDEN', 'Receipt pagination is reviewer-only.'); }
  const body = await api.request<HandoverDetailResponse>(path + query);
  checkHandover(body?.handover, project.id);
  if (body.handover.id !== snapshot.id || body.handover.version !== snapshot.version || body.handover.contentSha256 !== snapshot.contentSha256) throw invalidWorkflow();
  if (project.role === 'REVIEWER') {
    if (!('receipts' in body) || !Array.isArray(body.receipts)) throw invalidWorkflow();
    body.receipts.forEach(receipt => checkReceipt(receipt, snapshot));
    if (body.nextReceiptCursor !== null && (!uuid.test(body.nextReceiptCursor) || body.nextReceiptCursor === receiptCursor || body.nextReceiptCursor !== body.receipts.at(-1)?.id)) throw invalidWorkflow();
    return { handover: body.handover, receipts: body.receipts, nextReceiptCursor: body.nextReceiptCursor };
  }
  // Fail closed on the reviewer envelope or another member's receipt, even if the API misbehaves.
  if ('receipts' in body || !('receipt' in body)) throw invalidWorkflow();
  if (body.receipt !== null) checkReceipt(body.receipt, snapshot, currentUserId);
  return { handover: body.handover, receipt: body.receipt };
}
export async function acknowledgeHandover(api: RelayApi, project: Project, snapshot: HandoverSummary, currentUserId: string) {
  requireRole(project, 'INCOMING'); checkSummary(snapshot, project.id); id(currentUserId);
  const body = await api.request<{ receipt: HandoverReceipt }>(`${base(project)}/handovers/${id(snapshot.id)}/acknowledge`, { method: 'POST', body: '{}' });
  checkReceipt(body?.receipt, snapshot, currentUserId); return body.receipt;
}
export async function readPublishedEvidence(api: RelayApi, project: Project, evidence: PublishedEvidence): Promise<{ document: SourceDocument; filename: string } | null> {
  const path = base(project); checkEvidence(evidence, project.id);
  if (evidence.sourceId) {
    const body = await api.request<{ document: SourceDocument }>(`${path}/sources/${id(evidence.sourceId)}/documents/${id(evidence.documentId)}`), doc = body?.document;
    if (!doc || doc.id !== evidence.documentId || doc.projectId !== project.id || doc.sourceId !== evidence.sourceId || typeof doc.content !== 'string' || typeof doc.sha256 !== 'string') throw invalidWorkflow();
    return { document: doc, filename: evidence.filename ?? 'Source document' };
  }
  for (const summary of await listSources(api, project.id)) {
    const source = await getSource(api, project.id, summary.id), document = source.documents.find(doc => doc.id === evidence.documentId);
    if (document) return { document, filename: source.filename };
  }
  return null;
}
export function handoverError(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      INVALID_APPROVED_CONTENT: 'The backend could not publish the approved content safely. Review the approved answers before trying again.',
      VERSION_LIMIT: 'The project has reached the handover version limit.',
      HANDOVER_TOO_LARGE: 'The publication exceeds the backend size limits. Existing published versions are unchanged.',
      INVALID_RESPONSE: 'Relay returned invalid handover data. No new success is confirmed; refresh stored versions or acknowledgment status before retrying.',
    };
    if (messages[error.code]) return `${messages[error.code]} (${error.code})`;
    if (error.status === 409) return 'The handover operation conflicts with current server state (409). Refresh stored results before retrying.';
  }
  return workflowError(error);
}
