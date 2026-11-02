import { createClient } from '@supabase/supabase-js';
import { RelayApi } from '../lib/api';
import { readClientConfig } from './config';
import { AuthController } from './controller';

let runtime: AuthController | undefined;
export function getLiveAuth() {
  if (runtime) return runtime;
  const config = readClientConfig({ VITE_RELAY_MODE: 'live',
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_API_ORIGIN: import.meta.env.VITE_API_ORIGIN,
  });
  const supabase = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) }) },
  });
  const redirect = new URL(window.location.pathname, window.location.origin);
  redirect.searchParams.set('auth_callback', '1');
  runtime = new AuthController(supabase.auth, new RelayApi(config.apiOrigin), redirect.toString());
  return runtime;
}
