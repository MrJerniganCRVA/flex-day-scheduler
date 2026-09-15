import { NextRequest, NextResponse } from "next/server";
import { RotationSlot } from "@prisma/client";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createEvent, deleteEvent, syncEvent } from "@/lib/google-calendar";
import {
  resolveRoomName,
  rotationName,
  sessionEventDescription,
  sessionEventTitle,
} from "@/lib/session-event";
import {
  SESSION_ABSENCE_SELECT,
  SESSION_COVERAGE_SELECT,
  resolveSessionCoverage,
  sessionRef,
} from "@/lib/coverage";
import {
  type BlockOutcome,
  describeProblems,
  isFailed,
  isMissingEvent,
  isSent,
  isSkipped,
  type SentOutcome,
} from "@/lib/calendar-outcome";
import { type Sender, makeBackstop, makeClientCache } from "@/lib/calendar-sender";
import { sendDutyInvites } from "@/lib/duty-calendar";

/**
 * Finalizing a Flex Day: send every invite it implies.
 *
 * The unit of work is a **block** — one rotation of one session — not a session.
 * A club linked across Flex 1 to Flex 3 sends three invites sitting at their own
 * bell times, which leaves the transition gaps free and lets each invite carry
 * only the coverage for its own block. See the note on `SessionCalendarEvent` in
 * the schema for why the single spanning event it replaced was wrong.
 *
 * Each block's invite is created **by that block's T1**, on their own calendar,
 * over OAuth (src/lib/google-oauth.ts). Google refuses attendee invites from this
 * app's own service identity without Domain-Wide Delegation, which this Workspace
 * does not grant — and sending as the covering teacher is better anyway, because
 * the invite then visibly comes from the person standing in the room.
 *
 * A teacher who has not yet granted access does not cost their students an
 * invite: the block falls back to an admin's calendar and is reported by name, so
 * the day still goes out and the gap is visible rather than silent.
 *
 * Finalizing also issues the day's **duty** events — the hallway, the cafeteria,
 * the front doors — through src/lib/duty-calendar.ts. That pass lives in its own
 * module rather than here because it has to be runnable on its own, against a day
 * whose student invites have already gone out: see the route at
 * /api/flex-days/[flexDayId]/duty-invites for why re-finalizing is not a safe way
 * to backfill them.
 */

