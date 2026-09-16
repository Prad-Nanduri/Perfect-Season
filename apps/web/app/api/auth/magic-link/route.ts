import { NextResponse } from 'next/server';
import { isAuthConfigured, isPlausibleEmail, supabaseMagicLink } from '../../../../lib/server/auth';
import { readGuestToken } from '../../../../lib/server/session';
import { withJsonErrors } from '../../../../lib/server/json-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const { email } = (body ?? {}) as { email?: unknown };
  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  const redirectTo = new URL('/api/auth/callback', request.url).toString();
  try {
    await supabaseMagicLink().send(email.trim().toLowerCase(), redirectTo, guestToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not send the link';
    if (/rate.?limit/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'Too many sign-in emails were sent recently — please wait a few minutes and try again.',
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ sent: true });
});
