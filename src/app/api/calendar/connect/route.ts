import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import {
  CALENDAR_PROMPTED_COOKIE,
  CALENDAR_STATE_COOKIE,
  authUrlForUser,
  calendarRedirectUri,
} from "@/lib/google-oauth";

/**
 * GET /api/calendar/connect
 *
 * Start the one-time Google consent that lets this app create calendar events as
 * the signed-in teacher. Google will not let any application touch a user's
 * calendar until that user has personally allowed it, and the administrative
 * shortcut for granting it on everyone's behalf — Domain-Wide Delegation — is not
 * available in this Workspace. So each teacher passes through here once.
 *
 * Teachers and admins only. A student is never sent here and never needs to be:
 * students are guests on an event, which requires nothing of them beyond an
 * email address.
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const email = session.user.email;
  if (!email) {
    return NextResponse.json(
      { error: "Your account has no email address, so Google cannot be asked for consent." },
      { status: 400 }
    );
  }

  // CSRF guard: the callback only accepts a state it can match against this
  // cookie, so a link someone else crafts cannot complete a connection in this
  // teacher's name.
  const state = randomBytes(32).toString("hex");

  const response = NextResponse.redirect(
    authUrlForUser({
      email,
      state,
      redirectUri: calendarRedirectUri(req.nextUrl.origin),
    })
  );

  response.cookies.set(CALENDAR_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  // Record that this teacher has been sent here, so the dashboard's automatic
  // redirect happens at most once. Set before Google is reached rather than
  // after a successful consent: a teacher who declines must land on the
  // dashboard and stay there, not bounce straight back out to Google.
  response.cookies.set(CALENDAR_PROMPTED_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });

  return response;
}
