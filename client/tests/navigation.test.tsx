// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createClient } from '@supabase/supabase-js';
import { AuthController } from '../src/auth/controller';
import { AuthProvider } from '../src/auth/context';
import { RelayApi } from '../src/lib/api';
import LiveApp from '../src/LiveApp';

afterEach(cleanup);
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'member@example.test', name: null, createdAt: '2026-11-01T00:00:00Z' };
const project = { id: '22222222-2222-4222-8222-222222222222', name: 'Real backend project', description: 'Backend description', role: 'INCOMING', createdAt: '', updatedAt: '' };

it('renders backend membership, has no role selector, and blocks forged navigation hashes', async () => {
  window.relayTheme = { subscribe: () => () => {}, getSnapshot: () => 'light', toggle: () => {} };
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  window.location.hash = 'projects';
  const api = new RelayApi('', async input => {
    const path = String(input);
    const body = path === '/api/auth/me' ? { user } : path === '/api/projects' ? { projects: [project] } : { project };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  const provider = createClient('https://unused.example.test', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  render(<AuthProvider controller={controller}><LiveApp onDemo={() => {}} /></AuthProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /Real backend project.*Select project/i }));
  await screen.findByText('Your role: Incoming');
  expect(screen.queryByText('DEMO role view')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reviewer Queue' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Successor Workspace' })).toBeTruthy();
  window.location.hash = 'reviews';
  await screen.findByRole('heading', { name: 'Access restricted' });
  expect(screen.queryByText('Incident review')).toBeNull();
  api.invalidateSession();
  await screen.findByRole('button', { name: 'Sign in' });
  await waitFor(() => expect(screen.queryByText('Your role: Incoming')).toBeNull());
});

it('a project 403 is shown as a permission error while Relay identity remains valid', async () => {
  window.relayTheme = { subscribe: () => () => {}, getSnapshot: () => 'light', toggle: () => {} };
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  window.location.hash = 'projects';
  const api = new RelayApi('', async input => {
    const path = String(input);
    return new Response(JSON.stringify(path === '/api/auth/me' ? { user } : path === '/api/projects' ? { projects: [project] } : { error: { code: 'FORBIDDEN' } }), { status: path.endsWith(project.id) ? 403 : 200 });
  });
  const provider = createClient('https://unused.example.test', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  render(<AuthProvider controller={controller}><LiveApp onDemo={() => {}} /></AuthProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /Real backend project.*Select project/i }));
  await screen.findByRole('alert');
  expect(screen.getByText(/You do not have permission/)).toBeTruthy();
  expect(controller.getSnapshot().user).toEqual(user);
  expect(screen.queryByText('Your role: Incoming')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry project access' })).toBeTruthy();
});

it('anonymous project URLs show login, and restored identities land on Projects', async () => {
  window.relayTheme = { subscribe: () => () => {}, getSnapshot: () => 'light', toggle: () => {} };
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  window.location.hash = 'reviews';
  let signedIn = false;
  const api = new RelayApi('', async input => new Response(JSON.stringify(String(input) === '/api/auth/me'
    ? signedIn ? { user } : { error: { code: 'UNAUTHENTICATED' } }
    : { projects: [] }), { status: String(input) === '/api/auth/me' && !signedIn ? 401 : 200 }));
  const provider = createClient('https://unused.example.test', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  render(<AuthProvider controller={controller}><LiveApp onDemo={() => {}} /></AuthProvider>);
  await screen.findByRole('button', { name: 'Sign in' });
  await waitFor(() => expect(window.location.hash).toBe('#login'));
  expect(screen.queryByRole('navigation', { name: 'Project navigation' })).toBeNull();
  signedIn = true; await controller.restore();
  await screen.findByRole('heading', { name: 'Projects' });
  expect(window.location.hash).toBe('#projects');
});
