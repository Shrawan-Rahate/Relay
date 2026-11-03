// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelayApi } from '../src/lib/api';
import LiveProjectDetail from '../src/pages/LiveProjectDetail';
import { ids, json, project } from './workflow-fixtures';
afterEach(cleanup);
const member = { id: ids.doc, projectId: project.id, userId: ids.source, role: 'OUTGOING', user: { id: ids.source, name: 'Ada', email: 'ada@example.test' }, createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z' };
const reviewer = { ...member, id: ids.next, userId: ids.next, role: 'REVIEWER', user: { id: ids.next, name: 'Reviewer', email: 'reviewer@example.test' } };
const props = { project, refreshAccess: vi.fn(), currentUserId: ids.next };
it.each(['OUTGOING', 'INCOMING'] as const)('shows project information without fetching members for %s', role => {
  const fetcher = vi.fn(); render(<LiveProjectDetail {...props} project={{ ...project, role }} api={new RelayApi('', fetcher)} />);
  expect(screen.getByRole('heading', { name: project.name })).toBeTruthy(); expect(screen.getByText(/Only reviewers/)).toBeTruthy();
  expect(screen.queryByLabelText('Registered email')).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it('loads real members, prevents final reviewer removal, adds once and refreshes from server', async () => {
  let added = false, finish: (r: Response) => void = () => {};
  const fetcher = vi.fn<typeof fetch>(async (_, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : json({ members: added ? [reviewer, member] : [reviewer] }));
  render(<LiveProjectDetail {...props} api={new RelayApi('', fetcher)} />);
  expect((await screen.findByRole('button', { name: 'Remove reviewer@example.test' })).hasAttribute('disabled')).toBe(true);
  await userEvent.type(screen.getByLabelText('Registered email'), member.user.email);
  await userEvent.selectOptions(screen.getByLabelText('Assigned role'), 'OUTGOING');
  const button = screen.getByRole('button', { name: 'Add member' }); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(fetcher.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1));
  added = true; finish(json({ member }, 201)); await screen.findByText('Ada');
  expect(fetcher.mock.calls.filter(([, i]) => !i?.method)).toHaveLength(2);
});
it('confirms deletion using the membership ID and refreshes after 204', async () => {
  let removed = false;
  const fetcher = vi.fn<typeof fetch>(async (_, init) => { if (init?.method === 'DELETE') { removed = true; return new Response(null, { status: 204 }); } return json({ members: removed ? [reviewer] : [reviewer, member] }); });
  render(<LiveProjectDetail {...props} api={new RelayApi('', fetcher)} />);
  await userEvent.click(await screen.findByRole('button', { name: `Remove ${member.user.email}` }));
  expect(fetcher.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(screen.queryByText('Ada')).toBeNull());
  expect(fetcher.mock.calls.find(([, i]) => i?.method === 'DELETE')?.[0]).toBe(`/api/projects/${project.id}/members/${member.id}`);
});
it.each([[404, 'USER_NOT_FOUND', /registered/i], [409, 'MEMBERSHIP_EXISTS', /already/i], [409, 'LAST_REVIEWER', /final reviewer/i]])('shows useful mutation errors for %s %s', async (status, code, message) => {
  const api = new RelayApi('', async (_, init) => init?.method ? json({ error: { code } }, status) : json({ members: [reviewer] }));
  render(<LiveProjectDetail {...props} api={api} />); await screen.findByText('reviewer@example.test');
  await userEvent.type(screen.getByLabelText('Registered email'), member.user.email); await userEvent.click(screen.getByRole('button', { name: 'Add member' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(message);
  expect(screen.getByLabelText('Registered email')).toBeTruthy();
});
it('ignores late responses after switching projects and hides members when role is revoked', async () => {
  let finish: (r: Response) => void = () => {};
  const api = new RelayApi('', async path => String(path).includes(ids.next) ? json({ members: [] }) : new Promise(resolve => { finish = resolve; }));
  const view = render(<LiveProjectDetail {...props} api={api} />);
  view.rerender(<LiveProjectDetail {...props} project={{ ...project, id: ids.next }} api={api} />); await screen.findByText('No members returned for this project.');
  finish(json({ members: [member] })); await waitFor(() => expect(screen.queryByText('Ada')).toBeNull());
  view.rerender(<LiveProjectDetail {...props} project={{ ...project, role: 'INCOMING' }} api={api} />);
  expect(screen.queryByLabelText('Registered email')).toBeNull();
});
it.each([401, 403, 404])('clears member information on access failure %s', async status => {
  let denied = false; const refreshAccess = vi.fn();
  const api = new RelayApi('', async () => denied ? json({ error: { code: 'NOT_FOUND' } }, status) : json({ members: [member, reviewer] }));
  render(<LiveProjectDetail {...props} refreshAccess={refreshAccess} api={api} />); await screen.findByText('Ada');
  denied = true; await userEvent.click(screen.getByRole('button', { name: 'Refresh members' })); await screen.findByRole('alert');
  expect(screen.queryByText('Ada')).toBeNull(); expect(screen.queryByLabelText('Registered email')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh project access' })); expect(refreshAccess).toHaveBeenCalled();
});
it('validates blank email locally and retries a failed list request', async () => {
  let failed = true;
  const fetcher = vi.fn<typeof fetch>(async () => { if (failed) throw Error('offline'); return json({ members: [] }); });
  render(<LiveProjectDetail {...props} api={new RelayApi('', fetcher)} />);
  expect((await screen.findByRole('alert')).textContent).toMatch(/connection/);
  failed = false; await userEvent.click(screen.getByRole('button', { name: 'Refresh members' })); await screen.findByText('No members returned for this project.');
  await userEvent.click(screen.getByRole('button', { name: 'Add member' })); expect((await screen.findByRole('alert')).textContent).toMatch(/Check/);
  expect(fetcher.mock.calls.some(([, init]) => init?.method)).toBe(false);
});
it('refreshes project access after reviewer self-removal and clears private member data', async () => {
  const otherReviewer = { ...member, role: 'REVIEWER' }, refreshAccess = vi.fn();
  const api = new RelayApi('', async (_, init) => init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ members: [reviewer, otherReviewer] }));
  render(<LiveProjectDetail {...props} api={api} refreshAccess={refreshAccess} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Remove reviewer@example.test' })); await screen.findByText(/You will lose access/);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm removal' })); await waitFor(() => expect(refreshAccess).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Ada')).toBeNull(); expect(screen.queryByLabelText('Registered email')).toBeNull();
});
it('recovers a denied member list after fresh backend access is supplied', async () => {
  let denied = true;
  const api = new RelayApi('', async () => denied ? json({ error: { code: 'FORBIDDEN' } }, 403) : json({ members: [reviewer] }));
  const view = render(<LiveProjectDetail {...props} api={api} />); await screen.findByRole('alert');
  denied = false; view.rerender(<LiveProjectDetail {...props} project={{ ...project }} api={api} />);
  await screen.findByLabelText('Registered email'); await screen.findByText('reviewer@example.test');
});
