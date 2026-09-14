import { NextRequest, NextResponse } from "next/server";
import { calendar_v3 } from "googleapis";
import { RotationSlot } from "@prisma/client";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import {
  createEventForSession,
  deleteEvent,
  syncEventForSession,
} from "@/lib/google-calendar";
import { getCalendarClientForUser } from "@/lib/google-oauth";
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
 */

/** One rotation of one session — what an invite actually covers. */
type BlockRef = {
  sessionId: string;
  rotation: RotationSlot;
  /** "Art Club — Flex 2", for the admin-facing report. */
  label: string;
};

/**
 * The block's invite went out. `fellBackFrom` is set when it was sent from an
 * admin because the assigned teacher could not send it themselves: `teacherName`
 * names them, or is null when nobody was assigned to the block at all.
 */
type SentOutcome = BlockRef & {
  kind: "sent";
  fellBackFrom: { teacherName: string | null } | null;
};

/** Google rejected the request. */
type FailedOutcome = BlockRef & { kind: "failed"; error: unknown };

/** Nobody could send it — not the assigned teacher, and not any admin. */
type SkippedOutcome = BlockRef & {
  kind: "skipped";
  teacherName: string | null;
};

type BlockOutcome = SentOutcome | FailedOutcome | SkippedOutcome;

const isSent = (o: BlockOutcome): o is SentOutcome => o.kind === "sent";
const isFailed = (o: BlockOutcome): o is FailedOutcome => o.kind === "failed";
const isSkipped = (o: BlockOutcome): o is SkippedOutcome => o.kind === "skipped";

/** A calendar client with the id of whose calendar it writes to. */
type Sender = { client: calendar_v3.Calendar; userId: string };

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

  // One client per teacher, however many blocks they cover. Memoized on the
  // promise rather than the result so concurrent blocks share one token refresh
  // instead of racing to perform their own.
  const clientCache = new Map<string, Promise<calendar_v3.Calendar | null>>();
  const clientFor = (userId: string): Promise<calendar_v3.Calendar | null> => {
    let pending = clientCache.get(userId);
    if (!pending) {
      pending = getCalendarClientForUser(userId);
      clientCache.set(userId, pending);
    }
    return pending;
  };

  /**
   * The admin whose calendar covers blocks their assigned teacher cannot send
   * from. Prefers whoever pressed Finalize — they are present, and the resulting
   * invite comes from a person the school can ask about it — and otherwise any
   * admin who has connected. Null when no admin has connected either.
   */
  let backstopPromise: Promise<Sender | null> | null = null;
  const getBackstop = (): Promise<Sender | null> => {
    backstopPromise ??= (async () => {
      const own = await clientFor(actorId);
      if (own) return { client: own, userId: actorId };

      const admins = await prisma.user.findMany({
        where: {
          role: "ADMIN",
          id: { not: actorId },
          calendarGrant: { is: { revokedAt: null } },
        },
        select: { id: true },
      });
      for (const admin of admins) {
        const client = await clientFor(admin.id);
        if (client) return { client, userId: admin.id };
      }
      return null;
    })();
    return backstopPromise;
  };

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
              await syncEventForSession({
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

            const eventId = await createEventForSession({
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

  const blocks = settled.flat();
  const sent = blocks.filter(isSent);
  const failed = blocks.filter(isFailed);
  const skipped = blocks.filter(isSkipped);

  for (const f of failed) {
    console.error(`Failed to send calendar invites for ${f.label}:`, f.error);
  }
  for (const s of skipped) {
    console.error(
      `Skipped ${s.label} during finalize: ${
        s.teacherName
          ? `${s.teacherName} has not connected a Google Calendar`
          : "nobody is assigned to cover it"
      }, and no admin has connected one either.`
    );
  }

  // If nothing at all went out, finalizing would be a lie — the button would go
  // green while every student received nothing. Refuse, and say why. This also
  // covers the case where every block was *skipped* rather than failed.
  // Compared against sessions, not blocks: a day that has sessions but produced
  // no blocks at all (every session somehow carrying no rotations) sent nobody
  // anything, and marking it green would be the same lie.
  if (flexDay.clubSessions.length > 0 && sent.length === 0) {
    return NextResponse.json(
      {
        error:
          "No calendar invites could be sent, so the flex day has not been finalized. Check the details below and try again.",
        sessionsSent: 0,
        sessionsFailed: failed.length,
        sessionsSkipped: skipped.length,
        problems: describeProblems(failed, skipped, sent),
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
    problems: describeProblems(failed, skipped, sent),
  });
}

/**
 * Whether Google is saying the event we tried to patch is not there.
 *
 * 404 for an event that never existed or was hard-deleted, 410 for one Google
 * still remembers as cancelled. Both mean the same thing to the caller: stop
 * patching and issue a new one.
 */
function isMissingEvent(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    code?: number | string;
    status?: number;
    response?: { status?: number };
  };
  const status =
    err.response?.status ??
    err.status ??
    (typeof err.code === "number" ? err.code : Number(err.code));
  return status === 404 || status === 410;
}

/**
 * Google's own explanation of a rejection.
 *
 * Worth digging for: every failure used to be reported to the admin as
 * "Google Calendar rejected the request", which is how a whole day of invites
 * failing on one fixable cause — a service account that was never allowed to
 * invite anybody — could only be diagnosed by reading server logs.
 */
function googleErrorReason(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const err = error as {
    errors?: { message?: string; reason?: string }[];
    response?: { data?: { error?: { message?: string } | string } };
    message?: string;
  };

  const first = Array.isArray(err.errors) ? err.errors[0] : undefined;
  const nested = err.response?.data?.error;
  const nestedMessage = typeof nested === "string" ? nested : nested?.message;

  const reason =
    first?.message ?? first?.reason ?? nestedMessage ?? err.message ?? null;
  return reason ? reason.trim().replace(/\.$/, "") : null;
}

/** Admin-readable one-liners for anything an admin should act on. */
function describeProblems(
  failed: FailedOutcome[],
  skipped: SkippedOutcome[],
  sent: SentOutcome[]
): string[] {
  const problems: string[] = [];

  for (const f of failed) {
    const reason = googleErrorReason(f.error);
    problems.push(
      reason
        ? `${f.label}: Google Calendar rejected the request — ${reason}.`
        : `${f.label}: Google Calendar rejected the request.`
    );
  }

  for (const s of skipped) {
    problems.push(
      s.teacherName
        ? `${s.label}: ${s.teacherName} has not connected their Google Calendar and no admin has either, so no invites were sent. Ask them to open the app and connect it, then re-send.`
        : `${s.label}: nobody is assigned to cover this block and no admin has connected a Google Calendar, so no invites were sent.`
    );
  }

  // Sent, but not by the person who should have sent it. Not a failure — the
  // students have their invite — so it is reported after the real problems.
  for (const s of sent.filter((o) => o.fellBackFrom !== null)) {
    problems.push(
      s.fellBackFrom!.teacherName
        ? `${s.label}: ${s.fellBackFrom!.teacherName} has not connected their Google Calendar, so the invite was sent from an admin instead.`
        : `${s.label}: nobody is assigned to cover this block, so the invite was sent from an admin instead.`
    );
  }

  return problems;
}
