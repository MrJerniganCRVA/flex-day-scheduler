import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { env } from "@/lib/env";
import { allowedEmailDomain } from "@/lib/email-domain";
import prisma from "@/lib/prisma";

/**
 * Creating calendar events **as the teacher running the room**.
 *
 * The app used to create events with a service account, and every single invite
 * failed: Google rejects `events.insert` carrying a non-empty attendee list from
 * an unimpersonated service account —
 *
 *   "Service accounts cannot invite attendees without Domain-Wide Delegation of
 *    Authority."
 *
 * Domain-Wide Delegation is granted by a Workspace super-admin, which this
 * deployment does not have. The alternative Google supports is ordinary OAuth: a
 * real user may invite whoever they like. So each teacher consents once, we keep
 * the refresh token Google returns, and every event for a rotation is created by
 * that rotation's T1 on their own calendar. The invite then visibly comes from
 * the teacher, which is better than a faceless service account anyway.
 *
 * Deliberately separate from src/auth.ts. Adding the calendar scope to the login
 * provider would mean Auth.js never re-runs authorization for sessions that
 * already exist, so every teacher already signed in would have to sign out and
 * back in before the app could touch their calendar. A standalone authorization
 * against the same OAuth client leaves their session untouched.
 */

/**
 * Event-level access only. Narrower than the `/auth/calendar` the service account
 * held: this app creates, updates and deletes events, and never needs to manage
 * the calendars themselves.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Path Google redirects back to. Must match a registered redirect URI exactly. */
const CALLBACK_PATH = "/api/calendar/callback";

/**
 * Cookie holding the one-time `state` issued when a consent flow starts.
 *
 * The callback completes a connection only for a state it can match against this
 * cookie, so a link someone else crafts cannot attach their Google account to
 * this teacher's record. Lives here rather than in the connect route because a
 * Next.js route module should export request handlers and route config only.
 */
export const CALENDAR_STATE_COOKIE = "flexday_calendar_state";

/**
 * Marks that this browser has already been sent to Google once.
 *
 * The teacher dashboard redirects automatically on a first visit with no grant,
 * so consent feels like part of signing in. Without a record of having asked,
 * a teacher who declines would be redirected again by the very page Google
 * returns them to — a loop with no way out of the app.
 */
export const CALENDAR_PROMPTED_COOKIE = "flexday_calendar_prompted";

/**
 * The redirect URI to hand Google.
 *
 * Prefers the configured deployment URL over the request's own origin, because
 * Google matches this string exactly against the registered list and a request
 * arriving through a proxy under a different host would produce one that isn't on
 * it. `src/auth.ts` already normalizes these two variables to carry a scheme, so
 * a bare hostname from a platform like Railway is safe to read here.
 */
export function calendarRedirectUri(requestOrigin: string): string {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  const base = configured?.trim() || requestOrigin;
  return new URL(CALLBACK_PATH, base).toString();
}

/**
 * `redirectUri` is only meaningful for the two legs of the consent flow — Google
 * matches it against the registered list when issuing and when exchanging a
 * code. Refreshing an existing token never uses it, so that path omits it rather
 * than passing a value that would imply otherwise.
 */
function oauthClient(redirectUri?: string): OAuth2Client {
  const cfg = env();
  return new google.auth.OAuth2({
    clientId: cfg.AUTH_GOOGLE_ID,
    clientSecret: cfg.AUTH_GOOGLE_SECRET,
    ...(redirectUri ? { redirectUri } : {}),
  });
}

/**
 * Where to send a teacher to grant access.
 *
 * `access_type: "offline"` plus `prompt: "consent"` is what guarantees a refresh
 * token comes back. Without the forced consent Google returns only a short-lived
 * access token to a user who has already authorized this client for login — which
 * every teacher here has — and the grant would silently stop working within the
 * hour.
 *
 * `login_hint` and `hd` keep a teacher with several Google accounts signed into
 * the browser from consenting as the wrong one, which would store a token for a
 * calendar nobody is looking at.
 */
export function authUrlForUser(params: {
  email: string;
  state: string;
  redirectUri: string;
}): string {
  return oauthClient(params.redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [CALENDAR_SCOPE],
    include_granted_scopes: true,
    login_hint: params.email,
    hd: allowedEmailDomain(),
    state: params.state,
  });
}

