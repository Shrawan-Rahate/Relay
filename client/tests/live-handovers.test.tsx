// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectRole } from '../../shared/api-types';
import { RelayApi } from '../src/lib/api';
import LiveHandovers from '../src/pages/LiveHandovers';
import { ids, json, project, source, quote } from './workflow-fixtures';
import { incomingId, older, published, receipt } from './handover-fixtures';
afterEach(cleanup);
const defaults = (path: string, role: ProjectRole = 'REVIEWER') => path.includes('/documents/') ? json({ document: source.documents[0] }) : path.includes('/handovers?') ? json({ handovers: [published, older], nextBeforeVersion: null }) : json(role === 'REVIEWER' ? { handover: path.includes(older.id) ? older : published, receipts: [], nextReceiptCursor: null } : { handover: path.includes(older.id) ? older : published, receipt: null });
function mount(fetcher: typeof fetch, role: ProjectRole = 'REVIEWER') { return render(<LiveHandovers project={{ ...project, role }} api={new RelayApi('', fetcher)} currentUserId={incomingId} refreshAccess={() => {}} successor={role === 'INCOMING'} />); }
async function open(version = 2) { await userEvent.click(await screen.findByRole('button', { name: `Read version ${version}` })); await screen.findByRole('heading', { name: `Published version ${version}` }); }
it('publishes only after confirmation, sends no content and refreshes after success', async () => {
  let finish: (r: Response) => void = () => {};
  const fetcher = vi.fn<typeof fetch>(async (path, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : defaults(String(path))); mount(fetcher);
  await screen.findByRole('button', { name: 'Read version 2' }); await userEvent.click(screen.getByRole('button', { name: 'Publish new version' }));
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  const button = screen.getByRole('button', { name: 'Confirm publication' }); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
  expect(screen.queryByText(/Published version 2 successfully/)).toBeNull();
  expect(fetcher.mock.calls.filter(([p]) => String(p).includes('/handovers?'))).toHaveLength(1);
  finish(json({ handover: published }, 201)); await screen.findByText(/Published version 2 successfully/);
  await waitFor(() => expect(fetcher.mock.calls.filter(([p]) => String(p).includes('/handovers?'))).toHaveLength(2));
  expect(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body).toBe('{}');
});
it('displays frozen reviewed knowledge, UNKNOWN gaps, explicit actions and older empty versions', async () => {
  mount(async path => defaults(String(path))); await open();
  expect(screen.getByText('Who owns PostgreSQL?')).toBeTruthy(); expect(screen.getByText('UNKNOWN')).toBeTruthy();
  expect(screen.getByText('Human reviewer')).toBeTruthy(); expect(screen.getByText(published.contentSha256)).toBeTruthy();
  expect(document.querySelector('blockquote')?.textContent).toBe(quote); expect(screen.getByText('Confirm release date.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Read evidence document' })); await screen.findByText('Current source document');
  await open(1); expect(screen.getByText('No confirmed knowledge in this snapshot.')).toBeTruthy(); expect(screen.getByText('No unresolved gaps recorded in this snapshot.')).toBeTruthy(); expect(screen.getByText('No explicit next actions in this snapshot.')).toBeTruthy();
});
it.each([200, 201])('incoming acknowledges the selected snapshot with response %s and shows only their own receipt', async status => {
  let finish: (r: Response) => void = () => {};
  const fetcher = vi.fn<typeof fetch>(async (path, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : defaults(String(path), 'INCOMING')); mount(fetcher, 'INCOMING'); await open();
  expect(screen.queryByRole('button', { name: 'Publish new version' })).toBeNull(); expect(screen.queryByText('Incoming acknowledgment receipts')).toBeNull();
  const button = screen.getByRole('button', { name: 'Acknowledge version 2' }); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)); finish(json({ receipt }, status));
  await screen.findByText(/Acknowledged version 2/); expect(screen.getByText(receipt.createdAt)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Acknowledge version 2' })).toBeNull();
  expect(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]).toContain(`/${published.id}/acknowledge`);
});
it('outgoing reads snapshots without publication or acknowledgment controls', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => defaults(String(path), 'OUTGOING')); mount(fetcher, 'OUTGOING'); await open();
  expect(screen.queryByRole('button', { name: 'Publish new version' })).toBeNull(); expect(screen.queryByRole('button', { name: /Acknowledge version/ })).toBeNull();
  expect(fetcher.mock.calls.every(([p]) => !String(p).includes('/reviews') && !String(p).includes('receiptLimit'))).toBe(true);
});
it('rejects a foreign incoming receipt without rendering its user or timestamp', async () => {
  mount(async path => String(path).includes('/handovers?') ? defaults(String(path), 'INCOMING') : json({ handover: published, receipt: { ...receipt, userId: ids.source, createdAt: 'PRIVATE TIMESTAMP' } }), 'INCOMING');
  await userEvent.click(await screen.findByRole('button', { name: 'Read version 2' })); await screen.findByRole('alert');
  expect(screen.queryByText('PRIVATE TIMESTAMP')).toBeNull(); expect(screen.queryByText(/Acknowledged version/)).toBeNull();
});
it.each([401, 403, 404])('clears handover content after acknowledgment access failure %s', async status => {
  mount(async (path, init) => init?.method === 'POST' ? json({ error: { code: 'FORBIDDEN' } }, status) : defaults(String(path), 'INCOMING'), 'INCOMING'); await open();
  await userEvent.click(screen.getByRole('button', { name: 'Acknowledge version 2' })); await screen.findByRole('alert');
  expect(screen.queryByText('Who owns PostgreSQL?')).toBeNull(); expect(screen.getByRole('button', { name: 'Refresh project access' })).toBeTruthy();
});
it('keeps publication failures distinct from success and does not automatically refresh or retry', async () => {
  const fetcher = vi.fn<typeof fetch>(async (path, init) => init?.method === 'POST' ? json({ error: { code: 'INVALID_APPROVED_CONTENT' } }, 409) : defaults(String(path))); mount(fetcher);
  await screen.findByRole('button', { name: 'Read version 2' }); await userEvent.click(screen.getByRole('button', { name: 'Publish new version' })); await userEvent.click(screen.getByRole('button', { name: 'Confirm publication' }));
  expect((await screen.findByRole('alert')).textContent).toContain('INVALID_APPROVED_CONTENT'); expect(screen.queryByText(/successfully/)).toBeNull();
  expect(fetcher.mock.calls.filter(([p]) => String(p).includes('/handovers?'))).toHaveLength(1);
});
it('ignores late publication results after switching projects', async () => {
  let finish: (r: Response) => void = () => {};
  const api = new RelayApi('', async (path, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : String(path).includes(`/projects/${ids.source}/`) ? json({ handovers: [], nextBeforeVersion: null }) : defaults(String(path)));
  const view = render(<LiveHandovers project={project} api={api} currentUserId={incomingId} refreshAccess={() => {}} />);
  await screen.findByRole('button', { name: 'Read version 2' }); await userEvent.click(screen.getByRole('button', { name: 'Publish new version' })); await userEvent.click(screen.getByRole('button', { name: 'Confirm publication' }));
  view.rerender(<LiveHandovers project={{ ...project, id: ids.source }} api={api} currentUserId={incomingId} refreshAccess={() => {}} />); finish(json({ handover: published }, 201));
  await screen.findByText('No published handovers on this page.'); expect(screen.queryByText(/successfully/)).toBeNull();
});
it('paginates versions and reviewer receipts using the returned cursors', async () => {
  const secondReceipt = { ...receipt, id: ids.next, userId: ids.source };
  const fetcher = vi.fn<typeof fetch>(async path => {
    const p = String(path);
    if (p.includes('/handovers?')) return json({ handovers: p.includes('beforeVersion=2') ? [older] : [published], nextBeforeVersion: p.includes('beforeVersion=2') ? null : 2 });
    return json({ handover: published, receipts: p.includes(`receiptCursor=${receipt.id}`) ? [secondReceipt] : [receipt], nextReceiptCursor: p.includes('receiptCursor=') ? null : receipt.id });
  }); mount(fetcher); await open(); await screen.findByText(`Member: ${incomingId}`);
  await userEvent.click(screen.getByRole('button', { name: 'Next receipts' })); await screen.findByText(`Member: ${ids.source}`); expect(screen.queryByText(`Member: ${incomingId}`)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Previous receipts' })); await screen.findByText(`Member: ${incomingId}`);
  await userEvent.click(screen.getByRole('button', { name: 'Older versions' })); await screen.findByRole('button', { name: 'Read version 1' });
  expect(screen.queryByRole('button', { name: 'Read version 2' })).toBeNull(); await userEvent.click(screen.getByRole('button', { name: 'Newer versions' })); await screen.findByRole('button', { name: 'Read version 2' });
  expect(fetcher.mock.calls.some(([p]) => String(p).includes('beforeVersion=2'))).toBe(true); expect(fetcher.mock.calls.some(([p]) => String(p).includes(`receiptCursor=${receipt.id}`))).toBe(true);
});
it('recovers an uncertain acknowledgment by reloading its existing receipt, without another POST', async () => {
  let acknowledged = false;
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (init?.method === 'POST') { acknowledged = true; throw Error('connection lost'); }
    return acknowledged && !String(path).includes('/handovers?') ? json({ handover: published, receipt }) : defaults(String(path), 'INCOMING');
  }); mount(fetcher, 'INCOMING'); await open(); await userEvent.click(screen.getByRole('button', { name: 'Acknowledge version 2' })); await screen.findByRole('alert');
  expect(screen.queryByText(/Acknowledged version/)).toBeNull(); expect((screen.getByRole('button', { name: 'Acknowledge version 2' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Refresh snapshot and receipts' })); await screen.findByText('Acknowledged version 2');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('requires an explicit versions refresh after a publication network failure', async () => {
  const fetcher = vi.fn<typeof fetch>(async (path, init) => { if (init?.method === 'POST') throw Error('offline'); return defaults(String(path)); }); mount(fetcher);
  await screen.findByRole('button', { name: 'Read version 2' }); await userEvent.click(screen.getByRole('button', { name: 'Publish new version' })); await userEvent.click(screen.getByRole('button', { name: 'Confirm publication' }));
  await screen.findByRole('alert'); expect(screen.queryByText(/successfully/)).toBeNull(); expect((screen.getByRole('button', { name: 'Publish new version' }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher.mock.calls.filter(([p]) => String(p).includes('/handovers?'))).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Refresh versions' })); await waitFor(() => expect((screen.getByRole('button', { name: 'Publish new version' }) as HTMLButtonElement).disabled).toBe(false));
});
it('can cancel publication without changing anything', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => defaults(String(path))); mount(fetcher); await screen.findByRole('button', { name: 'Read version 2' });
  await userEvent.click(screen.getByRole('button', { name: 'Publish new version' })); await userEvent.click(screen.getByRole('button', { name: 'Cancel publication' }));
  expect(screen.queryByRole('button', { name: 'Confirm publication' })).toBeNull(); expect(fetcher.mock.calls.some(([, init]) => init?.method)).toBe(false);
});
it('removes reviewer receipts and publication controls after a backend role change', async () => {
  let role: ProjectRole = 'REVIEWER';
  const api = new RelayApi('', async path => String(path).includes('/handovers?') ? defaults(String(path), role) : json(role === 'REVIEWER' ? { handover: published, receipts: [{ ...receipt, userId: ids.source }], nextReceiptCursor: null } : { handover: published, receipt: null }));
  const view = render(<LiveHandovers project={project} api={api} currentUserId={incomingId} refreshAccess={() => {}} />); await open(); await screen.findByText(`Member: ${ids.source}`);
  role = 'INCOMING'; view.rerender(<LiveHandovers project={{ ...project, role }} api={api} currentUserId={incomingId} refreshAccess={() => {}} successor />);
  await screen.findByRole('heading', { name: 'Incoming Successor Workspace' }); expect(screen.queryByText(`Member: ${ids.source}`)).toBeNull(); expect(screen.queryByRole('button', { name: 'Publish new version' })).toBeNull();
  await open(); expect(screen.queryByText('Incoming acknowledgment receipts')).toBeNull();
});
it('does not leak private review reasons or infer next actions from content', async () => {
  const snapshot = { ...published, content: { ...published.content, nextActions: [], confirmedKnowledge: published.content.confirmedKnowledge.map(item => ({ ...item, review: { ...item.review, reason: 'PRIVATE REVIEW REASON' } })) } };
  const fetcher = vi.fn<typeof fetch>(async path => String(path).includes('/handovers?') ? json({ handovers: [snapshot], nextBeforeVersion: null }) : json({ handover: snapshot, receipt: null })); mount(fetcher, 'INCOMING'); await open();
  expect(screen.getByText('No explicit next actions in this snapshot.')).toBeTruthy(); expect(screen.queryByText('PRIVATE REVIEW REASON')).toBeNull();
  expect(fetcher.mock.calls.every(([p]) => !String(p).includes('/reviews'))).toBe(true);
});
it('shows source drift without replacing immutable evidence', async () => {
  mount(async path => String(path).includes('/documents/') ? json({ document: { ...source.documents[0], content: 'Updated live document', sha256: 'different' } }) : defaults(String(path))); await open();
  await userEvent.click(screen.getByRole('button', { name: 'Read evidence document' })); await screen.findByText(/current document differs/);
  expect(document.querySelector('blockquote')?.textContent).toBe(quote); expect(screen.getByText(published.contentSha256)).toBeTruthy();
});
it('ignores a late snapshot read after another version is selected', async () => {
  let finish: (r: Response) => void = () => {};
  mount(async path => String(path).includes(`/${published.id}?`) ? new Promise(resolve => { finish = resolve; }) : defaults(String(path)));
  await userEvent.click(await screen.findByRole('button', { name: 'Read version 2' })); await open(1);
  finish(json({ handover: published, receipts: [], nextReceiptCursor: null })); await waitFor(() => expect(screen.queryByRole('heading', { name: 'Published version 2' })).toBeNull());
  expect(screen.getByRole('heading', { name: 'Published version 1' })).toBeTruthy();
});
it('distinguishes a failed versions request from an empty publication list and supports retry', async () => {
  let fail = true; mount(async () => fail ? json({ error: { code: 'INTERNAL_ERROR' } }, 500) : json({ handovers: [], nextBeforeVersion: null }));
  await screen.findByRole('alert'); expect(screen.queryByText('No published handovers on this page.')).toBeNull(); fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' })); await screen.findByText('No published handovers on this page.');
});
