import { calendar_v3 } from "googleapis";
import { RotationSlot } from "@prisma/client";
import { env } from "@/lib/env";

/**
 * Talking to Google Calendar. Deciding *what* an invite says lives in
 * src/lib/session-event.ts; deciding *who sends it* lives in src/lib/coverage.ts.
 *
 * Two things shape every function here.
 *
 * **Events are created by a real user, never by this app's own identity.** Google
 * rejects an attendee list from an unimpersonated service account ("Service
 * accounts cannot invite attendees without Domain-Wide Delegation of Authority"),
 * and this Workspace grants no such delegation. So every function takes an
 * already-authenticated `calendar` client from `getCalendarClientForUser`
 * (src/lib/google-oauth.ts) and writes to that user's own `primary` calendar.
 * There are no app-owned calendars left: no per-club calendar, no shared one-off
 * calendar, and no ACL sharing — which is also what stopped teachers being mailed
 * a "a calendar has been shared with you" subscription request.
 *
 * **Nothing here is specific to club sessions.** `createEvent` and `syncEvent`
 * take a summary, a body, a location and a rotation, which is all a duty post
 * needs too — the cafeteria and the front doors get their events from the same
 * two functions, with an empty attendee list. What differs between the two kinds
 * of block is decided by their callers: src/lib/session-event.ts and
 * src/lib/duty-event.ts write the text, src/lib/duty-calendar.ts and the finalize
 * route decide whose calendar it lands on.
 *
 * **One event covers exactly one rotation.** These functions used to take a
 * `rotations` array and span the earliest start to the latest end, so a session
 * linked across Flex 1 to Flex 3 produced a single 09:00–11:50 block. That
 * swallowed the transition gaps between rotations, and gave all three blocks one
 * shared guest list — so a teacher covering Flex 1 and Flex 3 stayed booked
 * through Flex 2 even when an admin had marked them absent from it. A rotation is
 * now the unit: `SessionCalendarEvent` holds one row, and one event, per block.
 */

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
 * The window one rotation occupies: that rotation's own bell times, and nothing
 * either side of them. The gap before the next rotation stays free on every
 * guest's calendar, which is what the school uses to move between rooms.
 */
export function eventWindow(flexDayDate: Date, rotation: RotationSlot) {
  const tz = env().SCHOOL_TIMEZONE;
  const dateStr = flexDayDate.toISOString().split("T")[0];
  const { start, end } = getRotationTime(rotation);

  return {
    start: { dateTime: `${dateStr}T${start}:00`, timeZone: tz },
    end: { dateTime: `${dateStr}T${end}:00`, timeZone: tz },
  };
}

/**
 * Create the event for one block — one rotation of one session, or one rotation
 * of one duty post — on the organizing teacher's calendar. Returns the event id
 * to store on the `SessionCalendarEvent` or `DutyCalendarEvent` row.
 *
 * The organizer is not in `attendeeEmails`: Google adds the calendar's owner as
 * organizer itself, and listing them again produces a self-invite. A duty block
 * sent by the teacher standing the post therefore passes no attendees at all,
 * which is the whole guest list it should have.
 */
export async function createEvent(params: {
  calendar: calendar_v3.Calendar;
  summary: string;
  description?: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotation: RotationSlot;
  attendeeEmails?: string[];
  sendUpdates?: "all" | "none";
}): Promise<string> {
  const response = await params.calendar.events.insert({
    calendarId: "primary",
    sendUpdates: params.sendUpdates ?? "none",
    requestBody: {
      summary: params.summary,
      description: params.description || undefined,
      location: params.location ?? undefined,
      ...eventWindow(params.flexDayDate, params.rotation),
      attendees: (params.attendeeEmails ?? []).map((email) => ({ email })),
      guestsCanSeeOtherGuests: true,
    },
  });

  const eventId = response.data.id;
  if (!eventId) {
    throw new Error("Google Calendar returned no id for the created event");
  }
  return eventId;
}

