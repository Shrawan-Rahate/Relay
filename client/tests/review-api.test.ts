import { expect, it, vi } from 'vitest';
import type { ReviewRequest } from '../../shared/api-types';
import { RelayApi } from '../src/lib/api';
import { fetchReviewQueue, fetchReviewHistory, submitReview, reviewValidation, resolveReviewEvidence } from '../src/lib/review-api';
import { ids, json, project, root, source, summary } from './workflow-fixtures';
import { queued, reviewed } from './review-fixtures';
const answerPath = `${root}/gaps/${ids.gap}/answers/${queued.id}`;
it.each([{ action: 'APPROVE' }, { action: 'EDIT', correctedText: ' Corrected answer.\n', resolveGap: true }, { action: 'REJECT', reason: 'Unsupported' }, { action: 'DEFER', reason: 'Need context' }] satisfies ReviewRequest[])('posts $action with exact values, cookies and default resolveGap false', async input => {
  const fetcher = vi.fn<typeof fetch>(async () => json(reviewed(input), 201));
  const result = await submitReview(new RelayApi('', fetcher), project, queued.gapId, queued.id, input);
  expect(result.decision.action).toBe(input.action);
  expect(fetcher.mock.calls[0][0]).toBe(`${answerPath}/review`);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ ...input, resolveGap: input.resolveGap ?? false });
  expect(fetcher.mock.calls[0][1]?.credentials).toBe('include');
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
});
it('validates corrected text, required reasons, control characters and resolution rules before requests', async () => {
  const fetcher = vi.fn(), api = new RelayApi('', fetcher);
  for (const input of [{ action: 'EDIT', correctedText: '  ' }, { action: 'EDIT', correctedText: 'x'.repeat(10001) }, { action: 'REJECT', reason: '' }, { action: 'DEFER', reason: '\u0000' }, { action: 'APPROVE', reason: 'x'.repeat(5001) }, { action: 'REJECT', reason: 'No', resolveGap: true }, { action: 'DEFER', reason: 'Later', resolveGap: true }] as ReviewRequest[]) {
    expect(reviewValidation(input)).toBeTruthy(); await expect(submitReview(api, project, ids.gap, queued.id, input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['OUTGOING', 'INCOMING'] as const)('does not request reviewer resources as %s', async role => {
  const fetcher = vi.fn(), api = new RelayApi('', fetcher), p = { ...project, role };
  await expect(fetchReviewQueue(api, p)).rejects.toMatchObject({ status: 403 });
  await expect(fetchReviewHistory(api, p, ids.gap, queued.id)).rejects.toMatchObject({ status: 403 });
  await expect(submitReview(api, p, ids.gap, queued.id, { action: 'APPROVE' })).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
});
it('uses supported queue and history pagination and accepts deferred queue entries', async () => {
  const result = reviewed({ action: 'DEFER', reason: 'Later' });
  const fetcher = vi.fn<typeof fetch>(async path => String(path).includes('/queue') ? json({ answers: [{ ...queued, ...result.answer }], nextCursor: null }) : json({ answer: result.answer, reviews: [result.decision], nextAfter: null }));
  const api = new RelayApi('', fetcher);
  expect((await fetchReviewQueue(api, project, ids.claim)).answers[0].effectiveReviewStatus).toBe('DEFERRED');
  await fetchReviewHistory(api, project, ids.gap, queued.id, 0);
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([`${root}/reviews/queue?limit=50&cursor=${ids.claim}`, `${answerPath}/reviews?limit=50&after=0`]);
});
it('rejects cross-project queue, history, evidence and mismatched confirmed decisions', async () => {
  for (const bad of [{ ...queued, projectId: ids.source }, { ...queued, evidence: [{ ...queued.evidence[0], projectId: ids.source }] }, { ...queued, gap: { ...queued.gap, id: ids.source } }, { ...queued, effectiveReviewStatus: 'APPROVED' }]) {
    await expect(fetchReviewQueue(new RelayApi('', async () => json({ answers: [bad], nextCursor: null })), project)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
  const result = reviewed({ action: 'APPROVE' });
  await expect(fetchReviewHistory(new RelayApi('', async () => json({ answer: result.answer, reviews: [{ ...result.decision, projectId: ids.source }], nextAfter: null })), project, ids.gap, queued.id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  await expect(submitReview(new RelayApi('', async () => json(reviewed({ action: 'REJECT', reason: 'No' }), 201)), project, ids.gap, queued.id, { action: 'APPROVE' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it.each([[409, 'ANSWER_ALREADY_REVIEWED'], [409, 'GAP_DISMISSED'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND']])('preserves %s %s for safe handling', async (status, code) => {
  const api = new RelayApi('', async () => json({ error: { code, message: 'secret' } }, status as number)), expired = vi.fn(); api.onUnauthorized(expired);
  await expect(submitReview(api, project, ids.gap, queued.id, { action: 'APPROVE' })).rejects.toMatchObject({ status, code });
  expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});
it('resolves supporting documents only through same-project sources', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/sources') ? json({ sources: [summary] }) : json({ source }));
  const docs = await resolveReviewEvidence(new RelayApi('', fetcher), project, queued);
  expect(docs[0].document.id).toBe(ids.doc); expect(docs[0].filename).toBe('real.txt');
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([`${root}/sources`, `${root}/sources/${ids.source}`]);
  await expect(resolveReviewEvidence(new RelayApi('', async () => json({ sources: [{ ...summary, projectId: ids.next }] })), project, queued)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
