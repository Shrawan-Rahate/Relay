import type { Project, QueuedAnswer, ReviewedAnswer, ReviewDecision, ReviewHistoryResponse, ReviewRequest, ReviewResponse, SourceDocument } from '../../../shared/api-types';
import { ApiError, type RelayApi } from './api';
import { gapCategories, invalidWorkflow, workflowError } from './workflow-api';
import { getSource, listSources } from './source-api';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = { APPROVE: 'APPROVED', EDIT: 'EDITED', REJECT: 'REJECTED', DEFER: 'DEFERRED' } as const;
function id(value: string) { if (!uuid.test(value)) throw invalidWorkflow(); return value; }
function base(project: Project) {
  if (project.role !== 'REVIEWER') throw new ApiError(403, 'FORBIDDEN', 'Reviewer role required.');
  return `/api/projects/${id(project.id)}`;
}
const answerPath = (project: Project, gapId: string, answerId: string) => `${base(project)}/gaps/${id(gapId)}/answers/${id(answerId)}`;
const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
export function reviewValidation(input: ReviewRequest): string | null {
  if (!input || !Object.hasOwn(statuses, input.action)) return 'Choose a supported review action.';
  if (input.action === 'EDIT' && !text(input.correctedText, 10000)) return 'Enter nonblank corrected text of at most 10,000 characters without invalid control characters.';
  if ((input.action === 'REJECT' || input.action === 'DEFER' || input.reason !== undefined) && !text(input.reason, 5000)) return 'Enter a nonblank review reason of at most 5,000 characters without invalid control characters.';
  if (input.resolveGap !== undefined && typeof input.resolveGap !== 'boolean') return 'Choose whether to resolve the gap.';
  if (input.resolveGap && !['APPROVE', 'EDIT'].includes(input.action)) return 'Only approve or edit can resolve a knowledge gap.';
  return null;
}
function checkedAnswer(answer: ReviewedAnswer, projectId: string, gapId?: string, answerId?: string) {
  if (!answer || !uuid.test(answer.id) || answer.projectId !== projectId || !uuid.test(answer.gapId) || (gapId && answer.gapId !== gapId) || (answerId && answer.id !== answerId)
    || !uuid.test(answer.authorId) || typeof answer.answerText !== 'string' || typeof answer.createdAt !== 'string' || answer.status !== 'PENDING_REVIEW'
    || !['PENDING_REVIEW', ...Object.values(statuses)].includes(answer.effectiveReviewStatus)) throw invalidWorkflow();
  if (answer.effectiveReviewStatus === 'APPROVED' ? answer.effectiveText !== answer.answerText : answer.effectiveReviewStatus === 'EDITED' ? !text(answer.effectiveText, 10000) : answer.effectiveText !== null) throw invalidWorkflow();
}
function checkedQueue(answer: QueuedAnswer, projectId: string) {
  checkedAnswer(answer, projectId);
  if (!['PENDING_REVIEW', 'DEFERRED'].includes(answer.effectiveReviewStatus) || !answer.author || answer.author.id !== answer.authorId
    || !(answer.author.name === null || typeof answer.author.name === 'string') || !Array.isArray(answer.evidence)
    || !answer.gap || answer.gap.id !== answer.gapId || !gapCategories.includes(answer.gap.category) || typeof answer.gap.question !== 'string'
    || !['OPEN', 'RESOLVED', 'DISMISSED'].includes(answer.gap.status)) throw invalidWorkflow();
  for (const evidence of answer.evidence) {
    if (!evidence || !uuid.test(evidence.id) || evidence.projectId !== projectId || evidence.responseId !== answer.id || !uuid.test(evidence.documentId)
      || typeof evidence.quote !== 'string' || !Number.isSafeInteger(evidence.startOffset) || evidence.startOffset < 0 || evidence.endOffset !== evidence.startOffset + evidence.quote.length
      || typeof evidence.documentSha256 !== 'string') throw invalidWorkflow();
  }
}
function checkedDecision(decision: ReviewDecision, projectId: string, answerId: string) {
  if (!decision || !uuid.test(decision.id) || decision.projectId !== projectId || decision.responseId !== answerId || !uuid.test(decision.reviewerId)
    || !Number.isSafeInteger(decision.sequence) || decision.sequence < 1 || !Object.hasOwn(statuses, decision.action) || typeof decision.resolveGap !== 'boolean'
    || typeof decision.createdAt !== 'string' || !decision.reviewer || decision.reviewer.id !== decision.reviewerId
    || !(decision.reviewer.name === null || typeof decision.reviewer.name === 'string') || !(decision.reason === null || text(decision.reason, 5000))) throw invalidWorkflow();
  if (decision.action === 'EDIT' ? !text(decision.correctedText, 10000) : decision.correctedText !== null) throw invalidWorkflow();
  if (['REJECT', 'DEFER'].includes(decision.action) && (!text(decision.reason, 5000) || decision.resolveGap)) throw invalidWorkflow();
}
export async function fetchReviewQueue(api: RelayApi, project: Project, cursor?: string) {
  const path = base(project), query = new URLSearchParams({ limit: '50' }); if (cursor) query.set('cursor', id(cursor));
  const body = await api.request<{ answers: QueuedAnswer[]; nextCursor: string | null }>(`${path}/reviews/queue?${query}`);
  if (!Array.isArray(body?.answers) || (body.nextCursor !== null && (!uuid.test(body.nextCursor) || body.nextCursor === cursor))) throw invalidWorkflow();
  body.answers.forEach(answer => checkedQueue(answer, project.id)); return body;
}
export async function fetchReviewHistory(api: RelayApi, project: Project, gapId: string, answerId: string, after = 0) {
  const path = answerPath(project, gapId, answerId);
  if (!Number.isSafeInteger(after) || after < 0 || after > 2147483647) throw invalidWorkflow();
  const body = await api.request<ReviewHistoryResponse>(`${path}/reviews?${new URLSearchParams({ limit: '50', after: String(after) })}`);
  checkedAnswer(body?.answer, project.id, gapId, answerId);
  if (!Array.isArray(body.reviews)) throw invalidWorkflow();
  let previous = after;
  for (const decision of body.reviews) { checkedDecision(decision, project.id, answerId); if (decision.sequence <= previous) throw invalidWorkflow(); previous = decision.sequence; }
  if (body.nextAfter !== null && (!Number.isSafeInteger(body.nextAfter) || body.nextAfter <= after || body.nextAfter !== previous || body.nextAfter > 2147483647)) throw invalidWorkflow();
  return body;
}
export async function submitReview(api: RelayApi, project: Project, gapId: string, answerId: string, input: ReviewRequest) {
  const path = answerPath(project, gapId, answerId), issue = reviewValidation(input);
  if (issue) throw new ApiError(400, 'INVALID_INPUT', issue);
  const request = { action: input.action, ...(input.reason === undefined ? {} : { reason: input.reason }), ...(input.action === 'EDIT' ? { correctedText: input.correctedText } : {}), resolveGap: input.resolveGap ?? false };
  const body = await api.request<ReviewResponse>(`${path}/review`, { method: 'POST', body: JSON.stringify(request) });
  checkedAnswer(body?.answer, project.id, gapId, answerId); checkedDecision(body?.decision, project.id, answerId);
  if (body.decision.action !== input.action || body.decision.resolveGap !== request.resolveGap || body.decision.reason !== (input.reason ?? null)
    || body.answer.effectiveReviewStatus !== statuses[input.action] || (input.action === 'EDIT' && (body.decision.correctedText !== input.correctedText || body.answer.effectiveText !== input.correctedText))) throw invalidWorkflow();
  return body;
}
export type ReviewDocument = { document: SourceDocument; filename: string };
export async function resolveReviewEvidence(api: RelayApi, project: Project, answer: QueuedAnswer): Promise<ReviewDocument[]> {
  base(project); checkedAnswer(answer, project.id);
  if (answer.evidence.some(e => e.projectId !== project.id || e.responseId !== answer.id || !uuid.test(e.documentId))) throw invalidWorkflow();
  const remaining = new Set(answer.evidence.map(e => e.documentId)), documents: ReviewDocument[] = [];
  if (!remaining.size) return documents;
  // Answer evidence has no source ID. Resolve only against this project's actual sources.
  for (const summary of await listSources(api, project.id)) {
    const source = await getSource(api, project.id, summary.id);
    for (const document of source.documents) if (remaining.delete(document.id)) documents.push({ document, filename: source.filename });
    if (!remaining.size) break;
  }
  return documents;
}
export function reviewError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'ANSWER_ALREADY_REVIEWED') return 'Another final decision already exists (ANSWER_ALREADY_REVIEWED). Refresh review history before continuing.';
    if (error.code === 'GAP_DISMISSED') return 'This gap was dismissed (GAP_DISMISSED). Refresh history and leave gap resolution unchecked.';
    if (error.status === 409) return 'The review conflicts with current server state (409). Refresh review history before continuing.';
    if (error.code === 'INVALID_INPUT') return 'The backend rejected the review. Check the action, corrected text, reason and resolution option.';
    if (error.code === 'INVALID_RESPONSE') return 'The response could not confirm the review. Refresh review history before retrying; the outcome is unknown.';
  }
  return workflowError(error);
}
