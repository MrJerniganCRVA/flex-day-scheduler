import { calendar_v3 } from "googleapis";
import type { RotationSlot } from "@prisma/client";
import {
  addAttendeeToEvent,
  deleteEvent,
  removeAttendeeFromEvent,
  updateEventForSession,
} from "@/lib/google-calendar";
import { getCalendarClientForUser } from "@/lib/google-oauth";
import { sessionEventTitle } from "@/lib/session-event";
import prisma from "@/lib/prisma";

/**
 * Reconciling one student's place on a session's calendar events.
 *
 * Both halves of this were written out by hand in POST /api/admin/roster before
 * this file existed, and the question it answers — which events exist, and whose
 * calendar each one is on — is asked in four other places besides.
 *
 * A session has one event **per rotation**, each on the calendar of the teacher
 * covering that block, so "put this student on the session's event" is now "put
 * them on every event the session has". That is the right behavior in every
 * current caller: a signup is for the whole session, so a student attends all of
 * its blocks.
 */

/**
 * Prisma `select` for a session's events. Spread this rather than listing the
 * columns by hand, so adding one reaches every reader at once.
 */
export const SESSION_EVENTS_SELECT = {
  rotation: true,
  googleEventId: true,
  ownerId: true,
} as const;

/** One event of one session — the shape `SESSION_EVENTS_SELECT` produces. */
export interface SessionEventRef {
  rotation: RotationSlot;
  googleEventId: string;
  /** Null only if the owning user was deleted; the event is then unreachable. */
  ownerId: string | null;
}

/** One student's place on one event, to be reconciled after the commit. */
export type AttendeeOp = {
  op: "add" | "remove";
  eventId: string;
  ownerId: string | null;
  email: string;
};

/**
 * The operations that put one student on, or take them off, every event a
 * session has.
 *
 * A session with no events yet — one whose Flex Day has not been finalized —
 * yields none, which is why every caller can queue these unconditionally.
 */
export function attendeeOpsForSession(
  events: SessionEventRef[],
  email: string,
  op: "add" | "remove"
): AttendeeOp[] {
  return events.map((event) => ({
    op,
    eventId: event.googleEventId,
    ownerId: event.ownerId,
    email,
  }));
}

/**
 * Apply queued attendee changes, after the database change they describe has
 * committed.
 *
 * Three orderings and choices matter here:
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
 *    exactly that case, and it is the common one on this screen. The race is now
 *    per event rather than per session, and the ordering still resolves it.
 *  - **One client per owner.** A move between two sessions covered by the same
 *    teacher would otherwise refresh that teacher's token once per event.
 *
 * An event whose owner can no longer send — their account is gone, or they
 * revoked access — is logged and skipped. Re-finalizing the day reissues it from
 * whoever covers the block now.
 */
