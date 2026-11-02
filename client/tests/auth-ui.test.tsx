// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createClient } from '@supabase/supabase-js';
import { AuthController } from '../src/auth/controller';
import { AuthProvider } from '../src/auth/context';
import Auth from '../src/pages/Auth';
import { RelayApi } from '../src/lib/api';

afterEach(cleanup);
function form(register: boolean, providerError = false, gate?: Promise<void>) {
  const requests: string[] = [];
  const provider = createClient('https://identity.example.test', 'test-key', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false, flowType: 'pkce', storageKey: crypto.randomUUID() },
    global: { fetch: async input => {
      const url = new URL(String(input)); requests.push(url.pathname);
      await gate;
      return new Response(JSON.stringify(providerError ? { code: 'invalid_credentials', msg: 'Invalid credentials' } : url.pathname.endsWith('/resend') ? {} : { id: '22222222-2222-4222-8222-222222222222', email: 'person@example.test', email_confirmed_at: null, user_metadata: {} }), {
        status: providerError ? 400 : 200, headers: { 'Content-Type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
      });
    } },
  });
  const api = new RelayApi('', async input => {
    requests.push(String(input));
    return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 });
  });
  const controller = new AuthController(provider.auth, api, 'https://relay.example.test/?auth_callback=1');
  window.history.replaceState(null, '', '/#login');
  render(<AuthProvider controller={controller}><Auth register={register} onSwitch={() => {}} onDemo={() => {}} /></AuthProvider>);
  return { controller, requests };
}

it('real signup form stays pending, clears credentials and resends without claiming confirmation', async () => {
  const { controller, requests } = form(true);
  await userEvent.type(screen.getByLabelText('Email'), 'person@example.test');
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'a strong password 2026');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'a strong password 2026');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByRole('heading', { name: 'Confirm your email' });
  await waitFor(() => expect(screen.queryByLabelText('Password', { exact: true })).toBeNull());
  expect(controller.getSnapshot().user).toBeNull();
  expect(requests).not.toContain('/api/auth/supabase-session');
  await userEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }));
  await screen.findByText(/Confirmation email requested/);
  expect(requests).toContain('/auth/v1/resend');
  expect(controller.getSnapshot().status).toBe('pending');
});

it('password visibility is keyboard accessible and never submits the form', async () => {
  const { requests } = form(false);
  const password = screen.getByLabelText('Password', { exact: true }) as HTMLInputElement;
  await userEvent.type(password, 'private password');
  const toggle = screen.getByRole('button', { name: 'Show password' });
  toggle.focus(); await userEvent.keyboard('{Enter}');
  expect(password.type).toBe('text');
  expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe('true');
  await userEvent.keyboard(' ');
  expect(password.type).toBe('password');
  expect(requests.some(path => path.startsWith('/auth/v1/token'))).toBe(false);
});

it('invalid signup focuses the first invalid field and explains the password requirements', async () => {
  const { requests } = form(true);
  await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
  expect(document.activeElement).toBe(screen.getByLabelText('Email'));
  expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText('Use a password of 12–128 characters.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('#login');
  expect(screen.queryByText(/forgot password/i)).toBeNull();
  expect(requests.some(path => path.startsWith('/auth/v1/signup'))).toBe(false);
});

it('bad credentials show a real error with cleared passwords and an available retry', async () => {
  const { controller } = form(false, true);
  await userEvent.type(screen.getByLabelText('Email'), 'person@example.test');
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'wrong password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Incorrect email or password.')).toBeTruthy();
  expect(controller.getSnapshot().user).toBeNull();
  expect((screen.getByLabelText('Password', { exact: true }) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('button', { name: 'Retry Relay connection' })).toBeNull();
});

it('a pending auth request disables inputs, navigation and duplicate submissions until it settles', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { requests } = form(false, true, gate);
  await userEvent.type(screen.getByLabelText('Email'), 'person@example.test');
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'wrong password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  try {
    expect(screen.getByLabelText('Email').matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Please wait…' }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByRole('button', { name: 'Explore DEMO' }) as HTMLButtonElement).disabled).toBe(true);
    expect(requests.filter(path => path === '/auth/v1/token')).toHaveLength(1);
  } finally { release(); }
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
});

it('mismatched confirmation focuses its field without sending a signup', async () => {
  const { requests } = form(true);
  await userEvent.type(screen.getByLabelText('Email'), 'person@example.test');
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'a strong password 2026');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'another password 2026');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByText('Passwords do not match.')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText('Confirm password'));
  expect(requests).not.toContain('/auth/v1/signup');
});
