import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { auth } from "@/auth";
import {
  CALENDAR_STATE_COOKIE,
  calendarRedirectUri,
  exchangeCodeForGrant,
} from "@/lib/google-oauth";

/**
 * GET /api/calendar/callback
 *
 * Where Google returns a teacher after they allow (or refuse) calendar access.
 * Stores the refresh token and sends them back to their dashboard.
 *
 * Every failure lands back on the dashboard with a `calendar=` flag rather than
 * rendering an error page: the teacher arrives here mid-navigation, often having
 * been redirected automatically, and a dead end with a JSON body would leave them
 * with no way back into the app.
 */

/** Where a teacher ends up, whatever happened. */
function backToDashboard(req: NextRequest, status: string): NextResponse {
  const url = new URL("/teacher", req.nextUrl.origin);
  url.searchParams.set("calendar", status);
  return NextResponse.redirect(url);
}

function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const expectedState = req.cookies.get(CALENDAR_STATE_COOKIE)?.value;

  const finish = (status: string) => {
    const response = backToDashboard(req, status);
    response.cookies.delete(CALENDAR_STATE_COOKIE);
    return response;
  };

  // The teacher pressed Cancel, or Google refused. Not an error worth shouting
  // about — the dashboard banner will still be there to try again.
  const error = params.get("error");
  if (error) {
    console.log(`Calendar consent declined by ${session.user.email}: ${error}`);
    return finish("declined");
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !expectedState || !statesMatch(state, expectedState)) {
    console.error(
      `Rejected a calendar callback for ${session.user.email}: the state did not match the one issued at /api/calendar/connect.`
    );
    return finish("failed");
  }

  try {
    await exchangeCodeForGrant({
      code,
      userId: session.user.id,
      redirectUri: calendarRedirectUri(req.nextUrl.origin),
    });
  } catch (err) {
    console.error(`Failed to store calendar access for ${session.user.email}:`, err);
    return finish("failed");
  }

  return finish("connected");
}
