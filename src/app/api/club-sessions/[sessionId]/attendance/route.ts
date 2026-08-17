import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { bulkAttendanceSchema } from "@/lib/validations";
import { getSchoolWeekWindow } from "@/lib/flex-day-utils";
import { canRecordAttendance } from "@/lib/auth-helpers";
import { resolveSessionTeacherIds } from "@/lib/coverage";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  const body = await req.json();
  const parsed = bulkAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: {
      rotations: true,
      flexDay: { select: { date: true } },
      club: { select: { ownerId: true, cosponsorId: true } },
      oneOffOwnerId: true,
      rotationCoverage: {
        select: {
          rotation: true,
          primaryTeacherId: true,
          secondaryTeacherId: true,
        },
      },
      teacherAbsences: { select: { teacherId: true, rotation: true } },
    },
  });

  if (!clubSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Whoever is actually in the room takes the register. A substitute assigned to
  // cover a club they don't own previously couldn't record attendance for the
  // session they were covering — and for a club with no owner, the assigned
  // coverage teacher is the only person who can.
  const coverageTeacherIds = resolveSessionTeacherIds(
    clubSession.club,
    clubSession.rotationCoverage,
    clubSession.rotations,
    clubSession.teacherAbsences
  );
  if (
    !canRecordAttendance(
      clubSession,
      coverageTeacherIds,
      session.user.id,
      session.user.role
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Allow attendance recording any time during the week of the session (Mon–Sun)
  const { weekStart, weekEnd } = getSchoolWeekWindow(clubSession.flexDay.date);
  const now = new Date();
  if (now < weekStart || now > weekEnd) {
    return NextResponse.json(
      { error: "Attendance can only be recorded during the week of the session" },
      { status: 403 }
    );
  }

  const { records } = parsed.data;

  await prisma.$transaction(
    records.map((r) =>
      prisma.signup.updateMany({
        where: { id: r.signupId, clubSessionId: sessionId },
        data: { attended: r.attended },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
