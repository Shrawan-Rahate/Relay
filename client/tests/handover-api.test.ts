import { expect, it, vi } from 'vitest';
import { RelayApi } from '../src/lib/api';
import { acknowledgeHandover, fetchHandover, fetchHandovers, publishHandover, readPublishedEvidence } from '../src/lib/handover-api';
import { ids, json, project, root, source, summary } from './workflow-fixtures';
import { incomingId, older, published, receipt } from './handover-fixtures';
const base = `${root}/handovers`;
it('lists descending versions and publishes only an empty body with cookie credentials', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_, init) => init?.method === 'POST' ? json({ handover: published }, 201) : json({ handovers: [older], nextBeforeVersion: null }));
  const api = new RelayApi('', fetcher); await fetchHandovers(api, project, 2); expect(await publishHandover(api, project)).toEqual(published);
  expect(fetcher.mock.calls[0][0]).toBe(`${base}?limit=50&beforeVersion=2`);
  expect(fetcher.mock.calls[1][0]).toBe(base); expect(fetcher.mock.calls[1][1]?.body).toBe('{}');
  expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'include' && !new Headers(init?.headers).has('Authorization'))).toBe(true);
});
it('paginates reviewer receipts and sends no detail query for nonreviewers', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).includes('?') ? json({ handover: published, receipts: [receipt], nextReceiptCursor: null }) : json({ handover: published, receipt }));
  const api = new RelayApi('', fetcher);
  await fetchHandover(api, project, published, incomingId, ids.doc);
  await fetchHandover(api, { ...project, role: 'INCOMING' }, published, incomingId);
  await fetchHandover(api, { ...project, role: 'OUTGOING' }, published, incomingId);
  expect(fetcher.mock.calls.map(([p]) => p)).toEqual([`${base}/${published.id}?receiptLimit=50&receiptCursor=${ids.doc}`, `${base}/${published.id}`, `${base}/${published.id}`]);
});
it.each([200, 201])('accepts idempotent acknowledgment status %s for the exact snapshot and identity', async status => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ receipt }, status)), api = new RelayApi('', fetcher);
  expect(await acknowledgeHandover(api, { ...project, role: 'INCOMING' }, published, incomingId)).toEqual(receipt);
  expect(fetcher.mock.calls[0][0]).toBe(`${base}/${published.id}/acknowledge`); expect(fetcher.mock.calls[0][1]?.body).toBe('{}');
});
it('rejects unauthorized actions without making requests', async () => {
  const fetcher = vi.fn(), api = new RelayApi('', fetcher);
  for (const role of ['OUTGOING', 'INCOMING'] as const) await expect(publishHandover(api, { ...project, role })).rejects.toMatchObject({ status: 403 });
  for (const role of ['OUTGOING', 'REVIEWER'] as const) await expect(acknowledgeHandover(api, { ...project, role }, published, incomingId)).rejects.toMatchObject({ status: 403 });
  await expect(fetchHandover(api, { ...project, role: 'INCOMING' }, published, incomingId, ids.doc)).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects foreign receipts, wrong versions, and reviewer receipt arrays sent to incoming users', async () => {
  const p = { ...project, role: 'INCOMING' as const };
  for (const bad of [{ ...receipt, userId: ids.project }, { ...receipt, projectId: ids.next }, { ...receipt, snapshotId: ids.next }, { ...receipt, snapshotVersion: 1 }]) {
    const api = new RelayApi('', async () => json({ handover: published, receipt: bad }));
    await expect(fetchHandover(api, p, published, incomingId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(acknowledgeHandover(api, p, published, incomingId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
  await expect(fetchHandover(new RelayApi('', async () => json({ handover: published, receipts: [receipt], nextReceiptCursor: null })), p, published, incomingId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it.each(['DEFER', 'REJECT'])('never accepts %s as confirmed knowledge', async action => {
  const item = published.content.confirmedKnowledge[0];
  const bad = { ...published, content: { ...published.content, confirmedKnowledge: [{ ...item, review: { ...item.review, action } }] } };
  await expect(publishHandover(new RelayApi('', async () => json({ handover: bad }, 201)), project)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it('rejects foreign snapshots, unsafe evidence paths and malformed pagination', async () => {
  const item = published.content.confirmedKnowledge[0];
  for (const bad of [{ ...published, projectId: ids.next }, { ...published, content: { ...published.content, confirmedKnowledge: [{ ...item, status: 'UNVERIFIED' }] } }, { ...published, content: { ...published.content, confirmedKnowledge: [{ ...item, evidence: [{ ...item.evidence[0], documentUrl: '/api/projects/foreign/documents/private' }] }] } }]) {
    await expect(publishHandover(new RelayApi('', async () => json({ handover: bad }, 201)), project)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
  await expect(fetchHandovers(new RelayApi('', async () => json({ handovers: [older], nextBeforeVersion: 2 })), project, 2)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it('reads new evidence directly and resolves legacy evidence through same-project sources', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).includes('/documents/') ? json({ document: source.documents[0] }) : String(path).endsWith('/sources') ? json({ sources: [summary] }) : json({ source }));
  const api = new RelayApi('', fetcher), evidence = published.content.confirmedKnowledge[0].evidence[0];
  expect((await readPublishedEvidence(api, project, evidence))?.document.id).toBe(ids.doc);
  const { sourceId: _sourceId, filename: _filename, sourceType: _type, sourceUrl: _sourceUrl, documentUrl: _documentUrl, githubUrl: _github, ...legacy } = evidence;
  expect((await readPublishedEvidence(api, project, legacy))?.filename).toBe('real.txt');
  expect(fetcher.mock.calls.map(([p]) => p)).toEqual([evidence.documentUrl, `${root}/sources`, `${root}/sources/${ids.source}`]);
});
it.each([[401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'INVALID_APPROVED_CONTENT'], [409, 'VERSION_LIMIT']])('preserves %s %s without leaking error detail', async (status, code) => {
  const api = new RelayApi('', async () => json({ error: { code, message: 'private backend detail' } }, status as number));
  await expect(publishHandover(api, project)).rejects.toMatchObject({ status, code });
  await expect(publishHandover(api, project)).rejects.not.toThrow('private backend detail');
});
