// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../shared/api-types';
import { RelayApi } from '../src/lib/api';
import LiveSourceManager from '../src/pages/LiveSourceManager';
afterEach(cleanup);
const project: Project = { id: '22222222-2222-4222-8222-222222222222', name: 'Real project', role: 'OUTGOING', description: null, createdAt: '', updatedAt: '' };
const base = `/api/projects/${project.id}/sources`;
const source = { id: '33333333-3333-4333-8333-333333333333', projectId: project.id, filename: 'notes.md', type: 'MARKDOWN', byteSize: 16, sha256: 'hash', importedById: 'user', createdAt: '', updatedAt: '', metadata: {}, provenance: { method: 'file_upload' }, _count: { documents: 1 } };
const detail = { ...source, originalContent: '<script>untrusted text</script>', documents: [{ id: '44444444-4444-4444-8444-444444444444', projectId: project.id, sourceId: source.id, position: 1, content: 'Original document', sha256: 'doc-hash', metadata: { filename: 'notes.md' }, createdAt: '', updatedAt: '' }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function mount(fetcher: typeof fetch, role = project.role) {
  const refreshAccess = vi.fn(); const api = new RelayApi('', fetcher);
  return { ...render(<LiveSourceManager project={{ ...project, role }} api={api} refreshAccess={refreshAccess} />), api, refreshAccess };
}
it('loads real sources and safely displays documents and provenance for incoming users', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => json(String(path) === base ? { sources: [source] } : { source: detail }));
  mount(fetcher, 'INCOMING');
  expect(screen.getByRole('status').textContent).toContain('Loading sources');
  await userEvent.click(await screen.findByRole('button', { name: /notes.md/ }));
  expect(await screen.findByText('Original document')).toBeTruthy();
  expect(screen.getByText('<script>untrusted text</script>')).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getAllByText(/file_upload/).length).toBeGreaterThan(0);
  expect(screen.queryByLabelText('Document file')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Import repository' })).toBeNull();
  expect(fetcher.mock.calls[1][0]).toBe(`${base}/${source.id}`);
  expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
});
it.each(['md', 'txt', 'csv'])('uploads real .%s multipart and refreshes after success', async extension => {
  let imported = false;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    if (init?.method === 'POST') { imported = true; return json({ source: detail }, 201); }
    return json({ sources: imported ? [source] : [] });
  }); mount(fetcher);
  await screen.findByText('No sources yet');
  const file = new File(['title\nActual content'], `source.${extension}`, { type: 'text/plain' });
  await userEvent.upload(screen.getByLabelText('Document file'), file);
  await userEvent.click(screen.getByRole('button', { name: 'Upload file' }));
  await screen.findByText(/Imported notes.md/);
  expect(await screen.findByRole('button', { name: /notes.md/ })).toBeTruthy();
  const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(call[0]).toBe(base); expect((call[1]?.body as FormData).get('file')).toBe(file);
  expect(new Headers(call[1]?.headers).has('Content-Type')).toBe(false);
  expect(fetcher.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2);
});
it('sends owner/repo and shows backend duplicate/validation errors without success', async () => {
  let status = 409;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => init?.method === 'POST' ? json({ error: { code: status === 409 ? 'SOURCE_EXISTS' : 'INVALID_INPUT', message: status === 409 ? 'This content is already imported in the project' : 'Invalid source content or import details' } }, status) : json({ sources: [] }));
  mount(fetcher, 'REVIEWER'); await screen.findByText('No sources yet');
  await userEvent.type(screen.getByLabelText('Repository'), 'owner/repo');
  await userEvent.click(screen.getByRole('button', { name: 'Import repository' }));
  await screen.findByText(/already imported/);
  expect(fetcher.mock.calls[1][0]).toBe(`${base}/github`);
  expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify({ repository: 'owner/repo' }));
  status = 400; await userEvent.click(screen.getByRole('button', { name: 'Import repository' }));
  await screen.findByText(/Invalid source content or import details/);
  expect(screen.queryByText(/^Imported /)).toBeNull();
});
it.each([401, 403, 404])('hides loaded data after detail %s and offers access refresh', async status => {
  const { refreshAccess, api } = mount(async path => String(path) === base ? json({ sources: [source] }) : json({ error: { code: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'NOT_FOUND' } }, status));
  const unauthorized = vi.fn(); api.onUnauthorized(unauthorized);
  await userEvent.click(await screen.findByRole('button', { name: /notes.md/ })); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /notes.md/ })).toBeNull(); expect(screen.queryByLabelText('Document file')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh project access' })); expect(refreshAccess).toHaveBeenCalledOnce();
  expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});
