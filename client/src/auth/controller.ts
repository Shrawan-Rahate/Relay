import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { User } from '../../../shared/api-types';
import { ApiError, RelayApi } from '../lib/api';

export type AuthState = {
  status: 'restoring' | 'anonymous' | 'pending' | 'authenticated' | 'error' | 'signing-out';
  user: User | null;
  busy: boolean;
  pendingEmail?: string;
  error?: string;
  notice?: string;
  retry?: 'restore' | 'exchange' | 'logout';
};

const callbackKeys = ['code', 'auth_callback', 'sb_flow_id', 'error', 'error_code', 'error_description'];
export function isAuthCallback(value: string) {
  const url = new URL(value);
  return callbackKeys.some(key => url.searchParams.has(key)) || /(?:access_token|refresh_token|error)=/.test(url.hash);
}
export function cleanCallbackUrl(value: string) {
  const url = new URL(value);
  callbackKeys.forEach(key => url.searchParams.delete(key));
  return `${url.pathname}${url.search}#login`;
}

function message(error: unknown) {
  if (error instanceof ApiError) return error.message;
  const code = (error as { code?: string })?.code;
  if (code === 'invalid_credentials') return 'Incorrect email or password.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'Too many requests. Please wait before retrying.';
  if (code === 'weak_password') return 'Choose a stronger password that meets the account password policy.';
  if (code === 'signup_disabled' || code === 'email_provider_disabled') return 'Email signup is disabled. Contact your administrator.';
  return 'The authentication request failed. Check your connection and try again.';
}

