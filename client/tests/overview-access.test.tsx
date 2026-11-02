// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createClient } from '@supabase/supabase-js';
import type { ProjectRole } from '../../shared/api-types';
import { AuthController } from '../src/auth/controller';
import { AuthProvider } from '../src/auth/context';
import { RelayApi } from '../src/lib/api';
import LiveApp from '../src/LiveApp';

afterEach(cleanup);
it('uses refreshed backend roles and removes Overview after membership is revoked', async () => {
  window.relayTheme = { subscribe: () => () => {}, getSnapshot: () => 'light', toggle: () => {} };
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  window.location.hash = 'projects';
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'member@example.test', name: null, createdAt: '' };
  let role: ProjectRole = 'REVIEWER';
  let revoked = false;
  const requests: string[] = [];
  const api = new RelayApi('', async input => {
    const path = String(input); requests.push(path);
    const project = { id: '22222222-2222-4222-8222-222222222222', name: 'Membership test', description: '', role, createdAt: '', updatedAt: '' };
    const body = path === '/api/auth/me' ? { user } : path === '/api/projects' ? { projects: revoked ? [] : [project] } : revoked ? { error: { code: 'NOT_FOUND' } } : { project };
    return new Response(JSON.stringify(body), { status: revoked && path.endsWith(project.id) ? 404 : 200 });
  });
  const provider = createClient('https://unused.example.test', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  render(<AuthProvider controller={controller}><LiveApp onDemo={() => {}} /></AuthProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /Membership test.*Select project/i }));
  await screen.findByRole('button', { name: 'Review answers' });
  expect(window.location.hash).toBe('#overview');
  expect(screen.getByText('Membership test · Reviewer')).toBeTruthy();
  role = 'INCOMING';
  await userEvent.click(screen.getByRole('button', { name: 'Refresh access' }));
  await screen.findByRole('button', { name: 'Read handover' });
  expect(screen.queryByRole('heading', { name: 'Pending review queue' })).toBeNull();
  expect(screen.getByText('Membership test · Incoming')).toBeTruthy();
  revoked = true;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh access' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Read handover' })).toBeNull());
  await waitFor(() => expect(screen.queryByText('Membership test · Incoming')).toBeNull());
  expect(controller.getSnapshot().status).toBe('authenticated');
  expect(requests.every(path => path === '/api/auth/me' || path === '/api/projects' || path === '/api/projects/22222222-2222-4222-8222-222222222222')).toBe(true);
});
