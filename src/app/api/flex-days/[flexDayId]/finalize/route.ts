import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { syncEventAttendees } from "@/lib/google-calendar";

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
              googleCalendarId: true,
              owner: { select: { email: true } },
            },
          },
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

  // Sync attendees for every session that has a Google Calendar event
  const syncableSessions = flexDay.clubSessions.filter(
    (cs) => cs.club?.googleCalendarId && cs.googleEventId
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

      return syncEventAttendees({
        calendarId: cs.club!.googleCalendarId!,
        eventId: cs.googleEventId!,
        attendeeEmails: [
          ...coverageEmails,
          ...cs.signups
            .map((s) => s.student.email)
            .filter((email): email is string => Boolean(email)),
        ],
      });
    })
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    failures.forEach((f, i) =>
      console.error(
        `Failed to sync attendees for session ${syncableSessions[i].id}:`,
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
          "All Google Calendar syncs failed — no invites were sent. The flex day has not been finalized. Check the server logs and try again.",
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
