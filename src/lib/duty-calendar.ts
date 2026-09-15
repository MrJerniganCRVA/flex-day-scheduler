import { createEvent, deleteEvent, syncEvent } from "@/lib/google-calendar";
import { dutyEventDescription, dutyEventTitle } from "@/lib/duty-event";
import { rotationName } from "@/lib/session-event";
import { isMissingEvent, type BlockOutcome } from "@/lib/calendar-outcome";
import type { ClientFor, Sender } from "@/lib/calendar-sender";
import prisma from "@/lib/prisma";

/**
 * Calendar events for duty posts.
 *
 * A duty post is somewhere a teacher has to stand so the building has adequate
 * eyes — a hallway, the cafeteria, the front doors. Until this existed, staffing
 * one produced no calendar entry at all: a teacher sent to the cafeteria for
 * Flex 2 was told by a dashboard they had to remember to open, while every club
 * sponsor got a real invite. `DutyPost` was deliberately kept outside everything
 * student-facing, and calendar finalize was one of the paths it was kept out of.
 *
 * Three things distinguish this from the session pass in the finalize route.
 *
 * **The event has no attendees.** The only person expected at a duty post is
 * whoever is standing it, and Google already makes the calendar's owner the
 * organizer — so the guest list is empty, deliberately. Nobody else is told, and
 * nothing here can reach a student.
 *
 * **The single exception is the fallback.** When the assigned teacher has not
 * connected their calendar, an event on an admin's calendar with an empty guest
 * list would sit where the teacher will never see it. So in that case, and only
 * that case, the teacher is added as the event's one attendee.
 *
 * **It runs independently of finalizing.** This is exported so it can be invoked
 * on its own against a day whose student invites have already gone out. Nothing
 * here reads or writes a `SessionCalendarEvent`, which is what makes that safe:
 * there is no path from a duty backfill to a student's mailbox. Re-running is
 * idempotent — each assignment either patches the event it has or creates the one
 * it is missing.
 */

/** Everything the pass needs about one assignment, as the query below returns it. */
type DutyRow = Awaited<ReturnType<typeof loadDutyAssignments>>[number];

function loadDutyAssignments(flexDayId: string) {
  return prisma.dutyAssignment.findMany({
    where: { flexDayId },
    include: {
      dutyPost: {
        select: {
          name: true,
          location: true,
          requiredRotations: true,
          isActive: true,
        },
      },
      teacher: { select: { id: true, name: true, email: true } },
      calendarEvent: {
        select: { id: true, googleEventId: true, ownerId: true },
      },
      flexDay: { select: { date: true } },
    },
    orderBy: [{ dutyPost: { name: "asc" } }, { rotation: "asc" }],
  });
}

/** "Cafeteria duty — Flex 2", the label an admin sees in the problem list. */
const blockLabel = (row: DutyRow) =>
  `${row.dutyPost.name} duty — ${rotationName(row.rotation)}`;

/**
 * Whether this assignment describes a block that is actually happening.
 *
 * A post can go inactive, or drop a rotation from its standing requirement,
 * while assignments made under the old shape stay in the table. Those are stale
 * rather than unstaffed: nobody needs to be told about them, but any event they
 * already produced has to come back off a calendar.
 */
const isLiveBlock = (row: DutyRow) =>
  row.dutyPost.isActive && row.dutyPost.requiredRotations.includes(row.rotation);

/**
 * Take an event back off its owner's calendar and forget it.
 *
 * Best-effort and never thrown from, matching every other calendar-cleanup path
 * in the app: the decision it reflects has already been made in the database, and
 * a failure is logged with the event id so it can be removed by hand.
 */
async function withdraw(
  row: DutyRow,
  clientFor: ClientFor,
  why: string
): Promise<void> {
  const event = row.calendarEvent;
  if (!event) return;

  const calendar = event.ownerId ? await clientFor(event.ownerId) : null;
  if (calendar) {
    await deleteEvent(calendar, event.googleEventId, "all").catch((err) =>
      console.error(
        `Failed to withdraw the ${blockLabel(row)} event after ${why}:`,
        err
      )
    );
  } else {
    console.error(
      `Cannot withdraw the ${blockLabel(row)} event after ${why}: nobody can send from its calendar any more, so it may linger there.`
    );
  }

  await prisma.dutyCalendarEvent
    .delete({ where: { id: event.id } })
    .catch((err) =>
      console.error(
        `Failed to drop the ${blockLabel(row)} event row after ${why}:`,
        err
      )
    );
}

/**
 * Issue, update or withdraw the calendar event for every duty block on a Flex
 * Day, and report what happened to each.
 *
 * `clientFor` and `getBackstop` are passed in rather than built here so the
 * finalize route can share one client cache and one backstop resolution across
 * both its passes, instead of refreshing the same admin's token twice.
 */
