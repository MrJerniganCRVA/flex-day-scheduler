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
    (cs) => cs.club.googleCalendarId && cs.googleEventId
  );

  const results = await Promise.allSettled(
    syncableSessions.map((cs) =>
      syncEventAttendees({
        calendarId: cs.club.googleCalendarId!,
        eventId: cs.googleEventId!,
        attendeeEmails: [
          cs.club.owner.email,
          ...cs.signups
            .map((s) => s.student.email)
            .filter((email): email is string => Boolean(email)),
        ],
      })
    )
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
