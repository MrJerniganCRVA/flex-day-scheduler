import { google, calendar_v3 } from "googleapis";
import { JWT } from "google-auth-library";
import { RotationSlot } from "@prisma/client";
import { env } from "@/lib/env";
import prisma from "@/lib/prisma";

/** Pinned primary key of the AppConfig single-row table. */
const SINGLETON_ID = "singleton";

function getAuthClient(): JWT {
  const privateKey = env().GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(
    /\\n/g,
    "\n"
  );

  return new google.auth.JWT({
    email: env().GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
}

function getCalendarClient(): calendar_v3.Calendar {
  const auth = getAuthClient();
  return google.calendar({ version: "v3", auth });
}

function getRotationTime(rotation: RotationSlot): {
  start: string;
  end: string;
} {
  const cfg = env();
  const times: Record<RotationSlot, { start: string; end: string }> = {
    FLEX_1: { start: cfg.FLEX_1_START, end: cfg.FLEX_1_END },
    FLEX_2: { start: cfg.FLEX_2_START, end: cfg.FLEX_2_END },
    FLEX_3: { start: cfg.FLEX_3_START, end: cfg.FLEX_3_END },
  };
  return times[rotation];
}

/**
 * Create a Google Calendar for a newly created club.
 * Returns the calendar ID to store in Club.googleCalendarId.
 */
export async function createCalendarForClub(clubName: string): Promise<string> {
  const calendar = getCalendarClient();
  const response = await calendar.calendars.insert({
    requestBody: {
      summary: clubName,
      description: `Club calendar for ${clubName}`,
      timeZone: env().SCHOOL_TIMEZONE,
    },
  });
  return response.data.id!;
}

/**
 * Share a club's Google Calendar with the teacher who owns it.
 * Grants owner role so the teacher can edit events and manage the calendar
 * directly from their Google Calendar — no domain-wide delegation needed.
 */
export async function shareCalendarWithTeacher(
  calendarId: string,
  teacherEmail: string
): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.acl.insert({
    calendarId,
    requestBody: {
      role: "owner",
      scope: {
        type: "user",
        value: teacherEmail,
      },
    },
  });
}

/**
 * Google Calendar that hosts events for one-off sessions.
 *
 * One-off sessions have no club, so they have no club calendar to live on —
 * which is why they previously received no invites at all. A single app-owned
 * calendar hosts all of them. It is deliberately NOT ACL-shared with anyone:
 * the owning teacher is added as an *attendee* of their own event, which puts
 * it on their personal calendar with the roster visible, and avoids an ACL that
 * would grow with every teacher who ever creates a one-off (and would let any
 * of them delete another's event).
 *
 * The id is stored in the AppConfig singleton rather than an env var so a
 * missing value can't silently regress to the old no-invite behavior — if the
 * row is empty we create the calendar and persist it.
 */

/**
 * Read the stored one-off calendar id without creating one. Deletion paths use
 * this: if no calendar has ever been provisioned there is no event to remove,
 * and creating a calendar in order to delete from it would be absurd.
 */
export async function getOneOffCalendarId(): Promise<string | null> {
  const row = await prisma.appConfig.findUnique({
    where: { id: SINGLETON_ID },
    select: { oneOffCalendarId: true },
  });
  return row?.oneOffCalendarId ?? null;
}

export async function getOrCreateOneOffCalendarId(): Promise<string> {
  const fromDb = await getOneOffCalendarId();
  if (fromDb) return fromDb;

  const calendar = getCalendarClient();
  const response = await calendar.calendars.insert({
    requestBody: {
      summary: "Flex Day — One-Off Sessions",
      description:
        "Hosts calendar events for one-off Flex Day sessions (sessions not tied to a club). Managed automatically by the Flex Day Scheduler.",
      timeZone: env().SCHOOL_TIMEZONE,
    },
  });
  const calendarId = response.data.id;
  if (!calendarId) {
    throw new Error("Google Calendar API returned no id for the one-off calendar");
  }

  await prisma.appConfig.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, oneOffCalendarId: calendarId },
    update: { oneOffCalendarId: calendarId },
  });

  return calendarId;
}

/**
 * Window a session occupies: the start of its first rotation to the end of its
 * last. Extracted because three callers computed it identically, and a session
 * spanning Flex 1 and Flex 2 is one event covering both, not two.
 *
 * `.sort()` on the raw enum is correct here — FLEX_1 < FLEX_2 < FLEX_3
 * lexicographically — and is what puts the earliest bell first.
 */
function eventWindow(flexDayDate: Date, rotations: RotationSlot[]) {
  const tz = env().SCHOOL_TIMEZONE;
  const dateStr = flexDayDate.toISOString().split("T")[0];

  const sorted = [...rotations].sort();
  const startTime = getRotationTime(sorted[0]).start;
  const endTime = getRotationTime(sorted[sorted.length - 1]).end;

  return {
    start: { dateTime: `${dateStr}T${startTime}:00`, timeZone: tz },
    end: { dateTime: `${dateStr}T${endTime}:00`, timeZone: tz },
  };
}

