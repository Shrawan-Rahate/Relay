// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createClient } from '@supabase/supabase-js';
import { AuthController } from '../src/auth/controller';
import { AuthProvider } from '../src/auth/context';
import { RelayApi } from '../src/lib/api';
import LiveApp from '../src/LiveApp';
afterEach(cleanup);
it('preserves the selected file across focus revalidation but removes it when membership is revoked', async () => {
  window.relayTheme = { subscribe: () => () => {}, getSnapshot: () => 'light', toggle: () => {} };
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  window.location.hash = 'projects';
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'member@example.test', name: null, createdAt: '' };
  const project = { id: '22222222-2222-4222-8222-222222222222', name: 'Upload project', description: '', role: 'OUTGOING', createdAt: '', updatedAt: '' };
  let revoked = false, checks = 0;
  const api = new RelayApi('', async input => {
    const path = String(input);
    if (path === '/api/auth/me') return new Response(JSON.stringify({ user }));
    if (path.endsWith('/sources')) return new Response(JSON.stringify({ sources: [] }));
    if (path === '/api/projects') return new Response(JSON.stringify({ projects: revoked ? [] : [project] }));
    checks++; return new Response(JSON.stringify(revoked ? { error: { code: 'NOT_FOUND' } } : { project }), { status: revoked ? 404 : 200 });
  });
  const provider = createClient('https://unused.example.test', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  render(<AuthProvider controller={controller}><LiveApp onDemo={() => {}} /></AuthProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /Upload project.*Select project/i }));
  await userEvent.click(await screen.findByRole('button', { name: 'Source Manager' }));
  await screen.findByText('No sources yet');
  const file = new File(['real text'], 'actual.txt', { type: 'text/plain' });
  await userEvent.upload(screen.getByLabelText('Document file'), file);
  const before = checks; fireEvent(window, new Event('focus'));
  await waitFor(() => expect(checks).toBeGreaterThan(before));
  await waitFor(() => expect(screen.queryByText('Loading project access…')).toBeNull());
  expect((screen.getByLabelText('Document file') as HTMLInputElement).files?.[0]).toBe(file);
  revoked = true; fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByLabelText('Document file')).toBeNull());
});
