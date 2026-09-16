import { createSupabaseClient } from '@perfect-season/db';

export function isAuthConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

export interface MagicLinkSender {
  send(email: string, redirectTo: string): Promise<void>;
  verify(tokenHash: string, type?: string | null): Promise<{ email: string } | null>;
  exchangeCode(code: string): Promise<{ email: string } | null>;
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

/** Supabase Auth magic link (spec §5.1: Supabase is the single auth provider). */
export function supabaseMagicLink(): MagicLinkSender {
  const client = createSupabaseClient();
  return {
    async send(email, redirectTo) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (error) throw new Error(error.message);
    },
    // Supabase's default email template signs users in at /auth/v1/verify and
    // redirects here with a type param; a TokenHash-style template lands here
    // directly. Try the advertised type first, then the two flavors magic-link
    // tokens verify under — a wrong type looks identical to an expired token.
    async verify(tokenHash, type) {
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
    async exchangeCode(code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error || !data.user?.email) return null;
      return { email: data.user.email };
    },
  };
}

export function isPlausibleEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
