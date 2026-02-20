import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { removeAttendeeFromEvent } from "@/lib/google-calendar";
import { isPastSignupDeadline } from "@/lib/flex-day-utils";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ signupId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { signupId } = await params;

  const signup = await prisma.signup.findUnique({
    where: { id: signupId },
    include: {
      clubSession: {
        include: {
          club: { select: { googleCalendarId: true } },
          flexDay: { select: { date: true } },
        },
      },
      student: { select: { email: true } },
    },
  });

  if (!signup) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only the student or an admin can cancel
  if (
    session.user.role !== "ADMIN" &&
    signup.studentId !== session.user.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Enforce deadline for students (admins can override)
  if (
    session.user.role !== "ADMIN" &&
    isPastSignupDeadline(signup.clubSession.flexDay.date)
  ) {
    return NextResponse.json(
      { error: "Signups for this flex day are closed" },
      { status: 403 }
    );
  }

  await prisma.signup.delete({ where: { id: signupId } });

  // Remove from Google Calendar (non-blocking)
  const { googleCalendarId } = signup.clubSession.club;
  const { googleEventId } = signup.clubSession;
  if (googleCalendarId && googleEventId && signup.student.email) {
    removeAttendeeFromEvent({
      calendarId: googleCalendarId,
      eventId: googleEventId,
      studentEmail: signup.student.email,
    }).catch((err) =>
      console.error("Failed to remove attendee from Google Calendar:", err)
    );
  }

  return new NextResponse(null, { status: 204 });
}
