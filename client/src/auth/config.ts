export type ClientConfig = { mode: 'live' | 'demo'; supabaseUrl: string; publishableKey: string; apiOrigin: string };
export function assertPublishableKey(key: string) {
  const value = key.trim();
  if (value.startsWith('sb_secret_')) throw new Error('Use a Supabase publishable key in the client. Secret keys are prohibited.');
  if (value.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'anon') throw new Error('Not an anonymous public key');
    } catch { throw new Error('Use a Supabase publishable or legacy anon key, never a service-role key.'); }
  }
}
export function readClientConfig(env: Record<string, string | boolean | undefined>): ClientConfig {
  const mode = env.VITE_RELAY_MODE ?? 'live';
  if (mode !== 'live' && mode !== 'demo') throw new Error('VITE_RELAY_MODE must be live or demo.');
  if (mode === 'demo') return { mode, supabaseUrl: '', publishableKey: '', apiOrigin: '' };
  const supabaseUrl = String(env.VITE_SUPABASE_URL ?? '');
  const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!supabaseUrl || !publishableKey) throw new Error('Live authentication requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  const validateOrigin = (value: string, name: string) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`${name} must be a valid origin.`); }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`${name} must use HTTPS (or loopback HTTP for development) with no path, credentials, query or fragment.`);
    }
    return url.origin;
  };
  assertPublishableKey(publishableKey);
  const apiOrigin = String(env.VITE_API_ORIGIN ?? '');
  return { mode, supabaseUrl: validateOrigin(supabaseUrl, 'VITE_SUPABASE_URL'), publishableKey,
    apiOrigin: apiOrigin ? validateOrigin(apiOrigin, 'VITE_API_ORIGIN') : '' };
}
