import { NextResponse } from 'next/server';
import { isAuthConfigured, isPlausibleEmail, supabaseMagicLink } from '../../../../lib/server/auth';
import { readGuestToken } from '../../../../lib/server/session';
import { getDraftStore } from '../../../../lib/server/draft-store';
import { setPendingClaim } from '../../../../lib/server/result-claims';
import { withJsonErrors } from '../../../../lib/server/json-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAME_LENGTH = 40;

/**
 * Optional post-draft claim: guest supplies a display name + email; we stash the
 * pending claim against their guest token and send the standard magic link. The
 * auth callback applies it once the email is verified (spec §0.5).
 */
export const POST = withJsonErrors(async (request: Request) => {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: 'Accounts are not enabled on this deployment yet. Guest play still works.' },
      { status: 503 },
    );
  }
  const guestToken = readGuestToken(request);
  if (guestToken === null) {
    return NextResponse.json({ error: 'Start a guest session first' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  const { draftId, displayName, email } = (body ?? {}) as {
    draftId?: unknown;
    displayName?: unknown;
    email?: unknown;
  };
  if (typeof draftId !== 'string' || draftId.length === 0) {
    return NextResponse.json({ error: 'draftId is required' }, { status: 400 });
  }
  if (
    typeof displayName !== 'string' ||
    displayName.trim().length === 0 ||
    displayName.trim().length > MAX_NAME_LENGTH
  ) {
    return NextResponse.json(
      { error: `Pick a display name up to ${MAX_NAME_LENGTH} characters` },
      { status: 400 },
    );
  }
  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  const state = await getDraftStore().get(draftId);
  if (state === undefined || state.guestToken !== guestToken || state.result === null) {
    return NextResponse.json(
      { error: 'Only a completed draft from this browser can be claimed' },
      { status: 404 },
    );
  }
  await setPendingClaim(guestToken, {
    draftId,
    displayName: displayName.trim(),
  });
  const redirectTo = new URL('/api/auth/callback', request.url).toString();
  try {
    await supabaseMagicLink().send(email.trim().toLowerCase(), redirectTo, guestToken);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not send the link' },
      { status: 502 },
    );
  }
  return NextResponse.json({ sent: true });
});