export async function applyAttendeeOps(
  ops: AttendeeOp[],
  context: string
): Promise<void> {
  const ordered = [
    ...ops.filter((o) => o.op === "remove"),
    ...ops.filter((o) => o.op === "add"),
  ];

  const clients = new Map<string, Promise<calendar_v3.Calendar | null>>();
  const clientFor = (userId: string) => {
    let pending = clients.get(userId);
    if (!pending) {
      pending = getCalendarClientForUser(userId);
      clients.set(userId, pending);
    }
    return pending;
  };

  for (const op of ordered) {
    const calendar = op.ownerId ? await clientFor(op.ownerId) : null;
    if (!calendar) {
      console.error(
        `${context}, but the calendar ${op.op} for ${op.email} on event ${op.eventId} was skipped: nobody can send from that event's calendar any more. Re-finalize the day to reissue it.`
      );
      continue;
    }

    const fn = op.op === "add" ? addAttendeeToEvent : removeAttendeeFromEvent;
    await fn({
      calendar,
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

/**
 * Cancel a set of events, each from its own organizer's calendar.
 *
 * Best-effort and never thrown from, matching how every delete path in the app
 * treats calendar cleanup: the database row is already gone, and the calendar is
 * a copy of a decision made there. A failure is logged with the event id so it
 * can be removed by hand.
 *
 * Callers must read the events *before* deleting their session — a
 * `SessionCalendarEvent` row cascades away with it, and after that there is no
 * record of which events to cancel, leaving every student holding an invite for
 * something that no longer exists.
 */
export async function withdrawEvents(
  events: SessionEventRef[],
  context: string
): Promise<void> {
  const clients = new Map<string, Promise<calendar_v3.Calendar | null>>();

  for (const event of events) {
    if (!event.ownerId) {
      console.error(
        `${context}: cannot cancel event ${event.googleEventId} — its owning account is gone, so it may linger on that calendar.`
      );
      continue;
    }

    let pending = clients.get(event.ownerId);
    if (!pending) {
      pending = getCalendarClientForUser(event.ownerId);
      clients.set(event.ownerId, pending);
    }
    const calendar = await pending;

    if (!calendar) {
      console.error(
        `${context}: cannot cancel event ${event.googleEventId} — nobody can send from its calendar any more, so it may linger there.`
      );
      continue;
    }

    await deleteEvent(calendar, event.googleEventId, "all").catch((err) =>
      console.error(`${context}: failed to cancel event ${event.googleEventId}:`, err)
    );
  }
}

/**
 * Re-title and re-place a session's existing events after its room or rotations
 * changed, and cancel any whose rotation the session no longer has.
 *
 * Used by the club-scoped session editor, which knows the room but not the
 * coverage. It therefore cannot *create* an event for a newly added rotation —
 * there is nobody to pick as its organizer — so a rotation gained here stays
 * without an invite until the day is re-finalized, which is where organizers are
 * resolved. A rotation *removed* is handled in full, because leaving that event
 * in place would have students holding an invite to a block that is no longer
 * running.
 *
 * The description is deliberately not rewritten for the same reason: with no
 * coverage loaded this could only write a teacher-less body over a correct one.
 */
export async function resyncSessionEvents(params: {
  events: SessionEventRef[];
  /** The rotations the session has *after* the edit. */
  rotations: RotationSlot[];
  name: string;
  roomName: string | null;
  flexDayDate: Date;
  context: string;
}): Promise<void> {
  const live = new Set(params.rotations);
  const clients = new Map<string, Promise<calendar_v3.Calendar | null>>();
  const clientFor = (userId: string) => {
    let pending = clients.get(userId);
    if (!pending) {
      pending = getCalendarClientForUser(userId);
      clients.set(userId, pending);
    }
    return pending;
  };

  const stale = params.events.filter((e) => !live.has(e.rotation));
  if (stale.length > 0) {
    await withdrawEvents(stale, params.context);
    await prisma.sessionCalendarEvent
      .deleteMany({
        where: {
          googleEventId: { in: stale.map((e) => e.googleEventId) },
        },
      })
      .catch((err) =>
        console.error(`${params.context}: failed to drop stale event rows:`, err)
      );
  }

  for (const event of params.events.filter((e) => live.has(e.rotation))) {
    const calendar = event.ownerId ? await clientFor(event.ownerId) : null;
    if (!calendar) {
      console.error(
        `${params.context}: cannot update event ${event.googleEventId} — nobody can send from its calendar any more. Re-finalize the day to reissue it.`
      );
      continue;
    }

    await updateEventForSession({
      calendar,
      eventId: event.googleEventId,
      summary: sessionEventTitle({
        name: params.name,
        roomName: params.roomName,
        rotation: event.rotation,
      }),
      location: params.roomName,
      flexDayDate: params.flexDayDate,
      rotation: event.rotation,
    }).catch((err) =>
      console.error(
        `${params.context}: failed to update event ${event.googleEventId}:`,
        err
      )
    );
  }
}
