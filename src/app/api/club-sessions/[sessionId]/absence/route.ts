import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { sessionAbsenceSchema } from "@/lib/validations";

/**
 * POST /api/club-sessions/[sessionId]/absence
 *
 * Record that a teacher will not be attending a session, or undo that.
 *
 * A teacher may only act on their own behalf; an admin may act for anyone. This
 * replaces the old `ClubSession.teacherAbsent` boolean, which couldn't say which
 * teacher was out — unusable once a session can have an owner, a cosponsor, and
 * per-rotation coverage.
 *
 * Marking an absence never cancels the session. The club still runs; the rotation
 * simply resolves to no teacher, which the admin Coverage page surfaces as needing
 * cover. That is the point: a teacher who is double-booked steps back from one
 * room without the club disappearing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = sessionAbsenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { teacherId: requestedTeacherId, rotations, absent, reason } = parsed.data;

  // Only admins may mark someone else absent. A teacher marking a colleague out
  // would be making a staffing decision on their behalf.
  if (
    requestedTeacherId &&
    requestedTeacherId !== session.user.id &&
    session.user.role !== "ADMIN"
  ) {
    return NextResponse.json(
      { error: "Only an admin can change another teacher's attendance." },
      { status: 403 }
    );
  }
  const teacherId = requestedTeacherId ?? session.user.id;

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true, rotations: true },
  });
  if (!clubSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Default to the whole session. Restrict to rotations the session actually
  // covers, so a stale client can't write absences for a rotation that no longer
  // applies.
  const targetRotations = (rotations ?? clubSession.rotations).filter((r) =>
    clubSession.rotations.includes(r)
  );
  if (targetRotations.length === 0) {
    return NextResponse.json(
      { error: "None of those rotations belong to this session." },
      { status: 400 }
    );
  }

  if (absent) {
    await prisma.$transaction(
      targetRotations.map((rotation) =>
        prisma.sessionTeacherAbsence.upsert({
          where: {
            sessionId_teacherId_rotation: { sessionId, teacherId, rotation },
          },
          create: { sessionId, teacherId, rotation, reason },
          update: { reason },
        })
      )
    );
  } else {
    await prisma.sessionTeacherAbsence.deleteMany({
      where: { sessionId, teacherId, rotation: { in: targetRotations } },
    });
  }

  return NextResponse.json({
    ok: true,
    absent,
    teacherId,
    rotations: targetRotations,
  });
}
