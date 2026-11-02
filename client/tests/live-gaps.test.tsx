// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelayApi } from '../src/lib/api';
import LiveKnowledgeGaps from '../src/pages/LiveKnowledgeGaps';
import { gap, ids, json, project, quote } from './workflow-fixtures';
afterEach(cleanup);
it('incoming users can paginate, filter, and view frozen linked evidence without mutation controls', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith(`/gaps/${ids.gap}`) ? json({ gap }) : json({ gaps: String(path).includes('cursor=') ? [] : [gap], nextCursor: String(path).includes('cursor=') ? null : ids.gap }));
  render(<LiveKnowledgeGaps project={{ ...project, role: 'INCOMING' }} api={new RelayApi('', fetcher)} refreshAccess={() => {}} />);
  await userEvent.click(await screen.findByRole('button', { name: /Who owns this/ }));
  await screen.findByRole('heading', { name: 'Who owns this?' });
  expect(document.querySelector('blockquote')?.textContent).toBe(quote);
  expect(screen.queryByRole('button', { name: 'Scan knowledge gaps' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Next gaps page' })); await screen.findByText('No gaps on this page.');
  await userEvent.selectOptions(screen.getByLabelText('Status'), 'RESOLVED');
  await screen.findByRole('button', { name: /Who owns this/ });
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('status=RESOLVED');
  expect(String(fetcher.mock.calls.at(-1)?.[0])).not.toContain('cursor=');
  expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
it.each(['REVIEWER', 'OUTGOING'] as const)('%s can scan and refresh using only server counts', async role => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/scan') ? json({ gaps: [], createdCount: 0, existingCount: 0, scannedClaimCount: 0 }) : json({ gaps: [], nextCursor: null }));
  render(<LiveKnowledgeGaps project={{ ...project, role }} api={new RelayApi('', fetcher)} refreshAccess={() => {}} />);
  await screen.findByText('No gaps on this page.'); await userEvent.click(screen.getByRole('button', { name: 'Scan knowledge gaps' }));
  await screen.findByText(/Scan completed: 0 created, 0 existing, 0 claims scanned/);
  expect(fetcher.mock.calls.find(([path]) => String(path).endsWith('/scan'))?.[1]?.body).toBe('{}');
});
it.each([401, 403, 404])('clears project content on gap detail %s', async status => {
  const refresh = vi.fn();
  const api = new RelayApi('', async path => String(path).endsWith(`/gaps/${ids.gap}`) ? json({ error: { code: 'NOT_FOUND' } }, status) : json({ gaps: [gap], nextCursor: null }));
  render(<LiveKnowledgeGaps project={project} api={api} refreshAccess={refresh} />);
  await userEvent.click(await screen.findByRole('button', { name: /Who owns this/ })); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /Who owns this/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Scan knowledge gaps' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh project access' })); expect(refresh).toHaveBeenCalledOnce();
});
it('shows scan rate limits and provider-independent scan failures without a success message', async () => {
  let fail = true;
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/scan') ? fail ? json({ error: { code: 'RATE_LIMITED' } }, 429) : json({ gaps: [gap], createdCount: 1, existingCount: 0, scannedClaimCount: 1 }) : json({ gaps: [], nextCursor: null }));
  render(<LiveKnowledgeGaps project={project} api={new RelayApi('', fetcher)} refreshAccess={() => {}} />);
  await screen.findByText('No gaps on this page.'); await userEvent.click(screen.getByRole('button', { name: 'Scan knowledge gaps' }));
  expect((await screen.findByRole('alert')).textContent).toContain('RATE_LIMITED');
  expect(screen.queryByText(/Scan completed/)).toBeNull();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  fail = false; await userEvent.click(screen.getByRole('button', { name: 'Scan knowledge gaps' }));
  await screen.findByText(/Scan completed: 1 created, 0 existing, 1 claims scanned/);
});
it('retries a failed gap detail request and supports missing linked evidence honestly', async () => {
  let fail = true;
  const api = new RelayApi('', async path => String(path).endsWith(`/gaps/${ids.gap}`) ? fail ? json({ error: { code: 'INTERNAL_ERROR' } }, 500) : json({ gap: { ...gap, claimLinks: [], claimIds: [] } }) : json({ gaps: [gap], nextCursor: null }));
  render(<LiveKnowledgeGaps project={project} api={api} refreshAccess={() => {}} />);
  await userEvent.click(await screen.findByRole('button', { name: /Who owns this/ })); await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: 'Who owns this?' })).toBeNull(); fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' })); await screen.findByText('No linked evidence was returned.');
});
