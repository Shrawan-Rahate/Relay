import { expect, it, vi } from 'vitest';
import { RelayApi } from '../src/lib/api';
import { answerValidation, fetchAnswers, submitAnswer } from '../src/lib/clarification-api';
import { ids, json, project, source, quote, root } from './workflow-fixtures';
export const answer = { id: ids.next, projectId: ids.project, gapId: ids.gap, authorId: ids.project, answerText: 'Known context', status: 'PENDING_REVIEW', effectiveReviewStatus: 'PENDING_REVIEW', effectiveText: null, author: { id: ids.project, name: 'Backend author' }, evidence: [], createdAt: '2026-11-03T10:00:00Z' };
it('validates exact evidence, control characters, lengths, duplicates, and project scope', () => {
  const docs = [source.documents[0]];
  expect(answerValidation({ answerText: 'Answer', evidence: [{ documentId: ids.doc, quote }] }, docs, ids.project)).toBeNull();
  for (const request of [{ answerText: ' ' }, { answerText: 'x'.repeat(10001) }, { answerText: 'bad\u0000' }, { answerText: 'Answer', evidence: [{ documentId: ids.doc, quote: 'not in source' }] }, { answerText: 'Answer', evidence: [{ documentId: ids.doc, quote }, { documentId: ids.doc, quote }] }, { answerText: 'Answer', evidence: Array.from({ length: 11 }, () => ({ documentId: ids.doc, quote })) }]) expect(answerValidation(request, docs, ids.project)).toBeTruthy();
  expect(answerValidation({ answerText: 'Answer', evidence: [{ documentId: ids.doc, quote }] }, docs, ids.next)).toBeTruthy();
});
it('posts only answer text/evidence and reads cursor-paginated scoped history with credentials', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => init?.method === 'POST' ? json({ answer }, 201) : json({ answers: [answer], nextCursor: null }));
  const api = new RelayApi('', fetcher);
  await submitAnswer(api, { ...project, role: 'OUTGOING' }, ids.gap, { answerText: answer.answerText, evidence: [] }, []);
  await fetchAnswers(api, project, ids.gap, ids.next);
  expect(fetcher.mock.calls[0][0]).toBe(`${root}/gaps/${ids.gap}/answers`);
  expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify({ answerText: answer.answerText, evidence: [] }));
  expect(String(fetcher.mock.calls[1][0])).toContain(`cursor=${ids.next}`);
  expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
});
it('blocks incoming history and non-outgoing writes before requests', async () => {
  const fetcher = vi.fn<typeof fetch>(); const api = new RelayApi('', fetcher);
  await expect(fetchAnswers(api, { ...project, role: 'INCOMING' }, ids.gap)).rejects.toMatchObject({ status: 403 });
  for (const role of ['REVIEWER', 'INCOMING'] as const) await expect(submitAnswer(api, { ...project, role }, ids.gap, { answerText: 'Context' }, [])).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects foreign answers and fabricated approval on create responses', async () => {
  for (const bad of [{ ...answer, gapId: ids.next }, { ...answer, projectId: ids.next }, { ...answer, effectiveReviewStatus: 'APPROVED', effectiveText: 'Approved' }]) {
    await expect(submitAnswer(new RelayApi('', async () => json({ answer: bad }, 201)), { ...project, role: 'OUTGOING' }, ids.gap, { answerText: answer.answerText }, [])).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
});
