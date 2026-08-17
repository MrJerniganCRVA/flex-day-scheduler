import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import {
  createEventForSession,
  getOrCreateOneOffCalendarId,
  shareCalendarWithTeacher,
  syncEventAttendees,
} from "@/lib/google-calendar";
import { resolveSessionTeacherIds } from "@/lib/coverage";

/** Why a session could not be synced, for the admin-facing report. */
type SkipReason = "club-calendar-missing" | "one-off-calendar-unavailable";

type SentOutcome = { kind: "sent"; sessionId: string; name: string };
type FailedOutcome = {
  kind: "failed";
  sessionId: string;
  name: string;
  error: unknown;
};
type SkippedOutcome = {
  kind: "skipped";
  sessionId: string;
  name: string;
  reason: SkipReason;
};
type SessionOutcome = SentOutcome | FailedOutcome | SkippedOutcome;

const isSent = (o: SessionOutcome): o is SentOutcome => o.kind === "sent";
const isFailed = (o: SessionOutcome): o is FailedOutcome => o.kind === "failed";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
              googleCalendarId: true,
              calendarSharedAt: true,
              ownerId: true,
              cosponsorId: true,
              owner: { select: { email: true } },
              cosponsor: { select: { email: true } },
              defaultRoom: { select: { name: true } },
            },
          },
          oneOffOwner: { select: { id: true, email: true } },
          roomOverride: { select: { name: true } },
          rotationCoverage: {
            select: {
              rotation: true,
              primaryTeacherId: true,
              secondaryTeacherId: true,
              secondaryCleared: true,
            },
          },
          // A teacher who has stepped back from this session must not be invited
          // to it, even when they are the club's owner and therefore the implicit
          // default.
          teacherAbsences: {
            select: { teacherId: true, rotation: true },
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

  // One-off sessions have no club calendar. Provision the shared host calendar
  // once, only if this flex day actually contains a one-off. A failure here is
  // not fatal to the whole finalize — those sessions get reported as skipped.
  const hasOneOff = flexDay.clubSessions.some((cs) => cs.clubId === null);
  let oneOffCalendarId: string | null = null;
  if (hasOneOff) {
    try {
      oneOffCalendarId = await getOrCreateOneOffCalendarId();
    } catch (err) {
      console.error(
        "Failed to provision the one-off host calendar — one-off sessions will be reported as skipped:",
        err
      );
    }
  }

  /** The calendar a session's event belongs on, or null if none is available. */
  const calendarIdFor = (cs: (typeof flexDay.clubSessions)[number]) =>
    cs.clubId === null ? oneOffCalendarId : (cs.club?.googleCalendarId ?? null);

  // Teacher emails by id, for turning resolved coverage into attendees.
  const teacherEmailById = new Map<string, string>();
  for (const cs of flexDay.clubSessions) {
    if (cs.club?.ownerId && cs.club.owner?.email) {
      teacherEmailById.set(cs.club.ownerId, cs.club.owner.email);
    }
    if (cs.club?.cosponsorId && cs.club.cosponsor?.email) {
      teacherEmailById.set(cs.club.cosponsorId, cs.club.cosponsor.email);
    }
    if (cs.oneOffOwner?.id && cs.oneOffOwner.email) {
      teacherEmailById.set(cs.oneOffOwner.id, cs.oneOffOwner.email);
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
      select: { id: true, email: true },
    });
    for (const u of extra) teacherEmailById.set(u.id, u.email);
  }

  const syncable = flexDay.clubSessions.filter((cs) => calendarIdFor(cs) !== null);
  const skipped: SkippedOutcome[] = flexDay.clubSessions
    .filter((cs) => calendarIdFor(cs) === null)
    .map((cs) => ({
      kind: "skipped",
      sessionId: cs.id,
      name: sessionName(cs),
      reason:
        cs.clubId === null
          ? "one-off-calendar-unavailable"
          : "club-calendar-missing",
    }));

  // Share each involved club's calendar with its owning teacher exactly once,
  // the first time any of its sessions is finalized. Treat an "already shared"
  // API error as a non-fatal no-op (covers clubs shared under old behavior).
  //
  // A club may have no owner at all — nobody to share with — in which case the
  // share is skipped and `calendarSharedAt` is deliberately left null, so that
  // if the club later gains an owner they still get access. Stamping it
  // unconditionally would mark the club "shared" forever without anyone ever
  // having been granted anything.
  const clubsToShare = new Map<string, { calendarId: string; ownerEmail: string }>();
  for (const cs of syncable) {
    if (
      cs.club &&
      cs.club.calendarSharedAt === null &&
      cs.club.owner?.email &&
      !clubsToShare.has(cs.club.id)
    ) {
      clubsToShare.set(cs.club.id, {
        calendarId: cs.club.googleCalendarId!,
        ownerEmail: cs.club.owner.email,
      });
    }
  }
  await Promise.all(
    [...clubsToShare.entries()].map(async ([clubId, { calendarId, ownerEmail }]) => {
      try {
        await shareCalendarWithTeacher(calendarId, ownerEmail);
      } catch (err) {
        console.error(
          `Failed to share calendar for club ${clubId} (continuing — may already be shared):`,
          err
        );
      }
      await prisma.club
        .update({ where: { id: clubId }, data: { calendarSharedAt: new Date() } })
        .catch((err) =>
          console.error(`Failed to persist calendarSharedAt for club ${clubId}:`, err)
        );
    })
  );

  // Settle each session independently, but keep each result paired with the
  // session it came from — indexing a filtered array by position (the previous
  // approach) attributes failures to the wrong session in the logs.
  const settled = await Promise.all(
    syncable.map(async (cs): Promise<SessionOutcome> => {
      const name = sessionName(cs);
      try {
        const calendarId = calendarIdFor(cs)!;

        // Teachers expected in the room: explicit coverage, else the club's
        // owner/cosponsor. One-off sessions fall back to their creator.
        const teacherIds = resolveSessionTeacherIds(
          cs.club,
          cs.rotationCoverage,
          cs.rotations,
          cs.teacherAbsences
        );
        const teacherEmails = new Set<string>();
        for (const id of teacherIds) {
          const email = teacherEmailById.get(id);
          if (email) teacherEmails.add(email);
        }
        if (cs.clubId === null && cs.oneOffOwner?.email) {
          teacherEmails.add(cs.oneOffOwner.email);
        }

        const attendeeEmails = [
          ...teacherEmails,
          ...cs.signups
            .map((s) => s.student.email)
            .filter((email): email is string => Boolean(email)),
        ];

        if (cs.googleEventId) {
          // Already has an event (e.g. re-finalize after unfinalize) — sync
          // the attendee list on it.
          await syncEventAttendees({
            calendarId,
            eventId: cs.googleEventId,
            attendeeEmails,
          });
        } else {
          // No event yet — create it now, with attendees baked in, so the
          // invite goes out the moment the event is created.
          const location = cs.roomOverride?.name ?? cs.club?.defaultRoom?.name ?? null;
          const eventId = await createEventForSession({
            calendarId,
            title: name,
            location,
            flexDayDate: flexDay.date,
            rotations: cs.rotations,
            attendeeEmails,
            sendUpdates: "all",
          });
          await prisma.clubSession.update({
            where: { id: cs.id },
            data: { googleEventId: eventId },
          });
        }

        return { kind: "sent", sessionId: cs.id, name };
      } catch (error) {
        return { kind: "failed", sessionId: cs.id, name, error };
      }
    })
  );

  const sent = settled.filter(isSent);
  const failed = settled.filter(isFailed);

  for (const f of failed) {
    console.error(
      `Failed to send calendar invites for session ${f.sessionId} ("${f.name}"):`,
      f.error
    );
  }
  for (const s of skipped) {
    console.error(
      `Skipped session ${s.sessionId} ("${s.name}") during finalize: ${s.reason}`
    );
  }

  // If nothing at all went out, finalizing would be a lie — the button would go
  // green while every student received nothing. Refuse, and say why. This also
  // covers the case where every session was *skipped* rather than failed, which
  // the previous guard missed because it only compared failures against the
  // already-filtered syncable list.
  if (flexDay.clubSessions.length > 0 && sent.length === 0) {
    return NextResponse.json(
      {
        error:
          "No calendar invites could be sent, so the flex day has not been finalized. Check the details below and try again.",
        sessionsSent: 0,
        sessionsFailed: failed.length,
        sessionsSkipped: skipped.length,
        problems: describeProblems(failed, skipped),
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
    problems: describeProblems(failed, skipped),
  });
}

/** Admin-readable one-liners for anything that didn't get an invite. */
function describeProblems(
  failed: FailedOutcome[],
  skipped: SkippedOutcome[]
): string[] {
  const problems: string[] = [];
  for (const f of failed) {
    problems.push(`${f.name}: Google Calendar rejected the request.`);
  }
  for (const s of skipped) {
    problems.push(
      s.reason === "club-calendar-missing"
        ? `${s.name}: this club has no Google Calendar yet, so no invites were sent. Use "Retry calendar setup" on the club, then re-send.`
        : `${s.name}: the shared calendar for one-off sessions could not be reached, so no invites were sent.`
    );
  }
  return problems;
}
