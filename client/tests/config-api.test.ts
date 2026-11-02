import { expect, it } from 'vitest';
import { readClientConfig } from '../src/auth/config';
import { RelayApi } from '../src/lib/api';

it('missing live config fails closed; demo requires an explicit mode', () => {
  expect(() => readClientConfig({})).toThrow(/VITE_SUPABASE_URL/);
  expect(readClientConfig({ VITE_RELAY_MODE: 'demo' }).mode).toBe('demo');
  expect(() => readClientConfig({ VITE_RELAY_MODE: 'typo' })).toThrow();
});
it('rejects secret/service-role keys and untrusted configuration URLs', () => {
  const env = { VITE_SUPABASE_URL: 'https://identity.example.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  expect(readClientConfig(env).mode).toBe('live');
  for (const key of ['sb_secret_private', `x.${btoa('{"role":"service_role"}')}.signature`]) {
    expect(() => readClientConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toThrow();
  }
  for (const url of ['http://identity.example.test', 'https://user:pass@identity.example.test', 'https://identity.example.test/path']) {
    expect(() => readClientConfig({ ...env, VITE_SUPABASE_URL: url })).toThrow();
  }
});
it('401 invalidates identity even for unreadable errors, but 403 does not', async () => {
  let invalidated = 0;
  const unauthorized = new RelayApi('', async () => new Response('<html>unauthorized</html>', { status: 401 }));
  unauthorized.onUnauthorized(() => invalidated++);
  await expect(unauthorized.request('/api/projects')).rejects.toMatchObject({ status: 401 });
  expect(invalidated).toBe(1);
  const forbidden = new RelayApi('', async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }));
  forbidden.onUnauthorized(() => invalidated++);
  await expect(forbidden.request('/api/projects')).rejects.toMatchObject({ status: 403 });
  expect(invalidated).toBe(1);
});
it('rejects malformed backend roles instead of enabling a demo or elevated role', async () => {
  const api = new RelayApi('', async () => new Response(JSON.stringify({ projects: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project', role: 'ALL_DEMO' }] })));
  await expect(api.projects()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('invokes browser fetch without a RelayApi receiver', async () => {
  const browserFetch: typeof fetch = async function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 });
  };
  const api = new RelayApi('', browserFetch);
  await expect(api.me()).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
});

it('keeps genuine transport failures visible', async () => {
  const api = new RelayApi('', async () => { throw new TypeError('Failed to fetch'); });
  await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
});