/** Relay identity is set only by Relay HTTP responses, never Supabase metadata. */
export class AuthController {
  private state: AuthState = { status: 'restoring', user: null, busy: false };
  private listeners = new Set<() => void>();
  private startup?: Promise<void>;
  private task?: Promise<void>;
  private running = false;
  private logoutTask?: Promise<void>;
  private generation = 0;
  private exchangeIdentityId?: string;
  constructor(private provider: SupabaseClient['auth'], readonly api: RelayApi, private redirectTo: string) {
    api.onUnauthorized(() => {
      this.generation++;
      this.exchangeIdentityId = undefined;
      this.set({ status: 'anonymous', user: null, busy: this.running, error: 'Your Relay session expired. Please sign in again.' });
    });
    provider.onAuthStateChange(event => {
      // Other-tab sign-out must also revoke this browser's Relay session.
      if (event === 'SIGNED_OUT' && this.state.status !== 'signing-out' && (this.running || this.state.status === 'authenticated')) {
        queueMicrotask(() => { void this.logout(); });
      }
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: AuthState) { this.state = state; this.listeners.forEach(listener => listener()); }
  private async run(work: (current: () => boolean) => Promise<void>, retry?: AuthState['retry']) {
    if (this.running || this.state.busy || this.logoutTask) return;
    this.running = true;
    const generation = ++this.generation;
    const current = () => this.generation === generation;
    this.set({ ...this.state, busy: true, error: undefined, notice: undefined, retry: undefined });
    this.task = (async () => {
      try { await work(current); } catch (error) {
        if (current()) this.set({ status: 'error', user: null, busy: false, pendingEmail: this.state.pendingEmail,
          error: message(error), retry: retry === 'exchange' && !(error instanceof ApiError) ? undefined : retry });
      } finally {
        this.running = false;
        if (!this.logoutTask && this.state.busy) this.set({ ...this.state, busy: false });
      }
    })();
    await this.task;
  }
  private async accept(session: Session | null, current: () => boolean) {
    if (!current()) return;
    if (!session?.access_token) throw new Error('No provider session');
    if (!session.user.email_confirmed_at || session.user.is_anonymous) {
      if (current()) this.set({ status: 'pending', user: null, busy: false, pendingEmail: session.user.email, error: 'Confirm your email before signing in.' });
      return;
    }
    this.exchangeIdentityId = session.user.id;
    const user = await this.api.exchange(session.access_token);
    if (current()) this.set({ status: 'authenticated', user, busy: false });
  }
  start(url: string) {
    this.startup ??= isAuthCallback(url) ? this.callback(url) : this.restore();
    return this.startup;
  }
  async restore() {
    await this.run(async current => {
      try {
        const user = await this.api.me();
        if (current()) this.set({ status: 'authenticated', user, busy: false });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        if (current()) this.set({ status: 'anonymous', user: null, busy: false, error: this.state.user ? 'Your Relay session expired. Please sign in again.' : undefined });
      }
    }, 'restore');
  }
  async login(email: string, password: string) {
    await this.run(async current => {
      this.api.advanceSession();
      this.exchangeIdentityId = undefined;
      const { data, error } = await this.provider.signInWithPassword({ email, password });
      if (error?.code === 'email_not_confirmed') {
        if (current()) this.set({ status: 'pending', user: null, busy: false, pendingEmail: email, error: 'Confirm your email before signing in.' });
        return;
      }
      if (error) throw error;
      await this.accept(data.session, current);
    }, 'exchange');
  }
  async signup(email: string, password: string, name?: string) {
    await this.run(async current => {
      this.api.advanceSession();
      this.exchangeIdentityId = undefined;
      const { data, error } = await this.provider.signUp({ email, password, options: {
        emailRedirectTo: this.redirectTo, ...(name ? { data: { name } } : {}),
      } });
      if (error) throw error;
      if (data.session) await this.accept(data.session, current);
      else if (current()) this.set({ status: 'pending', user: null, busy: false, pendingEmail: email,
        notice: 'If this address is eligible, check your inbox for a confirmation link. You are not signed in.' });
    }, 'exchange');
  }
  async resend(email: string) {
    await this.run(async current => {
      const { error } = await this.provider.resend({ type: 'signup', email, options: { emailRedirectTo: this.redirectTo } });
      if (error) throw error;
      if (current()) this.set({ status: 'pending', user: null, busy: false, pendingEmail: email,
        notice: 'Confirmation email requested. If eligible, a link will arrive shortly. Your email is not yet confirmed here.' });
    });
  }
  async resume() {
    await this.run(async current => {
      this.api.advanceSession();
      const { data, error } = await this.provider.getSession();
      if (error) throw error;
      if (!data.session || data.session.user.id !== this.exchangeIdentityId) throw new ApiError(401, 'NO_PROVIDER_SESSION', 'Sign in with your email and password after confirming. Confirmation alone does not create a Relay session.');
      await this.accept(data.session, current);
    }, 'exchange');
  }
  private async callback(value: string) {
    await this.run(async current => {
      this.api.advanceSession();
      this.exchangeIdentityId = undefined;
      const url = new URL(value);
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.has('error') || /(?:error|access_token)=/.test(url.hash)) {
        throw new ApiError(401, 'INVALID_CALLBACK', 'The confirmation link is incomplete or expired. Request a new link, or sign in if you already confirmed your email.');
      }
      const flowId = url.searchParams.get('sb_flow_id');
      const { data, error } = await this.provider.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (error || !data.session) throw new ApiError(401, 'INVALID_CALLBACK', 'The confirmation link could not be verified. Open it in the browser used to sign up, request a new link, or sign in after confirmation.');
      await this.accept(data.session, current);
    }, 'exchange');
  }
  logout(): Promise<void> {
    if (this.logoutTask) return this.logoutTask;
    const pending = this.task;
    this.generation++;
    this.api.advanceSession();
    this.exchangeIdentityId = undefined;
    this.set({ status: 'signing-out', user: null, busy: true });
    this.logoutTask = (async () => {
      // Hide identity immediately, then wait for a late Set-Cookie before revoking it.
      await pending;
      try {
        const results = await Promise.allSettled([
          this.api.logout(),
          this.provider.signOut({ scope: 'local' }).then(({ error }) => { if (error) throw error; }),
        ]);
        if (results.some(result => result.status === 'rejected')) {
          throw new ApiError(0, 'LOGOUT_FAILED', 'Sign-out could not be completed for both sessions. Protected content is hidden. Retry sign-out.');
        }
        this.set({ status: 'anonymous', user: null, busy: false, notice: 'Signed out of Relay and this Supabase session.' });
      } catch (error) {
        this.set({ status: 'error', user: null, busy: false, error: message(error), retry: 'logout' });
      }
    })().finally(() => { this.logoutTask = undefined; });
    return this.logoutTask;
  }
}
