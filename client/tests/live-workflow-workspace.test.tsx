// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createClient } from '@supabase/supabase-js';
import { AuthController } from '../src/auth/controller';
import { AuthProvider } from '../src/auth/context';
import { RelayApi } from '../src/lib/api';
import LiveApp from '../src/LiveApp';
import { project, root, source, summary, json } from './workflow-fixtures';
afterEach(cleanup);
it('routes live workflow pages, preserves selection during focus checks, and honors backend role changes', async () => {
  window.relayTheme = { subscribe: () => () => {}, getSnapshot: () => 'light', toggle: () => {} };
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  window.location.hash = 'projects';
  let currentProject = project, checks = 0;
  const user = { id: '99999999-9999-4999-8999-999999999999', email: 'member@example.test', name: null, createdAt: '' };
  const api = new RelayApi('', async input => {
    const path = String(input);
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/projects') return json({ projects: [currentProject] });
    if (path === root) { checks++; return json({ project: currentProject }); }
    if (path.endsWith('/sources')) return json({ sources: [summary] });
    if (path.endsWith(`/sources/${source.id}`)) return json({ source });
    if (path.includes('/claims')) return json({ claims: [], nextCursor: null });
    if (path.includes('/gaps')) return json({ gaps: [], nextCursor: null });
    throw new Error(`Unexpected endpoint: ${path}`);
  });
  const provider = createClient('https://unused.example.test', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  render(<AuthProvider controller={controller}><LiveApp onDemo={() => {}} /></AuthProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /Backend project.*Select project/i }));
  await userEvent.click(await screen.findByRole('button', { name: 'AI Intelligence' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Load documents from real.txt' }));
  await userEvent.click(await screen.findByRole('checkbox'));
  const before = checks; fireEvent(window, new Event('focus'));
  await waitFor(() => expect(checks).toBeGreaterThan(before));
  await waitFor(() => expect(screen.queryByText('Loading project access…')).toBeNull());
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  currentProject = { ...project, role: 'INCOMING' }; fireEvent(window, new Event('focus'));
  await screen.findByRole('heading', { name: 'Access restricted' });
  expect(screen.queryByRole('checkbox')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Knowledge gaps' }));
  await screen.findByText('No gaps on this page.');
  expect(screen.queryByRole('button', { name: 'Scan knowledge gaps' })).toBeNull();
});
