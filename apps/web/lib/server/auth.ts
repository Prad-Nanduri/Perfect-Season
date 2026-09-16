import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { createSupabaseClient } from '@perfect-season/db';
import { storePkceVerifier, takePkceVerifier } from './pkce-store';

export function isAuthConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

export interface MagicLinkSender {
  send(email: string, redirectTo: string, guestToken?: string | null): Promise<void>;
  verify(tokenHash: string, type?: string | null): Promise<{ email: string } | null>;
  exchangeCode(code: string, guestToken?: string | null): Promise<{ email: string } | null>;
}

type EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email';

const OTP_TYPES: readonly EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

function asOtpType(value: string | null | undefined): EmailOtpType | null {
  return OTP_TYPES.find((type) => type === value) ?? null;
}

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Anon client with a caller-owned storage bag. `signInWithOtp` writes the PKCE
 * code verifier into storage on the sending client; `exchangeCodeForSession`
 * reads it back from storage on the exchanging client. Persisting the bag's
 * verifier is what lets a server-initiated magic link complete — without it
 * every exchange fails with "expired".
 */
function authClient(storage: Map<string, string>): {
  client: SupabaseClient;
  codeVerifierKey: string;
} {
  const supabaseUrl = envOrThrow('SUPABASE_URL');
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  const adapter: SupportedStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
    removeItem: (key) => {
      storage.delete(key);
    },
  };
  return {
    client: createClient(supabaseUrl, envOrThrow('SUPABASE_ANON_KEY'), {
      auth: { storage: adapter, flowType: 'pkce' },
    }),
    codeVerifierKey: `${storageKey}-code-verifier`,
  };
}

/** Supabase Auth magic link (spec §5.1: Supabase is the single auth provider). */
export function supabaseMagicLink(): MagicLinkSender {
  return {
    async send(email, redirectTo, guestToken) {
      const storage = new Map<string, string>();
      const { client, codeVerifierKey } = authClient(storage);
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (error) throw new Error(error.message);
      const verifier = storage.get(codeVerifierKey);
      if (guestToken && verifier) await storePkceVerifier(guestToken, verifier);
    },
    // Supabase's default email template signs users in at /auth/v1/verify and
    // redirects here with a type param; a TokenHash-style template lands here
    // directly. Try the advertised type first, then the two flavors magic-link
    // tokens verify under — a wrong type looks identical to an expired token.
    async verify(tokenHash, type) {
      const client = createSupabaseClient();
      const candidates = [asOtpType(type), 'magiclink', 'email'].filter(
        (candidate, index, all): candidate is EmailOtpType =>
          candidate !== null && all.indexOf(candidate) === index,
      );
      for (const otpType of candidates) {
        const { data, error } = await client.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType,
        });
        if (!error && data.user?.email) return { email: data.user.email };
      }
      return null;
    },
    async exchangeCode(code, guestToken) {
      const storage = new Map<string, string>();
      const { client, codeVerifierKey } = authClient(storage);
      const verifier = guestToken ? await takePkceVerifier(guestToken) : null;
      if (verifier !== null) storage.set(codeVerifierKey, verifier);
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error || !data.user?.email) return null;
      return { email: data.user.email };
    },
  };
}

export function isPlausibleEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
