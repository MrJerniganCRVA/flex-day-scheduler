import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { flexAbsenceSchema } from "@/lib/validations";
import { ALL_ROTATIONS } from "@/types";

/**
 * POST /api/flex-days/[flexDayId]/absences
 *
 * Mark a teacher out for some or all of a Flex Day's blocks, or undo it.
 *
 * Person-level, unlike /api/club-sessions/[sessionId]/absence, which says "not
 * at this club". Someone out sick or in a meeting is missing from everything
 * they were expected at in that block — every club slot and duty post — and
 * src/lib/coverage.ts subtracts them from all of it.
 *
 * Same permission rule as the session route: a teacher acts for themselves; only
 * an admin may mark someone else out. Never touches coverage or duty rows, so
 * lifting an absence puts the teacher back everywhere they were.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = flexAbsenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { teacherId: requestedTeacherId, rotations, absent } = parsed.data;

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

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true },
  });
  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  if (requestedTeacherId && requestedTeacherId !== session.user.id) {
    // An admin can only mark staff out — a student has no coverage to vacate.
    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { role: true },
    });
    if (!teacher || teacher.role === "STUDENT") {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
    }
  }

  // Omitted means the whole day.
  const targetRotations = [...new Set(rotations ?? ALL_ROTATIONS)];

  if (absent) {
    await prisma.$transaction(
      targetRotations.map((rotation) =>
        prisma.teacherFlexAbsence.upsert({
          where: {
            flexDayId_teacherId_rotation: { flexDayId, teacherId, rotation },
          },
          create: { flexDayId, teacherId, rotation },
          update: {},
        })
      )
    );
  } else {
    await prisma.teacherFlexAbsence.deleteMany({
      where: { flexDayId, teacherId, rotation: { in: targetRotations } },
    });
  }

  return NextResponse.json({
    ok: true,
    absent,
    teacherId,
    rotations: targetRotations,
  });
}
