import type { Handover, HandoverReceipt } from '../../shared/api-types';
import { ids, quote, root } from './workflow-fixtures';
export const incomingId = '99999999-9999-4999-8999-999999999999';
export const published: Handover = {
  id: ids.run, projectId: ids.project, version: 2, authorId: ids.project, createdAt: '2026-11-03T11:00:00Z', publishedAt: '2026-11-03T11:00:00Z', contentSha256: 'a'.repeat(64),
  content: { schemaVersion: 1, publishedAt: '2026-11-03T11:00:00Z', confirmedKnowledge: [{ status: 'CONFIRMED', gapId: ids.gap, answerId: ids.next, text: 'Reviewed deployment context.\nNext action: Confirm release date.', review: { decisionId: ids.claim, action: 'EDIT', reviewerId: ids.project, reviewerName: 'Human reviewer', sequence: 2, reviewedAt: '2026-11-03T10:00:00Z' }, evidence: [{ evidenceId: ids.evidence, documentId: ids.doc, quote, documentSha256: 'hash', startOffset: 0, endOffset: quote.length, sourceId: ids.source, filename: 'real.txt', sourceType: 'TXT', sourceUrl: `${root}/sources/${ids.source}`, documentUrl: `${root}/sources/${ids.source}/documents/${ids.doc}`, githubUrl: null }] }], unresolvedGaps: [{ status: 'UNKNOWN', gapId: ids.source, category: 'MISSING_OWNER', question: 'Who owns PostgreSQL?' }], nextActions: [{ text: 'Confirm release date.', answerId: ids.next, reviewDecisionId: ids.claim, order: 1, lineNumber: 2 }] },
};
export const receipt: HandoverReceipt = { id: ids.evidence, projectId: ids.project, snapshotId: published.id, snapshotVersion: 2, userId: incomingId, createdAt: '2026-11-03T12:00:00Z' };
export const older: Handover = { ...published, id: ids.claim, version: 1, contentSha256: 'b'.repeat(64), content: { ...published.content, confirmedKnowledge: [], unresolvedGaps: [], nextActions: [] } };
