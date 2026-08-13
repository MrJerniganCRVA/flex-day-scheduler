import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createEventForSession, shareCalendarWithTeacher, syncEventAttendees } from "@/lib/google-calendar";

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
              owner: { select: { email: true } },
              defaultRoom: { select: { name: true } },
            },
          },
          roomOverride: { select: { name: true } },
          rotationCoverage: {
            include: {
              primaryTeacher: { select: { email: true } },
              secondaryTeacher: { select: { email: true } },
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

  // No Google Calendar event exists, and a club's calendar is never shared
  // with its teacher, until the flex day containing it is finalized here —
  // this is the moment invites actually go out.
  const syncableSessions = flexDay.clubSessions.filter((cs) => cs.club?.googleCalendarId);

  // Share each involved club's calendar with its teacher exactly once, the
  // first time any of its sessions is finalized. Treat an "already shared"
  // API error as a non-fatal no-op (covers clubs shared under old behavior).
  const clubsToShare = new Map<string, { calendarId: string; ownerEmail: string | null }>();
  for (const cs of syncableSessions) {
    if (cs.club && cs.club.calendarSharedAt === null && !clubsToShare.has(cs.club.id)) {
      clubsToShare.set(cs.club.id, {
        calendarId: cs.club.googleCalendarId!,
        ownerEmail: cs.club.owner.email,
      });
    }
  }
  await Promise.all(
    [...clubsToShare.entries()].map(async ([clubId, { calendarId, ownerEmail }]) => {
      if (ownerEmail) {
        try {
          await shareCalendarWithTeacher(calendarId, ownerEmail);
        } catch (err) {
          console.error(
            `Failed to share calendar for club ${clubId} (continuing — may already be shared):`,
            err
          );
        }
      }
      await prisma.club
        .update({ where: { id: clubId }, data: { calendarSharedAt: new Date() } })
        .catch((err) =>
          console.error(`Failed to persist calendarSharedAt for club ${clubId}:`, err)
        );
    })
  );

  const results = await Promise.allSettled(
    syncableSessions.map((cs) => {
      // Collect unique teacher emails across all rotation coverage records.
      // Fall back to the club owner if no coverage was explicitly assigned.
      const coverageEmails = new Set<string>();
      for (const rc of cs.rotationCoverage) {
        const primaryEmail =
          rc.primaryTeacher?.email ?? cs.club?.owner.email;
        if (primaryEmail) coverageEmails.add(primaryEmail);
        if (rc.secondaryTeacher?.email) {
          coverageEmails.add(rc.secondaryTeacher.email);
        }
      }
      if (coverageEmails.size === 0) {
        // No coverage records at all — owner handles the session
        if (cs.club?.owner.email) coverageEmails.add(cs.club.owner.email);
      }

      const attendeeEmails = [
        ...coverageEmails,
        ...cs.signups
          .map((s) => s.student.email)
          .filter((email): email is string => Boolean(email)),
      ];

      if (cs.googleEventId) {
        // Already has an event (e.g. re-finalize after unfinalize) — sync
        // the attendee list on it.
        return syncEventAttendees({
          calendarId: cs.club!.googleCalendarId!,
          eventId: cs.googleEventId,
          attendeeEmails,
        });
      }

      // No event yet — create it now, with attendees baked in, so the
      // invite goes out the moment the event is created.
      const location = cs.roomOverride?.name ?? cs.club?.defaultRoom?.name ?? null;
      return createEventForSession({
        calendarId: cs.club!.googleCalendarId!,
        clubName: cs.club!.name,
        location,
        flexDayDate: flexDay.date,
        rotations: cs.rotations,
        attendeeEmails,
        sendUpdates: "all",
      }).then((eventId) =>
        prisma.clubSession.update({
          where: { id: cs.id },
          data: { googleEventId: eventId },
        })
      );
    })
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    failures.forEach((f, i) =>
      console.error(
        `Failed to send calendar invite for session ${syncableSessions[i].id}:`,
        (f as PromiseRejectedResult).reason
      )
    );
  }

  // If every syncable session failed, the calendar invites weren't sent at all.
  // Refuse to mark as finalized so the admin can retry after fixing the issue.
  if (syncableSessions.length > 0 && failures.length === syncableSessions.length) {
    return NextResponse.json(
      {
        error:
          "All Google Calendar invites failed to send. The flex day has not been finalized. Check the server logs and try again.",
        sessionsFailed: failures.length,
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
    sessionsUpdated: results.filter((r) => r.status === "fulfilled").length,
    sessionsFailed: failures.length,
  });
}
