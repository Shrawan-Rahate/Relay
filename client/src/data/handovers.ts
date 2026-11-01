import type { ConfirmedKnowledge, NextAction, UnknownGap } from '../../../shared/api-types';
import { gaps } from './demo';
import { effectiveAnswer, type DemoAnswer, type DemoAnswerEvidence } from './clarifications';

export type PreviewKnowledge = Pick<ConfirmedKnowledge, 'gapId' | 'answerId' | 'text'> & {
  evidence: DemoAnswerEvidence[]; reviewOrder: number;
};
export type PreviewAction = Pick<NextAction, 'text' | 'answerId'> & {
  order: number; lineNumber: number; reviewOrder: number; evidence: DemoAnswerEvidence[];
};
export interface HandoverPreviewContent { knowledge: PreviewKnowledge[]; unknown: UnknownGap[]; nextActions: PreviewAction[] }
export interface DemoHandoverVersion { version: number; kind: 'publication-preview'; content: HandoverPreviewContent }

/** Local view model only. No reviewer identities, receipts, publication timestamps, or API IDs are invented. */
export function buildHandoverPreview(answers: DemoAnswer[]): HandoverPreviewContent {
  const latest = new Map<string, PreviewKnowledge>();
  for (const answer of answers) {
    const effective = effectiveAnswer(answer);
    if (effective.text === null || !['APPROVED', 'EDITED'].includes(effective.status)) continue;
    const reviewOrder = answer.decisions.at(-1)!.previewOrder;
    const prior = latest.get(answer.gapId);
    if (!prior || prior.reviewOrder < reviewOrder) latest.set(answer.gapId, {
      gapId: answer.gapId, answerId: answer.id, text: effective.text,
      evidence: answer.evidence.map(item => ({ sourceId: item.sourceId, quote: item.quote })), reviewOrder,
    });
  }
  const knowledge = Array.from(latest.values()).sort((a, b) => b.reviewOrder - a.reviewOrder);
  const nextActions: PreviewAction[] = [];
  for (const item of knowledge) {
    item.text.split(/\r\n|\n|\r/).forEach((line, index) => {
      const match = /^\s*(?:[-*]\s*)?next action:\s*(.*)$/i.exec(line);
      if (match?.[1].trim()) nextActions.push({
        text: match[1], answerId: item.answerId, order: nextActions.length + 1,
        lineNumber: index + 1, reviewOrder: item.reviewOrder,
        evidence: item.evidence.map(evidence => ({ ...evidence })),
      });
    });
  }
  // Local resolve-gap requests deliberately do not mutate the demo gaps.
  const unknown: UnknownGap[] = gaps.filter(gap => gap.status === 'OPEN').map(gap => ({
    status: 'UNKNOWN', gapId: gap.id, category: gap.category, question: gap.question,
  }));
  return { knowledge, unknown, nextActions };
}
export function publicationPreview(content: HandoverPreviewContent, version: number): DemoHandoverVersion {
  return { version, kind: 'publication-preview', content: structuredClone(content) };
}
