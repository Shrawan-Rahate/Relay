// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewRequest } from '../../shared/api-types';
import { RelayApi } from '../src/lib/api';
import LiveReviewerQueue from '../src/pages/LiveReviewerQueue';
import { ids, json, project, quote, source, summary } from './workflow-fixtures';
import { queued, reviewed } from './review-fixtures';
afterEach(cleanup);
const initialHistory = { answer: queued, reviews: [], nextAfter: null };
const defaults = (path: string) => path.endsWith('/sources') ? json({ sources: [summary] }) : path.endsWith(`/sources/${ids.source}`) ? json({ source }) : path.includes('/reviews/queue') ? json({ answers: [queued], nextCursor: null }) : json(initialHistory);
const mount = (fetcher: typeof fetch) => render(<LiveReviewerQueue project={project} api={new RelayApi('', fetcher)} refreshAccess={() => {}} />);
async function open() { await userEvent.click(await screen.findByRole('button', { name: /Review answer.*Who owns this/ })); await screen.findByText('No review decisions yet.'); }
it.each(['APPROVE', 'EDIT', 'REJECT', 'DEFER'] as const)('submits %s once, then refreshes queue and review history from confirmed data', async action => {
  let input: ReviewRequest | undefined, finish: (r: Response) => void = () => {};
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (init?.method === 'POST') { input = JSON.parse(String(init.body)); return new Promise(resolve => { finish = resolve; }); }
    if (input && String(path).endsWith('after=0')) { const r = reviewed(input); return json({ answer: r.answer, reviews: [r.decision], nextAfter: null }); }
    if (input && String(path).includes('/queue')) return json({ answers: action === 'DEFER' ? [{ ...queued, ...reviewed(input).answer }] : [], nextCursor: null });
    return defaults(String(path));
  }); mount(fetcher); await open();
  await userEvent.selectOptions(screen.getByLabelText('Review action'), action);
  if (action === 'EDIT') await userEvent.type(screen.getByLabelText('Corrected answer'), 'Corrected answer');
  if (action === 'REJECT' || action === 'DEFER') await userEvent.type(screen.getByLabelText('Review reason'), 'Need more evidence');
  const submit = screen.getByRole('button', { name: 'Submit review' }); fireEvent.click(submit); fireEvent.click(submit);
  await waitFor(() => expect(input).toBeTruthy()); expect(input?.resolveGap).toBe(false);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(screen.queryByText(/Review saved/)).toBeNull(); finish(json(reviewed(input!), 201));
  await screen.findByText(/Review saved/); await screen.findByText('Reviewer');
  expect(fetcher.mock.calls.filter(([p]) => String(p).includes('/queue'))).toHaveLength(2);
  if (action === 'DEFER') { await screen.findByRole('button', { name: 'Submit review' }); expect(screen.getByText(/Deferred answers remain/)).toBeTruthy(); }
  else expect(screen.queryByRole('button', { name: 'Submit review' })).toBeNull();
});
it('preserves exact evidence, shows author and date, and opens a resolved document', async () => {
  mount(async path => defaults(String(path))); await open();
  expect(document.querySelector('blockquote')?.textContent).toBe(quote);
  expect(screen.getByText(/Ada/)).toBeTruthy(); expect(screen.getByText(/2026-11-03T10:00:00Z/)).toBeTruthy();
  await userEvent.click(await screen.findByRole('link', { name: 'Read document real.txt' })); await screen.findByRole('heading', { name: 'real.txt' });
});
it('requires text/reasons and resets resolution when switching to non-resolving actions', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => defaults(String(path))); mount(fetcher); await open();
  const resolve = screen.getByLabelText('Resolve this knowledge gap'); expect((resolve as HTMLInputElement).checked).toBe(false); await userEvent.click(resolve);
  await userEvent.selectOptions(screen.getByLabelText('Review action'), 'EDIT'); await userEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/corrected/i);
  await userEvent.selectOptions(screen.getByLabelText('Review action'), 'DEFER'); expect(screen.queryByLabelText('Resolve this knowledge gap')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Submit review' })); expect((await screen.findByRole('alert')).textContent).toMatch(/reason/i);
  await userEvent.selectOptions(screen.getByLabelText('Review action'), 'APPROVE'); expect((screen.getByLabelText('Resolve this knowledge gap') as HTMLInputElement).checked).toBe(false);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it.each(['ANSWER_ALREADY_REVIEWED', 'GAP_DISMISSED'])('blocks repeat submission on %s until history is refreshed', async code => {
  const fetcher = vi.fn<typeof fetch>(async (path, init) => init?.method === 'POST' ? json({ error: { code } }, 409) : defaults(String(path))); mount(fetcher); await open();
  await userEvent.click(screen.getByRole('button', { name: 'Submit review' })); expect((await screen.findByRole('alert')).textContent).toContain(code);
  expect((screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/Review saved/)).toBeNull(); await userEvent.click(screen.getByRole('button', { name: 'Refresh review history' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement).disabled).toBe(false));
});
it.each(['OUTGOING', 'INCOMING'] as const)('hides all reviewer data and requests for %s', role => {
  const fetcher = vi.fn(); render(<LiveReviewerQueue project={{ ...project, role }} api={new RelayApi('', fetcher)} refreshAccess={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeTruthy(); expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 403, 404])('clears private review data when mutation returns %s', async status => {
  mount(async (path, init) => init?.method === 'POST' ? json({ error: { code: 'FORBIDDEN' } }, status) : defaults(String(path))); await open();
  await userEvent.click(screen.getByRole('button', { name: 'Submit review' })); await screen.findByRole('alert');
  expect(screen.queryByText('Outgoing answer')).toBeNull(); expect(screen.queryByLabelText('Review action')).toBeNull();
  expect(screen.getByRole('button', { name: 'Refresh project access' })).toBeTruthy();
});
it('ignores a pending review result after switching project', async () => {
  let finish: (r: Response) => void = () => {};
  const api = new RelayApi('', async (path, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : String(path).includes(`/projects/${ids.source}/`) ? json({ answers: [], nextCursor: null }) : defaults(String(path)));
  const view = render(<LiveReviewerQueue project={project} api={api} refreshAccess={() => {}} />); await open(); await userEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  view.rerender(<LiveReviewerQueue project={{ ...project, id: ids.source }} api={api} refreshAccess={() => {}} />); finish(json(reviewed({ action: 'APPROVE' }), 201));
  await screen.findByText('No answers awaiting review on this page.'); expect(screen.queryByText(/Review saved/)).toBeNull(); expect(screen.queryByText('Outgoing answer')).toBeNull();
});
it('requires history refresh after an uncertain network failure and never claims success', async () => {
  const fetcher = vi.fn<typeof fetch>(async (path, init) => { if (init?.method === 'POST') throw Error('offline'); return defaults(String(path)); }); mount(fetcher); await open();
  await userEvent.click(screen.getByRole('button', { name: 'Submit review' })); expect((await screen.findByRole('alert')).textContent).toMatch(/unknown|Unable to reach/);
  expect(screen.queryByText(/Review saved/)).toBeNull(); expect((screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Refresh review history' })); await waitFor(() => expect((screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement).disabled).toBe(false));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('sends explicit gap resolution only when the reviewer chooses it', async () => {
  let input: ReviewRequest | undefined;
  const fetcher = vi.fn<typeof fetch>(async (path, init) => { if (init?.method === 'POST') { input = JSON.parse(String(init.body)); return json(reviewed(input!), 201); } return defaults(String(path)); }); mount(fetcher); await open();
  await userEvent.click(screen.getByLabelText('Resolve this knowledge gap')); await userEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText(/Gap resolution confirmed/); expect(input).toEqual({ action: 'APPROVE', resolveGap: true });
});
it('paginates queue and private history using backend cursors', async () => {
  const first = reviewed({ action: 'DEFER', reason: 'First reason' }), second = { ...first.decision, id: ids.claim, sequence: 2, reason: 'Second reason' };
  const fetcher = vi.fn<typeof fetch>(async path => {
    const p = String(path);
    if (p.includes('/queue')) return json({ answers: p.includes('cursor=') ? [] : [queued], nextCursor: p.includes('cursor=') ? null : queued.id });
    if (p.includes('/reviews?')) return json({ answer: first.answer, reviews: p.includes('after=1') ? [second] : [first.decision], nextAfter: p.includes('after=1') ? null : 1 });
    return defaults(p);
  }); mount(fetcher); await userEvent.click(await screen.findByRole('button', { name: /Review answer/ })); await screen.findByText('First reason');
  await userEvent.click(screen.getByRole('button', { name: 'More review history' })); await screen.findByText('Second reason');
  await userEvent.click(screen.getByRole('button', { name: 'Next queue page' })); await screen.findByText('No answers awaiting review on this page.');
  expect(fetcher.mock.calls.some(([p]) => String(p).includes(`cursor=${queued.id}`))).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Previous queue page' })); await screen.findByRole('button', { name: /Review answer/ });
});
it('retries queue loading and does not claim that a failed request is an empty queue', async () => {
  let fail = true;
  mount(async path => String(path).includes('/queue') && fail ? json({ error: { code: 'INTERNAL_ERROR' } }, 500) : defaults(String(path)));
  await screen.findByRole('alert'); expect(screen.queryByText('No answers awaiting review on this page.')).toBeNull(); fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' })); await screen.findByRole('button', { name: /Review answer/ });
});
it('preserves frozen quotes when the supporting source changed', async () => {
  mount(async path => String(path).endsWith(`/sources/${ids.source}`) ? json({ source: { ...source, documents: [{ ...source.documents[0], sha256: 'changed', content: 'Changed text' }] } }) : defaults(String(path))); await open();
  await screen.findByText(/current document differs/); expect(document.querySelector('blockquote')?.textContent).toBe(quote);
});
