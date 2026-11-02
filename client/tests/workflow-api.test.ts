import { expect, it, vi } from 'vitest';
import { RelayApi } from '../src/lib/api';
import { extractClaims, fetchClaims, fetchGaps, fetchGap, scanGaps } from '../src/lib/workflow-api';
import { claim, gap, ids, json, root, run } from './workflow-fixtures';
it('uses credentialed supported routes, strict pagination and a longer extraction timeout', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/extractions') ? json({ run }, 201) : String(path).includes('/claims') ? json({ claims: [claim], nextCursor: null }) : json({ gaps: [gap], nextCursor: null }));
  const api = new RelayApi('', fetcher);
  await extractClaims(api, ids.project, [ids.doc]);
  expect(fetcher.mock.calls[0][0]).toBe(`${root}/extractions`);
  expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify({ documentIds: [ids.doc] }));
  expect(timeout).toHaveBeenCalledWith(45_000);
  await fetchClaims(api, ids.project, ids.next);
  await fetchGaps(api, ids.project, { status: 'OPEN', category: 'MISSING_OWNER', cursor: ids.next });
  expect(String(fetcher.mock.calls[1][0])).toContain(`cursor=${ids.next}`);
  expect(String(fetcher.mock.calls[2][0])).toContain('status=OPEN');
  expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
  timeout.mockRestore();
});
it('rejects forged approved claims, cross-project responses and non-successful extraction runs', async () => {
  for (const bad of [{ ...claim, status: 'APPROVED' }, { ...claim, projectId: ids.next }]) {
    await expect(fetchClaims(new RelayApi('', async () => json({ claims: [bad], nextCursor: null })), ids.project)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
  await expect(extractClaims(new RelayApi('', async () => json({ run: { ...run, status: 'FAILED' } })), ids.project, [ids.doc])).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  await expect(fetchGap(new RelayApi('', async () => json({ gap: { ...gap, projectId: ids.next } })), ids.project, ids.gap)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it('validates selection limits and scan responses without inventing results', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({})); const api = new RelayApi('', fetcher);
  await expect(extractClaims(api, ids.project, [])).rejects.toThrow();
  await expect(extractClaims(api, ids.project, [ids.doc, ids.doc])).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(scanGaps(api, ids.project)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it('distinguishes transport timeout from a completed failed provider run', async () => {
  await expect(new RelayApi('', async () => { throw new DOMException('timeout', 'TimeoutError'); }).request(`${root}/extractions`)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
});
it('rejects foreign evidence paths and malformed cursors', async () => {
  const api = new RelayApi('', async () => json({ claims: [{ ...claim, evidence: [{ ...claim.evidence[0], documentUrl: '/api/projects/other/sources/private' }] }], nextCursor: null }));
  await expect(fetchClaims(api, ids.project)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  await expect(fetchGaps(new RelayApi('', async () => json({ gaps: [gap] })), ids.project)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