/**
 * Create a calendar event for a club session on a flex day.
 * Returns the event ID to store in ClubSession.googleEventId.
 *
 * `summary` and `description` arrive already composed — see
 * src/lib/session-event.ts. Deciding what an invite says needs the room, the
 * resolved teachers and the school's own title convention, none of which belong
 * in the module whose job is talking to Google.
 */
export async function createEventForSession(params: {
  calendarId: string;
  summary: string;
  description?: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotations: RotationSlot[];
  attendeeEmails?: string[];
  sendUpdates?: "all" | "none";
}): Promise<string> {
  const calendar = getCalendarClient();

  const response = await calendar.events.insert({
    calendarId: params.calendarId,
    sendUpdates: params.sendUpdates ?? "none",
    requestBody: {
      summary: params.summary,
      description: params.description || undefined,
      location: params.location ?? undefined,
      ...eventWindow(params.flexDayDate, params.rotations),
      attendees: (params.attendeeEmails ?? []).map((email) => ({ email })),
      guestsCanSeeOtherGuests: true,
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (response as any).data.id as string;
}

/**
 * Update a calendar event's title, time, and location when a session's rotations
 * or room changes. Attendees and description are left untouched.
 *
 * The description is deliberately not rewritten: the caller (the club-scoped
 * session editor) has no coverage data loaded, so it could only write a
 * teacher-less body over a correct one. A rotation change therefore leaves the
 * description's "When" line stale until the day is re-finalized — cosmetic,
 * because the event's actual start and end times are updated here and those are
 * what a calendar shows.
 */
export async function updateEventForSession(params: {
  calendarId: string;
  eventId: string;
  summary: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotations: RotationSlot[];
}): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    sendUpdates: "none",
    requestBody: {
      summary: params.summary,
      location: params.location ?? undefined,
      ...eventWindow(params.flexDayDate, params.rotations),
    },
  });
}

/**
 * Bring an existing event fully back in line with the database: its title, its
 * room, its body and its attendee list, in one patch.
 *
 * Used by the re-finalize path. It was previously `syncEventAttendees` and
 * patched the attendee list *only*, which made the documented way of correcting
 * a Flex Day quietly wrong: unfinalize, fix a room, re-finalize, and the invite
 * still named the old room. Anyone checking their calendar would have walked to
 * the wrong door. Renamed rather than extended in place, because a function
 * called `syncEventAttendees` that also rewrites the title is a worse trap than
 * the bug it fixes.
 *
 * sendUpdates: "all" — a re-finalize is an announcement, and a changed room is
 * exactly the thing attendees need to be told about.
 */
export async function syncEventForSession(params: {
  calendarId: string;
  eventId: string;
  summary: string;
  description?: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotations: RotationSlot[];
  attendeeEmails: string[];
}): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    sendUpdates: "all",
    requestBody: {
      summary: params.summary,
      description: params.description || undefined,
      location: params.location ?? undefined,
      ...eventWindow(params.flexDayDate, params.rotations),
      attendees: params.attendeeEmails.map((email) => ({ email })),
    },
  });
}

/**
 * Add a student as an attendee to a club session's calendar event.
 *
 * `sendUpdates` defaults to "none" for background/bulk callers. The admin roster
 * override passes "all" so the affected student actually receives the new
 * invite. Note that Google — not this code — decides exactly who gets mail for
 * an attendee-list change; it targets the changed attendees, but that behavior
 * is the API's, not a guarantee we can make here.
 */
export async function addAttendeeToEvent(params: {
  calendarId: string;
  eventId: string;
  studentEmail: string;
  sendUpdates?: "all" | "none";
}): Promise<void> {
  const calendar = getCalendarClient();
  const existing = await calendar.events.get({
    calendarId: params.calendarId,
    eventId: params.eventId,
  });

  const currentAttendees = existing.data.attendees ?? [];
  if (currentAttendees.some((a) => a.email === params.studentEmail)) return;

  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    requestBody: {
      attendees: [...currentAttendees, { email: params.studentEmail }],
    },
    sendUpdates: params.sendUpdates ?? "none",
  });
}

/**
 * Remove a student from a club session's calendar event.
 * See `addAttendeeToEvent` for the `sendUpdates` semantics.
 */
export async function removeAttendeeFromEvent(params: {
  calendarId: string;
  eventId: string;
  studentEmail: string;
  sendUpdates?: "all" | "none";
}): Promise<void> {
  const calendar = getCalendarClient();
  const existing = await calendar.events.get({
    calendarId: params.calendarId,
    eventId: params.eventId,
  });

  const filtered = (existing.data.attendees ?? []).filter(
    (a) => a.email !== params.studentEmail
  );

  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    requestBody: { attendees: filtered },
    sendUpdates: params.sendUpdates ?? "none",
  });
}

/**
 * Delete a calendar event (called when a club session is removed).
 */
export async function deleteEvent(
  calendarId: string,
  eventId: string
): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.delete({ calendarId, eventId, sendUpdates: "none" });
}

/**
 * Delete an entire calendar (called when a club is deleted).
 */
export async function deleteCalendar(calendarId: string): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.calendars.delete({ calendarId });
}