/** One rotation of one session, as this pass carries it between steps. */
type BlockRef = {
  sessionId: string;
  rotation: RotationSlot;
  /** "Art Club — Flex 2", for the admin-facing report. */
  label: string;
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actorId = session.user.id;

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    include: {
      clubSessions: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              ownerId: true,
              cosponsorId: true,
              owner: { select: { name: true, email: true } },
              cosponsor: { select: { name: true, email: true } },
              defaultRoom: { select: { name: true } },
            },
          },
          oneOffOwner: { select: { id: true, name: true, email: true } },
          roomOverride: { select: { name: true } },
          rotationCoverage: { select: SESSION_COVERAGE_SELECT },
          // A teacher who has stepped back from a rotation must not be invited to
          // it, even when they are the club's owner and therefore the implicit
          // default — and, now that events are per-rotation, must not be invited
          // to that rotation while staying on the others they do cover.
          teacherAbsences: { select: SESSION_ABSENCE_SELECT },
          sessionEvents: {
            select: {
              id: true,
              rotation: true,
              googleEventId: true,
              ownerId: true,
            },
          },
          signups: {
            include: {
              student: { select: { email: true } },
            },
          },
        },
      },
    },
  });

  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  if (flexDay.isFinalized) {
    return NextResponse.json(
      { error: "This flex day has already been finalized" },
      { status: 409 }
    );
  }

  const sessionName = (cs: (typeof flexDay.clubSessions)[number]) =>
    cs.title ?? cs.club?.name ?? "Session";

  // Emails for turning resolved coverage into attendees, and names for the invite
  // body — which says who is in the room, something the title has no space for
  // and the attendee list conveys only as an email address.
  const teacherEmailById = new Map<string, string>();
  const teacherNameById = new Map<string, string>();
  for (const cs of flexDay.clubSessions) {
    if (cs.club?.ownerId && cs.club.owner?.email) {
      teacherEmailById.set(cs.club.ownerId, cs.club.owner.email);
      teacherNameById.set(cs.club.ownerId, cs.club.owner.name);
    }
    if (cs.club?.cosponsorId && cs.club.cosponsor?.email) {
      teacherEmailById.set(cs.club.cosponsorId, cs.club.cosponsor.email);
      teacherNameById.set(cs.club.cosponsorId, cs.club.cosponsor.name);
    }
    if (cs.oneOffOwner?.id && cs.oneOffOwner.email) {
      teacherEmailById.set(cs.oneOffOwner.id, cs.oneOffOwner.email);
      teacherNameById.set(cs.oneOffOwner.id, cs.oneOffOwner.name);
    }
  }
  // Explicitly-assigned coverage teachers may be neither owner nor cosponsor of
  // the club they're covering, so their emails need a separate lookup.
  const assignedTeacherIds = new Set<string>();
  for (const cs of flexDay.clubSessions) {
    for (const rc of cs.rotationCoverage) {
      if (rc.primaryTeacherId) assignedTeacherIds.add(rc.primaryTeacherId);
      if (rc.secondaryTeacherId) assignedTeacherIds.add(rc.secondaryTeacherId);
    }
  }
  const missingIds = [...assignedTeacherIds].filter(
    (id) => !teacherEmailById.has(id)
  );
  if (missingIds.length > 0) {
    const extra = await prisma.user.findMany({
      where: { id: { in: missingIds } },
      select: { id: true, name: true, email: true },
    });
    for (const u of extra) {
      teacherEmailById.set(u.id, u.email);
      teacherNameById.set(u.id, u.name);
    }
  }

  // Shared by both passes below, so a teacher covering a club and a duty post
  // costs one token refresh, and the backstop admin is resolved once for the
  // whole day rather than once per pass.
  const clientFor = makeClientCache();
  const getBackstop = makeBackstop(actorId, clientFor);

  // Settle each session independently. Blocks within a session run in sequence:
  // they share a stale-row cleanup and an upsert per rotation, and a linked
  // session is at most three of them, so there is nothing to gain from racing.
  const settled = await Promise.all(
    flexDay.clubSessions.map(async (cs): Promise<BlockOutcome[]> => {
      const name = sessionName(cs);
      const outcomes: BlockOutcome[] = [];

      const eventsByRotation = new Map(
        cs.sessionEvents.map((e) => [e.rotation, e])
      );

      // A rotation dropped from the session since the last finalize leaves an
      // event for a block that no longer happens. Remove it before sending, so
      // nobody is holding an invite to a block that isn't running.
      const live = new Set(cs.rotations);
      for (const stale of cs.sessionEvents.filter((e) => !live.has(e.rotation))) {
        const client = stale.ownerId ? await clientFor(stale.ownerId) : null;
        if (client) {
          await deleteEvent(client, stale.googleEventId, "all").catch((err) =>
            console.error(
              `Failed to withdraw the ${rotationName(stale.rotation)} event for session ${cs.id} ("${name}") after that rotation was removed:`,
              err
            )
          );
        }
        await prisma.sessionCalendarEvent
          .delete({ where: { id: stale.id } })
          .catch((err) =>
            console.error(
              `Failed to drop the stale ${rotationName(stale.rotation)} event row for session ${cs.id}:`,
              err
            )
          );
      }

      const studentEmails = cs.signups
        .map((s) => s.student.email)
        .filter((email): email is string => Boolean(email));

      const location = resolveRoomName(cs);

      for (const rotation of cs.rotations) {
        const label = `${name} — ${rotationName(rotation)}`;
        const block: BlockRef = { sessionId: cs.id, rotation, label };

        try {
          // Who is in this room, this block. Absences and the admin's explicit
          // clears are already subtracted here, which is what keeps a teacher
          // covering Flex 1 and Flex 3 off the Flex 2 invite.
          const { primaryTeacherId, secondaryTeacherId } = resolveSessionCoverage(
            sessionRef(cs),
            cs.rotationCoverage,
            rotation,
            cs.teacherAbsences
          );

          // T1 sends it. Coverage is the source of truth for who is actually
          // running the block — not the club's owner, who may not be there.
          const organizerId = primaryTeacherId;
          const organizerClient = organizerId
            ? await clientFor(organizerId)
            : null;

          let sender: Sender | null = organizerClient
            ? { client: organizerClient, userId: organizerId! }
            : null;
          let fellBackFrom: SentOutcome["fellBackFrom"] = null;

          if (!sender) {
            const backstop = await getBackstop();
            if (!backstop) {
              outcomes.push({
                ...block,
                kind: "skipped",
                teacherName: organizerId
                  ? (teacherNameById.get(organizerId) ?? null)
                  : null,
                // Always "no-calendar" for a session, never "unstaffed": a
                // session with nobody assigned still falls back to an admin, so
                // reaching here means no calendar could be found at all.
                reason: "no-calendar",
              });
              continue;
            }
            sender = backstop;
            fellBackFrom = {
              teacherName: organizerId
                ? (teacherNameById.get(organizerId) ?? null)
                : null,
            };
          }

          const blockTeacherIds = [primaryTeacherId, secondaryTeacherId].filter(
            (id): id is string => id !== null
          );

          // Everyone else on this block, plus every student signed up for the
          // session. The sender is excluded because Google adds the calendar's
          // owner as organizer itself and listing them again produces a
          // self-invite — note this excludes whoever is *actually* sending, so a
          // T1 whose block fell back to an admin is still invited as a guest.
          const attendeeEmails = [
            ...new Set([
              ...blockTeacherIds
                .filter((id) => id !== sender!.userId)
                .map((id) => teacherEmailById.get(id))
                .filter((email): email is string => Boolean(email)),
              ...studentEmails,
            ]),
          ];

          const teacherNames = [
            ...new Set(
              blockTeacherIds
                .map((id) => teacherNameById.get(id))
                .filter((n): n is string => Boolean(n))
            ),
          ];

          // Composed once and used by both branches, so a first send and a
          // re-finalize produce byte-identical text.
          const summary = sessionEventTitle({ name, roomName: location, rotation });
          const description = sessionEventDescription({
            roomName: location,
            rotation,
            teacherNames,
          });

          const existing = eventsByRotation.get(rotation);
          const sameSender =
            existing !== undefined && existing.ownerId === sender.userId;

          let patched = false;
          if (sameSender) {
            // Same sender as last time — bring the event back in line with the
            // database, room and all, not just its attendees.
            try {
              await syncEvent({
                calendar: sender.client,
                eventId: existing!.googleEventId,
                summary,
                description,
                location,
                flexDayDate: flexDay.date,
                rotation,
                attendeeEmails,
              });
              patched = true;
            } catch (err) {
              // The organizer deleted the event from their own calendar, which
              // they can do — they own it. Fall through and issue a fresh one
              // rather than failing this block on every future re-finalize,
              // which is the documented way to recover from exactly that.
              if (!isMissingEvent(err)) throw err;
              console.error(
                `The ${label} event no longer exists on its organizer's calendar; issuing a replacement.`
              );
            }
          }

          if (!patched) {
            // No event yet, coverage has changed hands, or the old event is
            // gone. Google cannot move an event between calendars, so a changed
            // sender means withdrawing the old invite and issuing a new one from
            // the teacher now covering the block.
            if (existing && !sameSender) {
              const previous = existing.ownerId
                ? await clientFor(existing.ownerId)
                : null;
              if (previous) {
                await deleteEvent(previous, existing.googleEventId, "all").catch(
                  (err) =>
                    console.error(
                      `Failed to withdraw the previous ${label} event after coverage changed — it may linger on the old teacher's calendar:`,
                      err
                    )
                );
              } else {
                console.error(
                  `Cannot withdraw the previous ${label} event: its owner is no longer able to send. It may linger on their calendar.`
                );
              }
            }

            const eventId = await createEvent({
              calendar: sender.client,
              summary,
              description,
              location,
              flexDayDate: flexDay.date,
              rotation,
              attendeeEmails,
              sendUpdates: "all",
            });

            await prisma.sessionCalendarEvent.upsert({
              where: { sessionId_rotation: { sessionId: cs.id, rotation } },
              create: {
                sessionId: cs.id,
                rotation,
                googleEventId: eventId,
                ownerId: sender.userId,
              },
              update: { googleEventId: eventId, ownerId: sender.userId },
            });
          }

          outcomes.push({ ...block, kind: "sent", fellBackFrom });
        } catch (error) {
          outcomes.push({ ...block, kind: "failed", error });
        }
      }

      return outcomes;
    })
  );

  // The day's duty posts, after its sessions: sharing the client cache means a
  // teacher who runs a club in Flex 1 and stands the cafeteria in Flex 2 has
  // their token refreshed once for both.
  const dutyBlocks = await sendDutyInvites({
    flexDayId,
    clientFor,
    getBackstop,
  });

  const blocks: BlockOutcome[] = [...settled.flat(), ...dutyBlocks];
  const sent = blocks.filter(isSent);
  const failed = blocks.filter(isFailed);
  const skipped = blocks.filter(isSkipped);

  for (const f of failed) {
    console.error(`Failed to send calendar invites for ${f.label}:`, f.error);
  }
  for (const s of skipped) {
    console.error(
      `Skipped ${s.label} during finalize: ${
        s.reason === "unstaffed"
          ? "nobody is assigned to cover it"
          : `${
              s.teacherName
                ? `${s.teacherName} has not connected a Google Calendar`
                : "nobody is assigned to cover it"
            }, and no admin has connected one either`
      }.`
    );
  }

  // If nothing at all went out, finalizing would be a lie — the button would go
  // green while every student received nothing. Refuse, and say why. This also
  // covers the case where every block was *skipped* rather than failed.
  //
  // "Had something to send" is sessions *or* duty blocks: a day made only of
  // duty posts has no clubSessions to compare against, and checking sessions
  // alone would let it finalize green having sent nobody anything. A session
  // carrying no rotations produces no blocks, which is why the session side is
  // still counted from the table rather than from `blocks`.
  const hadSomethingToSend =
    flexDay.clubSessions.length > 0 || dutyBlocks.length > 0;
  if (hadSomethingToSend && sent.length === 0) {
    return NextResponse.json(
      {
        error:
          "No calendar invites could be sent, so the flex day has not been finalized. Check the details below and try again.",
        sessionsSent: 0,
        sessionsFailed: failed.length,
        sessionsSkipped: skipped.length,
        problems: describeProblems(blocks),
      },
      { status: 500 }
    );
  }

  await prisma.flexDay.update({
    where: { id: flexDayId },
    data: { isFinalized: true },
  });

  return NextResponse.json({
    finalized: true,
    sessionsSent: sent.length,
    sessionsFailed: failed.length,
    sessionsSkipped: skipped.length,
    problems: describeProblems(blocks),
  });
}
