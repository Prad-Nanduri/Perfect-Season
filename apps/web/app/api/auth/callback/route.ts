import { NextResponse } from 'next/server';
import { isAuthConfigured, supabaseMagicLink } from '../../../../lib/server/auth';
import { linkGuestToAccount, getSessionStore } from '../../../../lib/server/session-store';
import { takePendingClaim } from '../../../../lib/server/result-claims';
import { claimResultForUser } from '../../../../lib/server/leaderboard';
import { readGuestToken, readSportCookie } from '../../../../lib/server/session';
import { COOKIE_MAX_AGE_SECONDS, SPORT_COOKIE } from '../../../../lib/sport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function accountRedirect(request: Request, status: 'linked' | 'invalid' | 'disabled' | 'noguest') {
  return NextResponse.redirect(new URL(`/account?status=${status}`, request.url));
}

/**
 * Magic-link landing. Verifies the Supabase token, links the guest session to the account, and
 * pre-selects the account's `default_sport` (spec §0.5) via the sport cookie.
 */
export async function GET(request: Request) {
  if (!isAuthConfigured()) return accountRedirect(request, 'disabled');
  const guestToken = readGuestToken(request);
  if (guestToken === null) return accountRedirect(request, 'noguest');
  const params = new URL(request.url).searchParams;
  const magicLink = supabaseMagicLink();
  const tokenHash = params.get('token_hash');
  const code = params.get('code');
  const verified =
    tokenHash !== null
      ? await magicLink.verify(tokenHash, params.get('type'))
      : code !== null
        ? await magicLink.exchangeCode(code)
        : null;
  if (verified === null) return accountRedirect(request, 'invalid');
  const { user } = await linkGuestToAccount(
    getSessionStore(),
    guestToken,
    verified.email,
    readSportCookie(request) ?? 'nfl',
  );
  const claim = await takePendingClaim(guestToken);
  if (claim !== null) {
    try {
      await claimResultForUser(verified.email, claim.displayName, claim.draftId);
    } catch (error) {
      console.warn('[auth] result claim failed', error);
    }
  }
  const response = accountRedirect(request, 'linked');
  if (user.defaultSport !== null) {
    response.cookies.set(SPORT_COOKIE, user.defaultSport, {
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
      sameSite: 'lax',
    });
  }
  return response;
}
