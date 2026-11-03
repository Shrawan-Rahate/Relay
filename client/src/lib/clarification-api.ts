import type { Answer, AnswerRequest, Project, SourceDocument } from '../../../shared/api-types';
import { ApiError, type RelayApi } from './api';
import { invalidWorkflow, workflowError } from './workflow-api';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function answerValidation(request: AnswerRequest, documents: SourceDocument[], projectId: string): string | null {
  if (!request.answerText.trim() || request.answerText.length > 10000 || badText.test(request.answerText)) return 'Enter a nonblank answer of at most 10,000 characters without invalid control characters.';
  const evidence = request.evidence ?? [];
  if (evidence.length > 10) return 'Attach at most 10 evidence entries.';
  const seen = new Set<string>();
  for (const item of evidence) {
    if (!uuid.test(item.documentId) || !item.quote.trim() || item.quote.length > 4000 || badText.test(item.quote)) return 'Choose a source document and enter a nonblank exact quote of at most 4,000 characters.';
    const key = JSON.stringify([item.documentId, item.quote]);
    if (seen.has(key)) return 'Remove duplicate document and quote pairs.';
    seen.add(key);
    const doc = documents.find(doc => doc.id === item.documentId && doc.projectId === projectId);
    if (!doc || !doc.content.includes(item.quote)) return 'Each evidence quote must exactly match a loaded document in this project. Preserve whitespace and punctuation.';
  }
  return null;
}
function path(project: Project, gapId: string, write = false) {
  // UI eligibility never replaces backend authorization on every request.
  if (write ? project.role !== 'OUTGOING' : !['OUTGOING', 'REVIEWER'].includes(project.role)) throw new ApiError(403, 'FORBIDDEN', 'Your project role cannot access this clarification action.');
  if (!uuid.test(project.id) || !uuid.test(gapId)) throw invalidWorkflow();
  return `/api/projects/${project.id}/gaps/${gapId}/answers`;
}
function checked(answer: Answer, projectId: string, gapId: string) {
  if (!answer || !uuid.test(answer.id) || answer.projectId !== projectId || answer.gapId !== gapId || answer.status !== 'PENDING_REVIEW'
    || typeof answer.answerText !== 'string' || !uuid.test(answer.authorId) || typeof answer.createdAt !== 'string' || !answer.author || answer.author.id !== answer.authorId
    || !(answer.author.name === null || typeof answer.author.name === 'string') || !Array.isArray(answer.evidence)
    || !['PENDING_REVIEW', 'APPROVED', 'EDITED', 'REJECTED', 'DEFERRED'].includes(answer.effectiveReviewStatus)) throw invalidWorkflow();
  const effective = ['APPROVED', 'EDITED'].includes(answer.effectiveReviewStatus);
  if (effective ? typeof answer.effectiveText !== 'string' : answer.effectiveText !== null) throw invalidWorkflow();
  answer.evidence.forEach(item => {
    if (!item || !uuid.test(item.id) || item.projectId !== projectId || item.responseId !== answer.id || !uuid.test(item.documentId) || typeof item.quote !== 'string'
      || typeof item.documentSha256 !== 'string' || !Number.isSafeInteger(item.startOffset) || item.startOffset < 0 || item.endOffset !== item.startOffset + item.quote.length) throw invalidWorkflow();
  });
  return answer;
}
export async function fetchAnswers(api: RelayApi, project: Project, gapId: string, cursor?: string) {
  const base = path(project, gapId), query = new URLSearchParams({ limit: '50' });
  if (cursor) { if (!uuid.test(cursor)) throw invalidWorkflow(); query.set('cursor', cursor); }
  const body = await api.request<{ answers: Answer[]; nextCursor: string | null }>(`${base}?${query}`);
  if (!Array.isArray(body?.answers) || (body.nextCursor !== null && (!uuid.test(body.nextCursor) || body.nextCursor === cursor))) throw invalidWorkflow();
  body.answers.forEach(answer => checked(answer, project.id, gapId)); return body;
}
export async function submitAnswer(api: RelayApi, project: Project, gapId: string, request: AnswerRequest, documents: SourceDocument[]) {
  const base = path(project, gapId, true);
  const issue = answerValidation(request, documents, project.id);
  if (issue) throw new ApiError(400, 'INVALID_INPUT', issue);
  const body = await api.request<{ answer: Answer }>(base, { method: 'POST', body: JSON.stringify({ answerText: request.answerText, evidence: request.evidence ?? [] }) });
  const answer = checked(body?.answer, project.id, gapId);
  if (answer.effectiveReviewStatus !== 'PENDING_REVIEW' || answer.answerText !== request.answerText
    || answer.evidence.length !== (request.evidence ?? []).length
    || (request.evidence ?? []).some(item => !answer.evidence.some(saved => item.documentId === saved.documentId && item.quote === saved.quote))) throw invalidWorkflow();
  return answer;
}
export function clarificationError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_RESPONSE') return 'The backend response could not confirm submission (INVALID_RESPONSE). The outcome is unknown; refresh answer history before retrying.';
    if (error.status === 409) return `The backend reported a conflict (${error.code}). Refresh the question and answer history before submitting again. No submission success is confirmed.`;
    if (error.code === 'INVALID_EVIDENCE') return 'The backend rejected the evidence quote (INVALID_EVIDENCE). Reload the document and copy an exact quote.';
    if (error.code === 'INVALID_INPUT') return 'The backend rejected the answer or evidence (INVALID_INPUT). Check the text, limits, and document selection.';
  }
  return workflowError(error);
}
