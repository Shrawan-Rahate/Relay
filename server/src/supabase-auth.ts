import { z } from "zod";

export type SupabaseAuthOptions = {
  url: string;
  publishableKey: string;
  fetch?: typeof fetch;
};

export class SupabaseAuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const invalidIdentity = () => new SupabaseAuthError(401, "INVALID_CREDENTIALS", "Invalid or expired identity");
const unavailable = () => new SupabaseAuthError(503, "AUTH_UNAVAILABLE", "Identity verification is unavailable");
const identitySchema = z.object({
  id: z.string().uuid(),
  email: z.string().trim().toLowerCase().max(254).email(),
  email_confirmed_at: z.string().datetime({ offset: true }).nullish(),
  is_anonymous: z.boolean().optional(),
});

export function createSupabaseVerifier(options: SupabaseAuthOptions, production: boolean) {
  const url = new URL(options.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local && !production))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || !options.publishableKey.trim() || /[\r\n]/.test(options.publishableKey)) {
    throw new Error("Invalid Supabase auth configuration");
  }
  const endpoint = new URL("/auth/v1/user", url);
  const request = options.fetch ?? fetch;
  return async (token: string) => {
    let response: Response;
    let body: unknown;
    try {
      // Always ask the configured Auth server. Never authorize decoded JWTs,
      // request-supplied user objects, or user-editable verification metadata.
      response = await request(endpoint, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { apikey: options.publishableKey, Authorization: `Bearer ${token}` },
      });
      if (response.ok) body = await response.json();
    } catch { throw unavailable(); }
    if (response.status === 429 || response.status >= 500) throw unavailable();
    if (!response.ok) throw invalidIdentity();
    const parsed = identitySchema.safeParse(body);
    if (!parsed.success || parsed.data.is_anonymous) throw invalidIdentity();
    if (!parsed.data.email_confirmed_at) {
      throw new SupabaseAuthError(403, "EMAIL_UNVERIFIED", "Confirmed email required");
    }
    return { id: parsed.data.id, email: parsed.data.email };
  };
}
