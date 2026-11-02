import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { RelayApi, ApiError } from '../src/lib/api';
import { AuthController, cleanCallbackUrl } from '../src/auth/controller';

const relayUser = { id: '11111111-1111-4111-8111-111111111111', email: 'person@example.test', name: null, createdAt: '2026-11-01T00:00:00Z' };
const confirmedUser = {
  id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', role: 'authenticated',
  email: relayUser.email, email_confirmed_at: '2026-11-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
};
const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: confirmedUser.id, exp: 4102444800 }))}.testsignature`;
const session = { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh', user: confirmedUser };
const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });

function setup({ signup = json(confirmedUser), signin = json(session), callback = json(session), relayStatus = 200, meStatus = 401, logoutStatus = 204, providerLogoutStatus = 204, beforeRelay }: {
  signup?: Response; signin?: Response; callback?: Response; relayStatus?: number; meStatus?: number; logoutStatus?: number; providerLogoutStatus?: number;
  beforeRelay?: (path: string, init?: RequestInit) => Promise<Response | undefined>;
} = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const storage = new Map<string, string>();
  const supabase = createClient('https://identity.example.test', 'test-publishable-key', {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce',
      storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } } },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); calls.push({ path: url.pathname + url.search, init });
      if (url.pathname.endsWith('/signup')) return signup.clone();
      if (url.search.includes('grant_type=password')) return signin.clone();
      if (url.search.includes('grant_type=pkce')) return callback.clone();
      if (url.pathname.endsWith('/resend')) return json({});
      if (url.pathname.endsWith('/logout')) return providerLogoutStatus === 204 ? json(null, 204) : json({ msg: 'provider failed' }, providerLogoutStatus);
      throw new Error(`Unexpected provider call: ${url.pathname}`);
    } },
  });
  const api = new RelayApi('', async (input, init) => {
    const path = String(input); calls.push({ path, init });
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    const override = await beforeRelay?.(path, init); if (override) return override;
    if (path === '/api/auth/me') return meStatus === 200 ? json({ user: relayUser }) : json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, meStatus);
    if (path === '/api/auth/logout') return logoutStatus === 204 ? json(null, 204) : json({ error: { code: 'INTERNAL_ERROR', message: 'failed' } }, logoutStatus);
    if (path === '/api/auth/supabase-session') return relayStatus === 200 ? json({ user: relayUser }) : json({ error: { code: relayStatus === 409 ? 'IDENTITY_CONFLICT' : 'INVALID_CREDENTIALS', message: 'rejected' } }, relayStatus);
    throw new Error(`Unexpected Relay call: ${path}`);
  });
  const controller = new AuthController(supabase.auth, api, 'https://relay.example.test/?auth_callback=1');
  return { controller, calls, api, storage, provider: supabase.auth };
}

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('live identity and Relay sessions', () => {
  it('signup without a session stays pending, never exchanges or claims login', async () => {
    const { controller, calls } = setup();
    await controller.signup('person@example.test', 'strong password 2026', 'Person');
    expect(controller.getSnapshot()).toMatchObject({ status: 'pending', user: null, pendingEmail: 'person@example.test' });
    expect(calls.some(c => c.path.includes('supabase-session'))).toBe(false);
    const sent = calls.find(c => c.path.startsWith('/auth/v1/signup'))!;
    expect(JSON.parse(String(sent.init?.body))).toMatchObject({ email: 'person@example.test', password: 'strong password 2026' });
    await controller.resend('person@example.test');
    expect(calls.some(c => c.path.startsWith('/auth/v1/resend'))).toBe(true);
    expect(controller.getSnapshot().status).toBe('pending');
  });

  it('only authenticates after confirmed Supabase login AND a successful Relay exchange', async () => {
    const { controller, calls } = setup();
    await controller.login(relayUser.email, 'password');
    expect(controller.getSnapshot()).toMatchObject({ status: 'authenticated', user: relayUser });
    const exchange = calls.find(c => c.path === '/api/auth/supabase-session')!;
    expect(JSON.parse(String(exchange.init?.body))).toEqual({ accessToken: token });
    expect(calls.some(c => c.path === '/api/auth/login' || c.path === '/api/auth/register')).toBe(false);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(token);
  });

  it.each([401, 409, 503])('Relay exchange failure %s never becomes an authenticated identity', async status => {
    const { controller } = setup({ relayStatus: status });
    await controller.login(relayUser.email, 'password');
    expect(controller.getSnapshot().user).toBeNull();
    expect(controller.getSnapshot().status).not.toBe('authenticated');
    expect(controller.getSnapshot().error).toBeTruthy();
  });

  it('unconfirmed email cannot be bypassed by user metadata or selected roles', async () => {
    const { controller, calls } = setup({ signin: json({ ...session, user: { ...confirmedUser, email_confirmed_at: null, user_metadata: { email_verified: true, role: 'REVIEWER' } } }) });
    await controller.login(relayUser.email, 'password');
    expect(controller.getSnapshot()).toMatchObject({ status: 'pending', user: null });
    expect(calls.some(c => c.path.includes('supabase-session'))).toBe(false);
  });

  it('Supabase email-not-confirmed errors expose resend without fake success', async () => {
    const { controller } = setup({ signin: json({ code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400) });
    await controller.login(relayUser.email, 'password');
    expect(controller.getSnapshot()).toMatchObject({ status: 'pending', user: null, pendingEmail: relayUser.email });
  });

  it('restores only through /auth/me and deduplicates startup', async () => {
    const { controller, calls } = setup({ meStatus: 200 });
    await Promise.all([controller.start('https://relay.example.test/'), controller.start('https://relay.example.test/')]);
    expect(controller.getSnapshot().user).toEqual(relayUser);
    expect(calls.filter(c => c.path === '/api/auth/me')).toHaveLength(1);
  });

  it('handles a real PKCE callback exchange; URL flags alone cannot confirm an email', async () => {
    const { controller, calls } = setup();
    // Signup stores the PKCE verifier using the actual SDK.
    await controller.signup(relayUser.email, 'strong password 2026');
    await controller.start('https://relay.example.test/?auth_callback=1&code=real-provider-code');
    expect(calls.some(c => c.path.includes('grant_type=pkce'))).toBe(true);
    expect(controller.getSnapshot().status).toBe('authenticated');
    const invalid = setup();
    await invalid.controller.start('https://relay.example.test/?auth_callback=1&confirmed=true');
    expect(invalid.controller.getSnapshot().user).toBeNull();
    expect(invalid.controller.getSnapshot().error).toBeTruthy();
  });

  it('failed or expired callback never restores an unrelated existing Relay user', async () => {
    const { controller, calls } = setup({ meStatus: 200, callback: json({ code: 'otp_expired', msg: 'expired' }, 400) });
    await controller.signup(relayUser.email, 'strong password 2026');
    await controller.start('https://relay.example.test/?code=expired-code');
    expect(controller.getSnapshot().user).toBeNull();
    expect(controller.getSnapshot().error).toBeTruthy();
    expect(calls.some(c => c.path === '/api/auth/me')).toBe(false);
    expect(cleanCallbackUrl('https://relay.example.test/?code=secret&auth_callback=1&x=1#access_token=secret')).toBe('/?x=1#login');
  });

  it('logout revokes the Relay cookie and current Supabase session before reporting success', async () => {
    const { controller, calls } = setup();
    await controller.login(relayUser.email, 'password');
    await controller.logout();
    expect(controller.getSnapshot()).toMatchObject({ status: 'anonymous', user: null });
    expect(calls.some(c => c.path === '/api/auth/logout')).toBe(true);
    expect(calls.some(c => c.path.includes('/auth/v1/logout?scope=local'))).toBe(true);
  });

  it.each([{ logoutStatus: 500 }, { providerLogoutStatus: 500 }])('failed logout hides protected content and offers retry: %j', async failure => {
    const { controller } = setup(failure);
    await controller.login(relayUser.email, 'password');
    await controller.logout();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', user: null, retry: 'logout' });
    expect(controller.getSnapshot().error).toBeTruthy();
  });

  it('401 clears identity; 403 preserves identity and is a permission error', async () => {
    const { controller, api } = setup({ meStatus: 200 });
    await controller.start('https://relay.example.test/');
    api.invalidateSession();
    expect(controller.getSnapshot()).toMatchObject({ status: 'anonymous', user: null });
    const forbidden = new RelayApi('', async () => json({ error: { code: 'FORBIDDEN', message: 'Reviewer role required' } }, 403));
    await expect(forbidden.request('/api/projects/one')).rejects.toMatchObject({ status: 403 });
    expect(new ApiError(403, 'FORBIDDEN', 'Denied').status).toBe(403);
  });

  it('stale 401 cannot unlock a second exchange or replace the effective cookie out of order', async () => {
    const exchange = deferred<Response>(), stale = deferred<Response>();
    let cookieIdentity = '';
    const { controller, api, calls } = setup({ beforeRelay: async path => {
      if (path === '/api/projects/stale') return stale.promise;
      if (path === '/api/auth/supabase-session') {
        const response = await exchange.promise; cookieIdentity = relayUser.id; return response;
      }
    } });
    const oldRequest = api.request('/api/projects/stale').catch(() => {});
    const login = controller.login(relayUser.email, 'password');
    await vi.waitFor(() => expect(calls.some(call => call.path === '/api/auth/supabase-session')).toBe(true));
    stale.resolve(json({ error: { code: 'UNAUTHENTICATED' } }, 401)); await oldRequest;
    expect(controller.getSnapshot().busy).toBe(true);
    await controller.login('another@example.test', 'other password');
    expect(calls.filter(call => call.path === '/api/auth/supabase-session')).toHaveLength(1);
    exchange.resolve(json({ user: relayUser })); await login;
    expect(controller.getSnapshot().user?.id).toBe(cookieIdentity);
  });

  it('provider sign-out during exchange hides identity and revokes the late Relay cookie', async () => {
    const exchange = deferred<Response>(); let cookieActive = false;
    const { controller, provider, calls } = setup({ beforeRelay: async path => {
      if (path === '/api/auth/supabase-session') { const response = await exchange.promise; cookieActive = true; return response; }
      if (path === '/api/auth/logout') cookieActive = false;
    } });
    const login = controller.login(relayUser.email, 'password');
    await vi.waitFor(() => expect(calls.some(call => call.path === '/api/auth/supabase-session')).toBe(true));
    await provider.signOut({ scope: 'local' });
    expect(controller.getSnapshot().user).toBeNull();
    exchange.resolve(json({ user: relayUser })); await login;
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('anonymous'));
    expect(cookieActive).toBe(false);
    expect(calls.some(call => call.path === '/api/auth/logout')).toBe(true);
  });
});
