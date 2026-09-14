import {
  addAttendeeToEvent,
  getOneOffCalendarId,
  removeAttendeeFromEvent,
} from "@/lib/google-calendar";

/**
 * Which calendar a session's event lives on, and how to reconcile one
 * student's place on it.
 *
 * Both halves were written out by hand in POST /api/admin/roster before this
 * file existed, and the "which calendar" question is asked in four other
 * places besides. It is a small rule, but it is the rule that decides whether
 * a calendar update reaches the right event at all, and a second feature
 * needing it is the point at which it should exist exactly once.
 */

/** The shape both callers already select. */
export interface SessionCalendarRef {
  clubId: string | null;
  club: { googleCalendarId: string | null } | null;
}

/**
 * The calendar a session's event lives on, or null if there isn't one.
 *
 * Club sessions use their club's calendar. One-off sessions (`clubId === null`)
 * use the shared app-owned calendar, read with `getOneOffCalendarId` rather
 * than `getOrCreate…`: if it was never provisioned then no event was ever
 * created on it, and there is nothing to reconcile. Creating one here would
 * make a read-only question have a side effect.
 */
export async function resolveSessionCalendarId(
  session: SessionCalendarRef
): Promise<string | null> {
  if (session.clubId === null) return getOneOffCalendarId();
  return session.club?.googleCalendarId ?? null;
}

/** One student's place on one event, to be reconciled after the commit. */
export type AttendeeOp =
  | { op: "remove"; calendarId: string; eventId: string; email: string }
  | { op: "add"; calendarId: string; eventId: string; email: string };

/**
 * Apply queued attendee changes, after the database change they describe has
 * committed.
 *
 * Two orderings matter here:
 *
 *  - **After the commit, never inside it.** A Google API hiccup must not roll
 *    back a roster change the admin has already been told about, and the
 *    reverse — committing only after a successful send — would risk a student
 *    holding an invite for a signup that does not exist. So every failure is
 *    logged and none is thrown.
 *  - **Removals before adds.** Both functions are read-modify-write against
 *    Google (`events.get` then `events.patch`), so two operations on the same
 *    event race: a removal that reads before an add and patches after it wipes
 *    the add out. A student moved between two sessions of the same club is
 *    exactly that case, and it is the common one on this screen.
 */
export async function applyAttendeeOps(
  ops: AttendeeOp[],
  context: string
): Promise<void> {
  const ordered = [
    ...ops.filter((o) => o.op === "remove"),
    ...ops.filter((o) => o.op === "add"),
  ];

  for (const op of ordered) {
    const fn = op.op === "add" ? addAttendeeToEvent : removeAttendeeFromEvent;
    await fn({
      calendarId: op.calendarId,
      eventId: op.eventId,
      studentEmail: op.email,
      sendUpdates: "all",
    }).catch((err) =>
      console.error(
        `${context}, but the calendar ${op.op} for ${op.email} on event ${op.eventId} failed:`,
        err
      )
    );
  }
}