/**
 * Update an event's title, time and location when a session's room or rotation
 * changes. Attendees and description are left untouched.
 *
 * The description is deliberately not rewritten: the caller (the club-scoped
 * session editor) has no coverage data loaded, so it could only write a
 * teacher-less body over a correct one. Re-finalizing the day fixes it.
 */
export async function updateEventForSession(params: {
  calendar: calendar_v3.Calendar;
  eventId: string;
  summary: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotation: RotationSlot;
}): Promise<void> {
  await params.calendar.events.patch({
    calendarId: "primary",
    eventId: params.eventId,
    sendUpdates: "none",
    requestBody: {
      summary: params.summary,
      location: params.location ?? undefined,
      ...eventWindow(params.flexDayDate, params.rotation),
    },
  });
}

/**
 * Bring an existing event fully back in line with the database — title, room,
 * body and attendee list — in one patch.
 *
 * Used by the re-finalize path. It was once `syncEventAttendees` and patched the
 * attendee list only, which made the documented way of correcting a Flex Day
 * quietly wrong: unfinalize, fix a room, re-finalize, and the invite still named
 * the old room. Anyone checking their calendar would have walked to the wrong
 * door.
 *
 * sendUpdates: "all" — a re-finalize is an announcement, and a changed room is
 * exactly what attendees need to be told about.
 */
export async function syncEvent(params: {
  calendar: calendar_v3.Calendar;
  eventId: string;
  summary: string;
  description?: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotation: RotationSlot;
  attendeeEmails: string[];
}): Promise<void> {
  await params.calendar.events.patch({
    calendarId: "primary",
    eventId: params.eventId,
    sendUpdates: "all",
    requestBody: {
      summary: params.summary,
      description: params.description || undefined,
      location: params.location ?? undefined,
      ...eventWindow(params.flexDayDate, params.rotation),
      attendees: params.attendeeEmails.map((email) => ({ email })),
    },
  });
}

/**
 * Add a student as an attendee of one event.
 *
 * `sendUpdates` defaults to "none" for background/bulk callers. The admin roster
 * override passes "all" so the affected student actually receives the invite.
 * Google — not this code — decides exactly who gets mail for an attendee-list
 * change; it targets the changed attendees, but that is the API's behavior, not a
 * guarantee we can make here.
 */
export async function addAttendeeToEvent(params: {
  calendar: calendar_v3.Calendar;
  eventId: string;
  studentEmail: string;
  sendUpdates?: "all" | "none";
}): Promise<void> {
  const existing = await params.calendar.events.get({
    calendarId: "primary",
    eventId: params.eventId,
  });

  const currentAttendees = existing.data.attendees ?? [];
  if (currentAttendees.some((a) => a.email === params.studentEmail)) return;

  await params.calendar.events.patch({
    calendarId: "primary",
    eventId: params.eventId,
    requestBody: {
      attendees: [...currentAttendees, { email: params.studentEmail }],
    },
    sendUpdates: params.sendUpdates ?? "none",
  });
}

/**
 * Remove a student from one event. See `addAttendeeToEvent` for the `sendUpdates`
 * semantics.
 */
export async function removeAttendeeFromEvent(params: {
  calendar: calendar_v3.Calendar;
  eventId: string;
  studentEmail: string;
  sendUpdates?: "all" | "none";
}): Promise<void> {
  const existing = await params.calendar.events.get({
    calendarId: "primary",
    eventId: params.eventId,
  });

  const filtered = (existing.data.attendees ?? []).filter(
    (a) => a.email !== params.studentEmail
  );

  await params.calendar.events.patch({
    calendarId: "primary",
    eventId: params.eventId,
    requestBody: { attendees: filtered },
    sendUpdates: params.sendUpdates ?? "none",
  });
}

/** Delete one event from its organizer's calendar. */
export async function deleteEvent(
  calendar: calendar_v3.Calendar,
  eventId: string,
  sendUpdates: "all" | "none" = "none"
): Promise<void> {
  await calendar.events.delete({ calendarId: "primary", eventId, sendUpdates });
}