it('retries a list error without claiming it is empty', async () => {
  let fail = true; mount(async () => fail ? json({ error: { code: 'INTERNAL_ERROR' } }, 500) : json({ sources: [] }));
  await screen.findByRole('alert'); expect(screen.queryByText('No sources yet')).toBeNull(); fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh sources' })); await screen.findByText('No sources yet');
});
it('rejects cross-project data and ignores late results after switching projects', async () => {
  let finish: (value: Response) => void = () => {};
  const other = { ...project, id: '55555555-5555-4555-8555-555555555555', role: 'INCOMING' as const };
  const api = new RelayApi('', async path => String(path) === base ? new Promise(resolve => { finish = resolve; }) : json({ sources: [source] }));
  const { rerender } = render(<LiveSourceManager project={project} api={api} refreshAccess={() => {}} />);
  rerender(<LiveSourceManager project={other} api={api} refreshAccess={() => {}} />); await screen.findByRole('alert');
  finish(json({ sources: [source] })); await waitFor(() => expect(screen.queryByRole('button', { name: /notes.md/ })).toBeNull());
});
it('rejects invalid files and repository URLs before POST', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ sources: [] })); mount(fetcher); await screen.findByText('No sources yet');
  fireEvent.change(screen.getByLabelText('Document file'), { target: { files: [new File(['binary'], 'bad.pdf')] } });
  await userEvent.click(screen.getByRole('button', { name: 'Upload file' })); await screen.findByText(/Choose one .md, .txt, or .csv file/);
  await userEvent.type(screen.getByLabelText('Repository'), 'https://github.com/owner/repo');
  await userEvent.click(screen.getByRole('button', { name: 'Import repository' })); expect((await screen.findByRole('alert')).textContent).toContain('Enter owner/repo');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('imports GitHub successfully, refreshes the list, and distinguishes GitHub 404 from revoked membership', async () => {
  let imported = false, missing = true;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    if (init?.method === 'POST') {
      if (missing) return json({ error: { code: 'GITHUB_NOT_FOUND', message: 'Public GitHub repository not found' } }, 404);
      imported = true; return json({ source: detail }, 201);
    }
    return json({ sources: imported ? [source] : [] });
  }); mount(fetcher); await screen.findByText('No sources yet');
  await userEvent.type(screen.getByLabelText('Repository'), 'owner/repo');
  await userEvent.click(screen.getByRole('button', { name: 'Import repository' }));
  await screen.findByText(/Public GitHub repository not found/);
  expect(screen.queryByRole('button', { name: 'Refresh project access' })).toBeNull();
  missing = false; await userEvent.click(screen.getByRole('button', { name: 'Import repository' }));
  await screen.findByText(/Imported notes.md/); await screen.findByRole('button', { name: /notes.md/ });
});
it('never reports malformed import responses as success', async () => {
  mount(async (_path, init) => json(init?.method === 'POST' ? { source: { ...detail, projectId: 'wrong-project' } } : { sources: [] }));
  await screen.findByText('No sources yet'); await userEvent.type(screen.getByLabelText('Repository'), 'owner/repo');
  await userEvent.click(screen.getByRole('button', { name: 'Import repository' })); await screen.findByRole('alert');
  expect(screen.queryByText(/^Imported /)).toBeNull();
});
it('recovers from a source permission error only after fresh project access is supplied', async () => {
  let deny = true;
  const api = new RelayApi('', async () => deny ? json({ error: { code: 'FORBIDDEN' } }, 403) : json({ sources: [source] }));
  const { rerender } = render(<LiveSourceManager project={project} api={api} refreshAccess={() => {}} />);
  await screen.findByRole('alert'); deny = false;
  rerender(<LiveSourceManager project={{ ...project }} api={api} refreshAccess={() => {}} />);
  await screen.findByRole('button', { name: /notes.md/ });
});
it('ignores a pending import result after a backend role change to incoming', async () => {
  let finish: (value: Response) => void = () => {};
  const api = new RelayApi('', async (_path, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : json({ sources: [] }));
  const { rerender } = render(<LiveSourceManager project={project} api={api} refreshAccess={() => {}} />);
  await screen.findByText('No sources yet'); await userEvent.type(screen.getByLabelText('Repository'), 'owner/repo');
  await userEvent.click(screen.getByRole('button', { name: 'Import repository' })); await screen.findByText('Importing source…');
  rerender(<LiveSourceManager project={{ ...project, role: 'INCOMING' }} api={api} refreshAccess={() => {}} />);
  finish(json({ source: detail }, 201)); await screen.findByText('No sources yet');
  expect(screen.queryByText(/^Imported /)).toBeNull(); expect(screen.queryByLabelText('Repository')).toBeNull();
});
