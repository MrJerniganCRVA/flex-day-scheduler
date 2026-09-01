import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { dutyAssignmentSchema } from "@/lib/validations";

/**
 * Staff one rotation of one duty post on one Flex Day.
 *
 * `PUT` rather than `PATCH`: the body always states the whole assignment, and it
 * upserts on the post+day+rotation key, so sending it twice is the same as
 * sending it once.
 *
 * Much simpler than the club coverage route it sits beside, because a duty post
 * has no owner or cosponsor to fall back to. `teacherId: null` unambiguously
 * means unstaffed — there is no fallback to suppress, so none of the "cleared"
 * machinery that T1/T2 need applies here.
 *
 * ADMIN only, checked here rather than left to middleware: `src/proxy.ts` gates
 * pages under /admin by role but an /api path does not match that check.
 */
export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = dutyAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { dutyPostId, flexDayId, rotation, teacherId } = parsed.data;

  const [dutyPost, flexDay] = await Promise.all([
    prisma.dutyPost.findUnique({
      where: { id: dutyPostId },
      select: { id: true, requiredRotations: true },
    }),
    prisma.flexDay.findUnique({ where: { id: flexDayId }, select: { id: true } }),
  ]);
  if (!dutyPost) {
    return NextResponse.json({ error: "Duty post not found" }, { status: 404 });
  }
  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  // Staffing a rotation the post does not need would create a slot the Coverage
  // page never renders, so the assignment would exist and be invisible.
  if (!dutyPost.requiredRotations.includes(rotation)) {
    return NextResponse.json(
      {
        error:
          "This duty post is not staffed in that rotation. Change its required rotations first.",
      },
      { status: 400 }
    );
  }

  // Same rule as club coverage: a student can never be put in the room.
  if (teacherId !== null) {
    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { role: true },
    });
    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
    }
    if (teacher.role === "STUDENT") {
      return NextResponse.json(
        { error: "A duty post must be covered by a teacher or admin" },
        { status: 400 }
      );
    }
  }

  const assignment = await prisma.dutyAssignment.upsert({
    where: {
      dutyPostId_flexDayId_rotation: { dutyPostId, flexDayId, rotation },
    },
    create: { dutyPostId, flexDayId, rotation, teacherId },
    update: { teacherId },
  });

  return NextResponse.json(assignment);
}