export async function sendDutyInvites(params: {
  flexDayId: string;
  clientFor: ClientFor;
  getBackstop: () => Promise<Sender | null>;
}): Promise<BlockOutcome[]> {
  const rows = await loadDutyAssignments(params.flexDayId);
  const outcomes: BlockOutcome[] = [];

  // Sequential rather than raced: a Flex Day has a handful of duty posts, they
  // share the client cache and the backstop, and several blocks are often
  // covered by the same teacher — so racing would buy nothing and could
  // duplicate a token refresh.
  for (const row of rows) {
    const label = blockLabel(row);
    const live = isLiveBlock(row);

    // Not happening, or nobody standing it: either way no event should exist.
    if (!live || !row.teacher) {
      await withdraw(
        row,
        params.clientFor,
        live ? "its teacher was unassigned" : "the post stopped needing this block"
      );

      // An active post that still requires this rotation but has nobody on it is
      // a real gap an admin should see. A stale row for a block the post no
      // longer needs is not — it is bookkeeping, and saying so would bury the
      // gaps that matter.
      if (live) {
        outcomes.push({
          rotation: row.rotation,
          label,
          kind: "skipped",
          teacherName: null,
          reason: "unstaffed",
        });
      }
      continue;
    }

    const teacher = row.teacher;

    try {
      // The teacher standing the post sends it, so the event lands on their own
      // calendar with no guests at all.
      const ownClient = await params.clientFor(teacher.id);

      let sender: Sender | null = ownClient
        ? { client: ownClient, userId: teacher.id }
        : null;
      let attendeeEmails: string[] = [];
      let fellBackFrom: { teacherName: string | null } | null = null;

      if (!sender) {
        // They cannot send. An admin's calendar is the only way to get anything
        // issued at all — and an event sitting there with an empty guest list
        // would never reach the person actually on duty, so here the teacher
        // becomes its one and only attendee.
        const backstop = await params.getBackstop();
        if (!backstop) {
          outcomes.push({
            rotation: row.rotation,
            label,
            kind: "skipped",
            teacherName: teacher.name,
            reason: "no-calendar",
          });
          continue;
        }
        sender = backstop;
        attendeeEmails = [teacher.email];
        fellBackFrom = { teacherName: teacher.name };
      }

      // Composed once and used by both branches, so a first send and a re-run
      // produce byte-identical text — which is what keeps a re-run from looking
      // to Google like a change worth mailing anybody about.
      const location = row.dutyPost.location;
      const summary = dutyEventTitle({
        postName: row.dutyPost.name,
        location,
        rotation: row.rotation,
      });
      const description = dutyEventDescription({
        postName: row.dutyPost.name,
        location,
        rotation: row.rotation,
      });

      const existing = row.calendarEvent;
      const sameSender = existing != null && existing.ownerId === sender.userId;

      let patched = false;
      if (sameSender) {
        try {
          await syncEvent({
            calendar: sender.client,
            eventId: existing!.googleEventId,
            summary,
            description,
            location,
            flexDayDate: row.flexDay.date,
            rotation: row.rotation,
            attendeeEmails,
          });
          patched = true;
        } catch (err) {
          // The owner deleted the event from their own calendar, which they can
          // do — it is theirs. Fall through and issue a fresh one rather than
          // failing this block on every future run.
          if (!isMissingEvent(err)) throw err;
          console.error(
            `The ${label} event no longer exists on its owner's calendar; issuing a replacement.`
          );
        }
      }

      if (!patched) {
        // No event yet, the post changed hands, or the old event is gone. Google
        // cannot move an event between calendars, so a changed sender means
        // withdrawing the old one and issuing a new one from whoever is standing
        // the post now.
        if (existing && !sameSender) {
          await withdraw(row, params.clientFor, "the post changed hands");
        }

        const eventId = await createEvent({
          calendar: sender.client,
          summary,
          description,
          location,
          flexDayDate: row.flexDay.date,
          rotation: row.rotation,
          attendeeEmails,
          sendUpdates: "all",
        });

        await prisma.dutyCalendarEvent.upsert({
          where: { dutyAssignmentId: row.id },
          create: {
            dutyAssignmentId: row.id,
            googleEventId: eventId,
            ownerId: sender.userId,
          },
          update: { googleEventId: eventId, ownerId: sender.userId },
        });
      }

      outcomes.push({ rotation: row.rotation, label, kind: "sent", fellBackFrom });
    } catch (error) {
      outcomes.push({ rotation: row.rotation, label, kind: "failed", error });
    }
  }

  return outcomes;
}