/**
 * Exchange the callback's code for tokens and record the grant.
 *
 * Throws if Google returns no refresh token. That should be impossible given the
 * forced consent above, and storing a grant without one would produce a row that
 * looks connected on the dashboard and fails an hour later — the exact silent
 * degradation this whole change exists to remove.
 */
export async function exchangeCodeForGrant(params: {
  code: string;
  userId: string;
  redirectUri: string;
}): Promise<void> {
  const { tokens } = await oauthClient(params.redirectUri).getToken(params.code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google returned no refresh token, so the connection would stop working within the hour. Revoke this app under the Google account's third-party access and connect again."
    );
  }

  const data = {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? null,
    // Reconnecting is how a teacher recovers from a revoked grant, so this must
    // clear — otherwise the dashboard would keep telling them to do what they
    // have just done.
    revokedAt: null,
  };

  await prisma.calendarGrant.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...data },
    update: data,
  });
}

/**
 * A Calendar client acting as one user, or null if they cannot act.
 *
 * Null rather than a throw, for every "they can't" case — no grant, a revoked
 * one, no user at all. Callers respond to it by falling back to the admin
 * backstop, and a throw would turn one unconnected teacher into a failed
 * finalize for everybody.
 *
 * The access token is refreshed eagerly here rather than lazily on first use, so
 * a dead refresh token surfaces as null now instead of as an exception midway
 * through creating an event.
 */
export async function getCalendarClientForUser(
  userId: string | null | undefined
): Promise<calendar_v3.Calendar | null> {
  if (!userId) return null;

  const grant = await prisma.calendarGrant.findUnique({ where: { userId } });
  if (!grant || grant.revokedAt) return null;

  const client = oauthClient();
  client.setCredentials({
    refresh_token: grant.refreshToken,
    access_token: grant.accessToken ?? undefined,
    expiry_date: grant.expiresAt?.getTime(),
  });

  // Persist whatever the library refreshes, so the stored access token stays
  // usable and every request doesn't pay for a round trip to Google.
  client.on("tokens", (tokens) => {
    prisma.calendarGrant
      .update({
        where: { userId },
        data: {
          ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
          ...(tokens.expiry_date
            ? { expiresAt: new Date(tokens.expiry_date) }
            : {}),
          ...(tokens.refresh_token
            ? { refreshToken: tokens.refresh_token }
            : {}),
        },
      })
      .catch((err) =>
        console.error(`Failed to persist refreshed calendar tokens for user ${userId}:`, err)
      );
  });

  try {
    await client.getAccessToken();
  } catch (err) {
    await markGrantRevoked(userId, err);
    return null;
  }

  return google.calendar({ version: "v3", auth: client });
}

/**
 * Record that a teacher's grant no longer works.
 *
 * Only `invalid_grant` means revoked — the teacher withdrew access, or their
 * account is gone. A network blip or a Google outage must not be written down as
 * a revocation, because that would tell a teacher who did nothing wrong to
 * reconnect, and would send their invites from an admin until they did.
 */
async function markGrantRevoked(userId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("invalid_grant")) {
    console.error(`Could not refresh the calendar token for user ${userId}:`, err);
    return;
  }

  console.error(
    `Calendar access for user ${userId} has been revoked — their invites will fall back to an admin until they reconnect.`
  );
  await prisma.calendarGrant
    .update({ where: { userId }, data: { revokedAt: new Date() } })
    .catch((updateErr) =>
      console.error(`Failed to record the revoked calendar grant for user ${userId}:`, updateErr)
    );
}

/**
 * Which of these users can currently send invites.
 *
 * One query rather than a grant lookup per teacher: the admin Coverage page asks
 * this about every teacher on a Flex Day at once, and finalize uses it to pick a
 * backstop. Note this reports a *stored* grant — a token revoked at Google that
 * nobody has tried to use yet still reads as live until the refresh above fails.
 */
export async function usersWithLiveGrant(
  userIds: string[]
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const rows = await prisma.calendarGrant.findMany({
    where: { userId: { in: userIds }, revokedAt: null },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

/** Whether one user has a stored, unrevoked grant. */
export async function hasLiveGrant(userId: string): Promise<boolean> {
  const grant = await prisma.calendarGrant.findUnique({
    where: { userId },
    select: { revokedAt: true },
  });
  return grant !== null && grant.revokedAt === null;
}
