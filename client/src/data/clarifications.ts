import type { AnswerRequest, EffectiveReviewStatus, ReviewedAnswer, ReviewRequest } from '../../../shared/api-types';
import { gaps, sources } from './demo';

export interface DemoAnswerEvidence { sourceId: string; quote: string }
export interface LocalDecision { sequence: number; request: ReviewRequest }
export type DemoAnswer = Pick<ReviewedAnswer, 'id' | 'gapId' | 'answerText' | 'status'> & {
  origin: 'fixture' | 'local'; evidence: DemoAnswerEvidence[]; decisions: LocalDecision[];
};
export const initialAnswers: DemoAnswer[] = [
  { id: 'demo-answer-1', gapId: gaps[0].id, answerText: 'The notes do not establish permanent retry ownership. Next action: confirm the accountable team and document the alert escalation path.', status: 'PENDING_REVIEW', origin: 'fixture', evidence: [{ ...gaps[0].evidence[1] }], decisions: [] },
  { id: 'demo-answer-2', gapId: gaps[3].id, answerText: 'The transition notes distinguish internal testing from external release. Next action: confirm the privacy review before external release.', status: 'PENDING_REVIEW', origin: 'fixture', evidence: [{ ...gaps[3].evidence[0] }], decisions: [] },
];
export function effectiveAnswer(answer: DemoAnswer): { status: EffectiveReviewStatus; text: string | null } {
  const decision = answer.decisions.at(-1)?.request;
  if (!decision) return { status: 'PENDING_REVIEW', text: null };
  switch (decision.action) {
    case 'APPROVE': return { status: 'APPROVED', text: answer.answerText };
    case 'EDIT': return { status: 'EDITED', text: decision.correctedText };
    case 'REJECT': return { status: 'REJECTED', text: null };
    case 'DEFER': return { status: 'DEFERRED', text: null };
  }
}
export const isReviewable = (answer: DemoAnswer) => ['PENDING_REVIEW', 'DEFERRED'].includes(effectiveAnswer(answer).status);
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function answerIssue(answer: AnswerRequest): string | null {
  if (!answer.answerText.trim() || answer.answerText.length > 10000 || controls.test(answer.answerText)) return 'Enter an answer of 1–10,000 characters without unsupported control characters.';
  if ((answer.evidence?.length ?? 0) > 10) return 'Attach at most 10 evidence quotes.';
  const seen = new Set<string>();
  for (const entry of answer.evidence ?? []) {
    const source = sources.find(source => `demo-document-${source.id}` === entry.documentId);
    if (!entry.quote.trim() || entry.quote.length > 4000 || controls.test(entry.quote) || !source?.content.includes(entry.quote)) return 'Evidence must be an exact, nonblank quote from the selected demo source, up to 4,000 characters.';
    const key = JSON.stringify([entry.documentId, entry.quote]);
    if (seen.has(key)) return 'Remove duplicate evidence quotes.';
    seen.add(key);
  }
  return null;
}
export function reviewIssue(request: ReviewRequest): string | null {
  if (request.action === 'EDIT' && (!request.correctedText.trim() || request.correctedText.length > 10000 || controls.test(request.correctedText))) return 'EDIT requires corrected text of 1–10,000 characters without unsupported control characters.';
  if ((request.action === 'REJECT' || request.action === 'DEFER') && !request.reason?.trim()) return `${request.action} requires a reason.`;
  if (request.reason && (request.reason.length > 5000 || controls.test(request.reason))) return 'Use a reason of at most 5,000 characters without unsupported control characters.';
  return null;
}
