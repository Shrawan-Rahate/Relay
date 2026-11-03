// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createClient } from '@supabase/supabase-js';
import { AuthController } from '../src/auth/controller';
import { AuthProvider } from '../src/auth/context';
import { RelayApi } from '../src/lib/api';
import { canViewPage, canViewLivePage } from '../src/data/project-ui';
import LiveApp from '../src/LiveApp';
import { gap, project, root, json } from './workflow-fixtures';
afterEach(cleanup);
it('permits reviewer clarification navigation only in LIVE and excludes incoming', () => {
  expect(canViewLivePage('clarifications', 'REVIEWER')).toBe(true);
  expect(canViewLivePage('clarifications', 'OUTGOING')).toBe(true);
  expect(canViewLivePage('clarifications', 'INCOMING')).toBe(false);
  expect(canViewPage('clarifications', 'REVIEWER')).toBe(false);
});
it('routes reviewer history in the live shell and blocks it after a backend role change', async () => {
  window.relayTheme = { subscribe: () => () => {}, getSnapshot: () => 'light', toggle: () => {} };
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  window.location.hash = 'projects';
  let currentProject = project;
  const user = { id: project.id, email: 'member@example.test', name: null, createdAt: '' };
  const api = new RelayApi('', async input => {
    const path = String(input);
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/projects') return json({ projects: [currentProject] });
    if (path === root) return json({ project: currentProject });
    if (path.endsWith(`/gaps/${gap.id}`)) return json({ gap });
    if (path.includes('/answers')) return json({ answers: [], nextCursor: null });
    return json({ gaps: [gap], nextCursor: null });
  });
  const provider = createClient('https://unused.example.test', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  render(<AuthProvider controller={controller}><LiveApp onDemo={() => {}} /></AuthProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /Backend project.*Select project/i }));
  await userEvent.click(await screen.findByRole('button', { name: 'Clarifications' }));
  await userEvent.click(await screen.findByRole('button', { name: /Who owns this/ })); await screen.findByText('No answers on this page.');
  expect(screen.queryByLabelText('Your answer')).toBeNull();
  currentProject = { ...project, role: 'INCOMING' }; fireEvent(window, new Event('focus'));
  await screen.findByRole('heading', { name: 'Access restricted' });
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Answer history' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Clarifications' })).toBeNull();
});
