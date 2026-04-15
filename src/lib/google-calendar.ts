import { google, calendar_v3 } from "googleapis";
import { JWT } from "google-auth-library";
import { RotationSlot } from "@prisma/client";

function getAuthClient(): JWT {
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
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
  const times: Record<RotationSlot, { start: string; end: string }> = {
    FLEX_1: {
      start: process.env.FLEX_1_START ?? "09:00",
      end: process.env.FLEX_1_END ?? "09:50",
    },
    FLEX_2: {
      start: process.env.FLEX_2_START ?? "10:00",
      end: process.env.FLEX_2_END ?? "10:50",
    },
    FLEX_3: {
      start: process.env.FLEX_3_START ?? "11:00",
      end: process.env.FLEX_3_END ?? "11:50",
    },
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
      summary: `CodeRVA – ${clubName}`,
      description: `Club calendar for ${clubName} at CodeRVA Regional High School`,
      timeZone: process.env.SCHOOL_TIMEZONE ?? "America/New_York",
    },
  });
  return response.data.id!;
}

/**
 * Create a calendar event for a club session on a flex day.
 * If the session spans multiple rotations, the event spans from the start
 * of the first rotation to the end of the last rotation.
 * Returns the event ID to store in ClubSession.googleEventId.
 */
export async function createEventForSession(params: {
  calendarId: string;
  clubName: string;
  location: string | null | undefined;
  flexDayDate: Date;
  rotations: RotationSlot[];
  attendeeEmails?: string[];
}): Promise<string> {
  const calendar = getCalendarClient();
  const tz = process.env.SCHOOL_TIMEZONE ?? "America/New_York";
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
    sendUpdates: "none",
    requestBody: {
      summary: `${params.clubName} (${rotationLabel})`,
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
 */
export async function addAttendeeToEvent(params: {
  calendarId: string;
  eventId: string;
  studentEmail: string;
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
    sendUpdates: "none",
  });
}

/**
 * Remove a student from a club session's calendar event.
 */
export async function removeAttendeeFromEvent(params: {
  calendarId: string;
  eventId: string;
  studentEmail: string;
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
    sendUpdates: "none",
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
