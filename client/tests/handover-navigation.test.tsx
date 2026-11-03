// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createClient } from '@supabase/supabase-js';
import { AuthController } from '../src/auth/controller';
import { AuthProvider } from '../src/auth/context';
import { RelayApi } from '../src/lib/api';
import { canViewLivePage, canViewPage } from '../src/data/project-ui';
import LiveApp from '../src/LiveApp';
import { project, root, json } from './workflow-fixtures';
afterEach(cleanup);
it('permits all real project members to read published handovers without changing DEMO access', () => {
  for (const role of ['REVIEWER', 'OUTGOING', 'INCOMING'] as const) expect(canViewLivePage('handover', role)).toBe(true);
  expect(canViewPage('handover', 'OUTGOING')).toBe(false); expect(canViewLivePage('successor', 'OUTGOING')).toBe(false);
});
it('restores the incoming session, opens the successor workspace, and removes it after revocation', async () => {
  window.relayTheme = { subscribe: () => () => {}, getSnapshot: () => 'light', toggle: () => {} };
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  window.location.hash = 'projects';
  let revoked = false;
  const user = { id: project.id, email: 'member@example.test', name: null, createdAt: '' }, p = { ...project, role: 'INCOMING' };
  const api = new RelayApi('', async input => {
    const path = String(input);
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/projects') return json({ projects: revoked ? [] : [p] });
    if (path === root) return revoked ? json({ error: { code: 'NOT_FOUND' } }, 404) : json({ project: p });
    if (path.includes('/handovers?')) return json({ handovers: [], nextBeforeVersion: null });
    throw Error('Unexpected path');
  });
  const provider = createClient('https://unused.example.test', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  render(<AuthProvider controller={controller}><LiveApp onDemo={() => {}} /></AuthProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /Backend project.*Select project/i }));
  await userEvent.click(await screen.findByRole('button', { name: 'Successor Workspace' }));
  await screen.findByRole('heading', { name: 'Incoming Successor Workspace' }); await screen.findByText('No published handovers on this page.');
  expect(screen.queryByRole('button', { name: 'Publish new version' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Reviewer Queue' })).toBeNull();
  revoked = true; fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Incoming Successor Workspace' })).toBeNull());
});
