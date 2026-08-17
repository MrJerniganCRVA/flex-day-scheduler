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
 * Create a calendar event for a club session on a flex day.
 * If the session spans multiple rotations, the event spans from the start
 * of the first rotation to the end of the last rotation.
 * Returns the event ID to store in ClubSession.googleEventId.
 *
 * `title` is the club's name for club sessions and the session's own title for
 * one-off sessions — a student sees the name they signed up for either way.
 */
export async function createEventForSession(params: {
  calendarId: string;
  title: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotations: RotationSlot[];
  attendeeEmails?: string[];
  sendUpdates?: "all" | "none";
}): Promise<string> {
  const calendar = getCalendarClient();
  const tz = env().SCHOOL_TIMEZONE;
  const dateStr = params.flexDayDate.toISOString().split("T")[0];

  const sortedRotations = [...params.rotations].sort();
  const firstRotation = sortedRotations[0];
  const lastRotation = sortedRotations[sortedRotations.length - 1];

  const startTime = getRotationTime(firstRotation).start;
  const endTime = getRotationTime(lastRotation).end;

  const rotationLabel = sortedRotations
    .map((r) => r.replace("FLEX_", "Flex "))
    .join(" + ");

  const response = await calendar.events.insert({
    calendarId: params.calendarId,
    sendUpdates: params.sendUpdates ?? "none",
    requestBody: {
      summary: `${params.title} (${rotationLabel})`,
      location: params.location ?? undefined,
      start: { dateTime: `${dateStr}T${startTime}:00`, timeZone: tz },
      end: { dateTime: `${dateStr}T${endTime}:00`, timeZone: tz },
      attendees: (params.attendeeEmails ?? []).map((email) => ({ email })),
      guestsCanSeeOtherGuests: true,
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (response as any).data.id as string;
}

/**
 * Update a calendar event's title, time, and location when a session's rotations
 * or room changes. Attendees are left untouched.
 */
export async function updateEventForSession(params: {
  calendarId: string;
  eventId: string;
  title: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotations: RotationSlot[];
}): Promise<void> {
  const calendar = getCalendarClient();
  const tz = env().SCHOOL_TIMEZONE;
  const dateStr = params.flexDayDate.toISOString().split("T")[0];

  const sortedRotations = [...params.rotations].sort();
  const firstRotation = sortedRotations[0];
  const lastRotation = sortedRotations[sortedRotations.length - 1];

  const startTime = getRotationTime(firstRotation).start;
  const endTime = getRotationTime(lastRotation).end;

  const rotationLabel = sortedRotations
    .map((r) => r.replace("FLEX_", "Flex "))
    .join(" + ");

  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    sendUpdates: "none",
    requestBody: {
      summary: `${params.title} (${rotationLabel})`,
      location: params.location ?? undefined,
      start: { dateTime: `${dateStr}T${startTime}:00`, timeZone: tz },
      end: { dateTime: `${dateStr}T${endTime}:00`, timeZone: tz },
    },
  });
}

/**
 * Replace the full attendee list on a calendar event with the provided emails.
 * Used during finalization to batch-sync all signups at once.
 * sendUpdates: "all" ensures each student receives a calendar invite email.
 */
export async function syncEventAttendees(params: {
  calendarId: string;
  eventId: string;
  attendeeEmails: string[];
}): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    sendUpdates: "all",
    requestBody: {
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
