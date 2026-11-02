import type { Project, User } from '../../../shared/api-types';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const messages: Record<string, string> = {
  AUTH_MODE_DISABLED: 'Supabase login is disabled on the Relay backend. Ask your administrator to enable it.',
  IDENTITY_CONFLICT: 'This email belongs to an existing Relay account. An administrator must review the identity; accounts are never merged by email.',
  EMAIL_UNVERIFIED: 'Confirm your email before continuing.',
  INVALID_CREDENTIALS: 'Your identity could not be verified. Sign in again.',
  AUTH_UNAVAILABLE: 'Identity verification is temporarily unavailable. Please retry.',
  UNAUTHENTICATED: 'Your Relay session expired. Please sign in again.',
  FORBIDDEN: 'You do not have permission for this action. Refresh your project access.',
  RATE_LIMITED: 'Too many attempts. Please wait before retrying.',
};

function userFrom(body: { user: User }): User {
  const user = body?.user;
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string'
      || typeof user.createdAt !== 'string' || !(user.name === null || typeof user.name === 'string')) {
    throw new ApiError(502, 'INVALID_RESPONSE', 'Relay returned an invalid identity. Please retry.');
  }
  // Keep tokens and unexpected provider metadata out of application identity.
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

export function projectFrom(project: Project): Project {
  if (!project || !/^[0-9a-f-]{36}$/i.test(project.id) || typeof project.name !== 'string'
      || !['REVIEWER', 'OUTGOING', 'INCOMING'].includes(project.role)) {
    throw new ApiError(502, 'INVALID_RESPONSE', 'Relay returned invalid project access. Please refresh.');
  }
  return project;
}

/** Shared transport for auth and workflow integration. Never attach Supabase tokens here. */
export class RelayApi {
  private unauthorized = new Set<() => void>();
  private sessionEpoch = 0;
  constructor(private origin = '', private fetcher: typeof fetch = fetch) {}
  onUnauthorized(listener: () => void) { this.unauthorized.add(listener); return () => { this.unauthorized.delete(listener); }; }
  advanceSession() { this.sessionEpoch++; }
  invalidateSession() { this.advanceSession(); this.unauthorized.forEach(listener => listener()); }

  async request<T>(path: string, init: RequestInit = {}, notifyUnauthorized = true): Promise<T> {
    if (!path.startsWith('/api/') || path.includes('..') || path.includes('\\')) throw new Error('Invalid Relay API path');
    const headers = new Headers(init.headers);
    const epoch = this.sessionEpoch;
    headers.delete('Authorization');
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      // Native browser fetch must not receive RelayApi as its receiver.
      const fetcher = this.fetcher;
      response = await fetcher(`${this.origin}${path}`, {
        ...init, headers, credentials: 'include', cache: 'no-store',
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new ApiError(0, 'REQUEST_TIMEOUT', 'The Relay request timed out.');
      throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach Relay. Check your connection and retry.');
    }
    if (response.status === 401 && notifyUnauthorized && epoch === this.sessionEpoch) this.invalidateSession();
    let body: unknown;
    if (response.status !== 204) {
      try { body = await response.json(); } catch {
        throw new ApiError(response.status, 'INVALID_RESPONSE', 'Relay returned an unreadable response. Please retry.');
      }
    }
    if (!response.ok) {
      const error = (body as { error?: { code?: unknown; message?: unknown } })?.error;
      const code = typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED';
      // Source validation messages are server-provided text, never HTML. Keep auth messages unchanged.
      const sourceMessage = /^\/api\/projects\/[^/]+\/sources(?:\/|$)/.test(path)
        && ['INVALID_INPUT', 'SOURCE_EXISTS', 'PAYLOAD_TOO_LARGE', 'PUBLIC_REPOSITORY_REQUIRED', 'GITHUB_NOT_FOUND', 'GITHUB_FORBIDDEN', 'GITHUB_RATE_LIMITED', 'GITHUB_IMPORT_TOO_LARGE', 'GITHUB_UNAVAILABLE'].includes(code)
        && typeof error?.message === 'string' && error.message.trim() ? error.message.slice(0, 1000) : undefined;
      throw new ApiError(response.status, code, sourceMessage ?? messages[code] ?? `Relay could not complete the request (${response.status}). Please retry.`);
    }
    return body as T;
  }
  async me() { return userFrom(await this.request<{ user: User }>('/api/auth/me', {}, false)); }
  async exchange(accessToken: string) {
    return userFrom(await this.request<{ user: User }>('/api/auth/supabase-session', { method: 'POST', body: JSON.stringify({ accessToken }) }, false));
  }
  logout() { return this.request<void>('/api/auth/logout', { method: 'POST' }, false); }
  async projects() {
    const body = await this.request<{ projects: Project[] }>('/api/projects');
    if (!Array.isArray(body?.projects)) throw new ApiError(502, 'INVALID_RESPONSE', 'Project access could not be loaded.');
    return body.projects.map(projectFrom);
  }
  async project(id: string) {
    const { project } = await this.request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`);
    return projectFrom(project);
  }
}
