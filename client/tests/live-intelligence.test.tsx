// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelayApi } from '../src/lib/api';
import LiveIntelligence from '../src/pages/LiveIntelligence';
import { ids, project, source, summary, claim, run, json, quote } from './workflow-fixtures';
afterEach(cleanup);
const mount = (fetcher: typeof fetch) => render(<LiveIntelligence project={project} api={new RelayApi('', fetcher)} refreshAccess={() => {}} />);
const defaults = (path: string) => path.endsWith('/sources') ? json({ sources: [summary] }) : path.endsWith(`/sources/${ids.source}`) ? json({ source }) : json({ claims: [], nextCursor: null });
async function selectDocument() {
  await userEvent.click(await screen.findByRole('button', { name: 'Load documents from real.txt' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: /real.txt.*Document 1/ }));
}
it('selects actual documents, extracts, shows exact quotes and backend model provenance', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/extractions') ? json({ run }, 201) : defaults(String(path)));
  mount(fetcher); await selectDocument(); await userEvent.click(screen.getByRole('button', { name: 'Extract claims' }));
  await screen.findByText('Extraction succeeded.');
  expect(screen.getByText('UNVERIFIED')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'OWNER' })).toBeTruthy();
  expect(screen.getAllByText(/backend-model/).length).toBeGreaterThan(0);
  expect(document.querySelector('blockquote')?.textContent).toBe(quote);
  expect(fetcher.mock.calls.find(([path]) => String(path).endsWith('/extractions'))?.[1]?.body).toBe(JSON.stringify({ documentIds: [ids.doc] }));
});
it.each([['AI_NOT_CONFIGURED', 503], ['AI_TIMEOUT', 504], ['RATE_LIMITED', 429], ['UNGROUNDED_AI_OUTPUT', 502]] as const)('handles %s without success and retries only on user action', async (code, status) => {
  let fail = true;
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/extractions') ? fail ? json({ error: { code } }, status) : json({ run: { ...run, claims: [] } }, 201) : defaults(String(path)));
  mount(fetcher); await selectDocument(); await userEvent.click(screen.getByRole('button', { name: 'Extract claims' }));
  expect((await screen.findByRole('alert')).textContent).toContain(code);
  expect(screen.queryByText('Extraction succeeded.')).toBeNull();
  expect(fetcher.mock.calls.filter(([p]) => String(p).endsWith('/extractions'))).toHaveLength(1);
  fail = false; await userEvent.click(screen.getByRole('button', { name: 'Extract claims' }));
  await screen.findByText('Extraction succeeded with no claims.');
});
it('paginates existing claims without presenting a page length as a project total', async () => {
  mount(async path => String(path).includes('/claims') ? json({ claims: String(path).includes('cursor=') ? [{ ...claim, id: ids.next, text: 'Second page claim', evidence: [] }] : [claim], nextCursor: String(path).includes('cursor=') ? null : ids.claim }) : defaults(String(path)));
  await userEvent.click(await screen.findByRole('button', { name: 'Next claims page' }));
  await screen.findByText('Second page claim');
  await userEvent.click(screen.getByRole('button', { name: 'Previous claims page' }));
  await screen.findByText('UNVERIFIED');
});
it('ignores late extraction results after changing projects', async () => {
  let finish: (response: Response) => void = () => {};
  const api = new RelayApi('', async path => String(path).endsWith('/extractions') ? new Promise(resolve => { finish = resolve; }) : defaults(String(path)));
  const { rerender } = render(<LiveIntelligence project={project} api={api} refreshAccess={() => {}} />);
  await selectDocument(); await userEvent.click(screen.getByRole('button', { name: 'Extract claims' }));
  rerender(<LiveIntelligence project={{ ...project, id: ids.next }} api={api} refreshAccess={() => {}} />);
  finish(json({ run }, 201)); await waitFor(() => expect(screen.queryByText('Extraction succeeded.')).toBeNull());
});
it('fetches exact evidence using the scoped credentialed document endpoint', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).includes('/documents/') ? json({ document: { ...source.documents[0], content: 'Updated document content' } }) : String(path).includes('/claims') ? json({ claims: [claim], nextCursor: null }) : defaults(String(path)));
  mount(fetcher); await userEvent.click(await screen.findByRole('button', { name: 'Read source document' }));
  await screen.findByText('Updated document content');
  expect(document.querySelector('blockquote')?.textContent).toBe(quote);
  expect(screen.getByText(/current document differs/)).toBeTruthy();
  const call = fetcher.mock.calls.find(([path]) => String(path).includes('/documents/'))!;
  expect(call[0]).toBe(claim.evidence[0].documentUrl); expect(call[1]?.credentials).toBe('include');
});
it.each([401, 403, 404])('clears claims and selection after extraction access failure %s', async status => {
  mount(async path => String(path).endsWith('/extractions') ? json({ error: { code: 'FORBIDDEN' } }, status) : String(path).includes('/claims') ? json({ claims: [claim], nextCursor: null }) : defaults(String(path)));
  await selectDocument(); await screen.findByText('UNVERIFIED');
  await userEvent.click(screen.getByRole('button', { name: 'Extract claims' })); await screen.findByRole('alert');
  expect(screen.queryByText('UNVERIFIED')).toBeNull(); expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Refresh project access' })).toBeTruthy();
});
it('rejects oversized UTF-8 selection before mutation', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith(`/sources/${ids.source}`) ? json({ source: { ...source, documents: [{ ...source.documents[0], content: 'é'.repeat(50_001) }] } }) : defaults(String(path)));
  mount(fetcher); await selectDocument();
  expect((screen.getByRole('button', { name: 'Extract claims' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('100,000');
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('does not show source selection or extraction controls for an incoming role', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ claims: [], nextCursor: null }));
  render(<LiveIntelligence project={{ ...project, role: 'INCOMING' }} api={new RelayApi('', fetcher)} refreshAccess={() => {}} />);
  await screen.findByText('No claims on this page.');
  expect(screen.queryByRole('button', { name: 'Extract claims' })).toBeNull();
  expect(fetcher.mock.calls.every(([path]) => String(path).includes('/claims'))).toBe(true);
});
it('can retry a failed source list without fake documents', async () => {
  let fail = true;
  mount(async path => String(path).endsWith('/sources') && fail ? json({ error: { code: 'INTERNAL_ERROR' } }, 500) : defaults(String(path)));
  await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull(); fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' })); await selectDocument();
});
