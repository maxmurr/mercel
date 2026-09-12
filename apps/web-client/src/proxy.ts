import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Sends visitors without a session to the sign-in page.
 *
 * This reads the cookie only, so it is an optimistic check that keeps signed-out
 * visitors out of the app's pages. Every route that touches a conversation
 * re-checks the session against the database, which is where access is actually
 * decided.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  // API routes answer for themselves; the sign-in page and static files stay public.
  matcher: ["/((?!api/|_next/|sign-in|.*\\.).*)"],
};
