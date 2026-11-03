// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectRole } from '../../shared/api-types';
import { RelayApi } from '../src/lib/api';
import LiveClarifications from '../src/pages/LiveClarifications';
import { gap, ids, json, project, root, source, summary, quote } from './workflow-fixtures';
afterEach(cleanup);
const answer = { id: ids.next, projectId: ids.project, gapId: ids.gap, authorId: ids.project, answerText: 'Known context', status: 'PENDING_REVIEW', effectiveReviewStatus: 'PENDING_REVIEW', effectiveText: null, author: { id: ids.project, name: 'Backend author' }, evidence: [], createdAt: '2026-11-03T10:00:00Z' };
const defaults = (path: string) => path.includes('/answers') ? json({ answers: [], nextCursor: null }) : path.endsWith('/sources') ? json({ sources: [summary] }) : path.endsWith(`/sources/${ids.source}`) ? json({ source }) : path.endsWith(`/gaps/${ids.gap}`) ? json({ gap }) : json({ gaps: [gap], nextCursor: null });
function mount(fetcher: typeof fetch, role: ProjectRole = 'OUTGOING') {
  const api = new RelayApi('', fetcher), refreshAccess = vi.fn();
  return { ...render(<LiveClarifications project={{ ...project, role }} api={api} refreshAccess={refreshAccess} />), api, refreshAccess };
}
async function open() { await userEvent.click(await screen.findByRole('button', { name: /Who owns this/ })); await screen.findByRole('heading', { name: 'Who owns this?' }); }
it('loads OPEN gaps, displays linked quotes and submits once while pending, then refreshes history', async () => {
  let finish: (value: Response) => void = () => {}, submitted = false;
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (init?.method === 'POST') return new Promise(resolve => { finish = resolve; });
    if (String(path).includes('/answers') && submitted) return json({ answers: [answer], nextCursor: null });
    return defaults(String(path));
  }); mount(fetcher); await open();
  expect(document.querySelector('blockquote')?.textContent).toBe(quote);
  expect(String(fetcher.mock.calls[0][0])).toContain('status=OPEN');
  await userEvent.type(screen.getByLabelText('Your answer'), answer.answerText);
  const button = screen.getByRole('button', { name: 'Submit clarification' });
  fireEvent.click(button); fireEvent.click(button); await screen.findByText('Submitting clarification…');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(screen.queryByText(/Clarification submitted/)).toBeNull();
  submitted = true; finish(json({ answer }, 201));
  await screen.findByText(/Clarification submitted/); await screen.findByText('Known context');
  expect(fetcher.mock.calls.filter(([path]) => String(path).includes('/answers')).length).toBe(3);
});
it('validates optional evidence against real documents and preserves exact quotes in POST', async () => {
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (init?.method === 'POST') return json({ answer: { ...answer, evidence: [{ id: ids.evidence, responseId: answer.id, projectId: ids.project, documentId: ids.doc, quote, startOffset: 0, endOffset: quote.length, documentSha256: 'hash', createdAt: '' }] } }, 201);
    return defaults(String(path));
  }); mount(fetcher); await open(); await userEvent.type(screen.getByLabelText('Your answer'), answer.answerText);
  await userEvent.click(screen.getByRole('button', { name: 'Add evidence' }));
  await screen.findByRole('option', { name: 'real.txt' }); await userEvent.selectOptions(screen.getByLabelText('Evidence source 1'), ids.source);
  await screen.findByRole('option', { name: /Document 1/ }); await userEvent.selectOptions(screen.getByLabelText('Evidence document 1'), ids.doc);
  await userEvent.type(screen.getByLabelText('Exact quote 1'), 'invented'); await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
  expect((await screen.findByRole('alert')).textContent).toContain('exact');
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  fireEvent.change(screen.getByLabelText('Exact quote 1'), { target: { value: quote } });
  await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' })); await screen.findByText(/Clarification submitted/);
  expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body)).evidence).toEqual([{ documentId: ids.doc, quote }]);
});
it('reviewers read effective review status and corrected text without submission controls', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).includes('/answers') ? json({ answers: [{ ...answer, effectiveReviewStatus: 'EDITED', effectiveText: 'Corrected by reviewer' }], nextCursor: null }) : defaults(String(path)));
  mount(fetcher, 'REVIEWER'); await open(); await screen.findByText('EDITED'); await screen.findByText('Corrected by reviewer');
  expect(screen.queryByLabelText('Your answer')).toBeNull(); expect(screen.queryByRole('button', { name: 'Submit clarification' })).toBeNull();
});
it('incoming cannot make any clarification requests', () => {
  const fetcher = vi.fn<typeof fetch>(); mount(fetcher, 'INCOMING');
  expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeTruthy(); expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 403, 404])('clears history after submission %s', async status => {
  const { refreshAccess } = mount(async (path, init) => init?.method === 'POST' ? json({ error: { code: 'FORBIDDEN' } }, status) : defaults(String(path)));
  await open(); await userEvent.type(screen.getByLabelText('Your answer'), 'Context'); await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
  await screen.findByRole('alert'); expect(screen.queryByLabelText('Your answer')).toBeNull(); expect(screen.queryByRole('heading', { name: 'Answer history' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh project access' })); expect(refreshAccess).toHaveBeenCalledOnce();
});
it.each([409, 0])('keeps the draft and shows no success on conflict/network error %s', async status => {
  mount(async (path, init) => { if (init?.method === 'POST') { if (!status) throw new TypeError('offline'); return json({ error: { code: 'GAP_DISMISSED' } }, status); } return defaults(String(path)); });
  await open(); await userEvent.type(screen.getByLabelText('Your answer'), 'Retain this draft'); await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
  await screen.findByRole('alert'); expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe('Retain this draft');
  expect(screen.queryByText(/Clarification submitted/)).toBeNull();
});
it('ignores stale POST results after switching projects', async () => {
  let finish: (value: Response) => void = () => {};
  const api = new RelayApi('', async (path, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : String(path).startsWith(root) ? defaults(String(path)) : json({ gaps: [], nextCursor: null }));
  const { rerender } = render(<LiveClarifications project={{ ...project, role: 'OUTGOING' }} api={api} refreshAccess={() => {}} />);
  await open(); await userEvent.type(screen.getByLabelText('Your answer'), 'Context'); await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
  rerender(<LiveClarifications project={{ ...project, id: ids.next, role: 'OUTGOING' }} api={api} refreshAccess={() => {}} />);
  finish(json({ answer }, 201)); await screen.findByText('No open gaps on this page.');
  await waitFor(() => expect(screen.queryByText(/Clarification submitted/)).toBeNull());
});
it('paginates both open questions and answer history using scoped backend cursors', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => {
    const value = String(path);
    if (value.includes('/answers')) return json({ answers: [{ ...answer, answerText: value.includes('cursor=') ? 'Later answer' : 'Earlier answer' }], nextCursor: value.includes('cursor=') ? null : answer.id });
    if (value.endsWith(`/gaps/${ids.gap}`)) return json({ gap });
    return json({ gaps: value.includes('cursor=') ? [] : [gap], nextCursor: value.includes('cursor=') ? null : gap.id });
  }); mount(fetcher, 'REVIEWER'); await open(); await screen.findByText('Earlier answer');
  await userEvent.click(screen.getByRole('button', { name: 'Next answers page' })); await screen.findByText('Later answer');
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe(`${root}/gaps/${ids.gap}/answers?limit=50&cursor=${answer.id}`);
  await userEvent.click(screen.getByRole('button', { name: 'Previous answers page' })); await screen.findByText('Earlier answer');
  await userEvent.click(screen.getByRole('button', { name: 'Next questions page' })); await screen.findByText('No open gaps on this page.');
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(`cursor=${gap.id}`);
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('status=OPEN');
  expect(screen.queryByText('Earlier answer')).toBeNull();
});
it('keeps actual submission success distinct from a failed history refresh', async () => {
  let saved = false;
  mount(async (path, init) => {
    if (init?.method === 'POST') { saved = true; return json({ answer }, 201); }
    if (saved && String(path).includes('/answers')) return json({ error: { code: 'INTERNAL_ERROR' } }, 500);
    return defaults(String(path));
  }); await open(); await userEvent.type(screen.getByLabelText('Your answer'), answer.answerText); await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
  await screen.findByText(/Clarification submitted/); await screen.findByRole('alert');
  expect(screen.queryByText('No answers on this page.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry loading' })).toBeTruthy();
});
it('does not claim success for malformed or foreign creation responses', async () => {
  mount(async (path, init) => init?.method === 'POST' ? json({ answer: { ...answer, projectId: ids.next } }, 201) : defaults(String(path)));
  await open(); await userEvent.type(screen.getByLabelText('Your answer'), answer.answerText); await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
  expect((await screen.findByRole('alert')).textContent).toContain('INVALID_RESPONSE'); expect(screen.queryByText(/Clarification submitted/)).toBeNull();
});
it('retries failed evidence loading without submitting the answer form', async () => {
  let fail = true;
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/sources') && fail ? json({ error: { code: 'INTERNAL_ERROR' } }, 500) : defaults(String(path)));
  mount(fetcher); await open(); await userEvent.type(screen.getByLabelText('Your answer'), 'Context');
  await userEvent.click(screen.getByRole('button', { name: 'Add evidence' })); await screen.findByRole('alert'); fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' })); await screen.findByRole('option', { name: 'real.txt' });
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('conflict recovery refreshes the question and history while retaining the draft', async () => {
  let fail = true;
  mount(async (path, init) => init?.method === 'POST' ? fail ? json({ error: { code: 'GAP_DISMISSED' } }, 409) : json({ answer }, 201) : defaults(String(path)));
  await open(); await userEvent.type(screen.getByLabelText('Your answer'), answer.answerText); await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' })); await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: 'Submit clarification' }) as HTMLButtonElement).disabled).toBe(true);
  fail = false; await userEvent.click(screen.getByRole('button', { name: 'Refresh question and answer history' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Submit clarification' }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe(answer.answerText);
  await userEvent.click(screen.getByRole('button', { name: 'Submit clarification' })); await screen.findByText(/Clarification submitted/);
});
it('removes private history immediately when the backend role becomes incoming', async () => {
  const api = new RelayApi('', async path => String(path).includes('/answers') ? json({ answers: [answer], nextCursor: null }) : defaults(String(path)));
  const { rerender } = render(<LiveClarifications project={project} api={api} refreshAccess={() => {}} />);
  await open(); await screen.findByText('Known context');
  rerender(<LiveClarifications project={{ ...project, role: 'INCOMING' }} api={api} refreshAccess={() => {}} />);
  expect(screen.queryByText('Known context')).toBeNull(); expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeTruthy();
});
