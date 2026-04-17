import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { deleteEvent } from "@/lib/google-calendar";
import { z } from "zod";
import type { RotationSlot } from "@prisma/client";

const bodySchema = z.object({
  mergeSessionIds: z.array(z.string()).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clubId: string; sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { clubId, sessionId } = await params;

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { mergeSessionIds } = parsed.data;

  // Fetch target session and all sessions to merge
  const [target, ...merges] = await Promise.all([
    prisma.clubSession.findUnique({
      where: { id: sessionId },
      include: {
        signups: { select: { studentId: true } },
        rotationCoverage: true,
        club: {
          select: {
            id: true,
            ownerId: true,
            googleCalendarId: true,
          },
        },
      },
    }),
    ...mergeSessionIds.map((id) =>
      prisma.clubSession.findUnique({
        where: { id },
        include: {
          signups: {
            include: { student: { select: { id: true, name: true } } },
          },
          rotationCoverage: true,
          club: { select: { googleCalendarId: true } },
        },
      })
    ),
  ]);

  if (!target || target.clubId !== clubId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Validate all merge sessions exist and belong to the same club + flex day
  for (const m of merges) {
    if (!m) {
      return NextResponse.json(
        { error: "One or more sessions to merge not found" },
        { status: 404 }
      );
    }
    if (m.clubId !== clubId || m.flexDayId !== target.flexDayId) {
      return NextResponse.json(
        {
          error:
            "All sessions must belong to the same club and flex day",
        },
        { status: 400 }
      );
    }
  }

  // Build combined rotations — no duplicates
  const combinedRotations: RotationSlot[] = [...target.rotations];
  for (const m of merges) {
    for (const r of m!.rotations) {
      if (combinedRotations.includes(r)) {
        return NextResponse.json(
          {
            error: `Rotation ${r} appears in more than one session — cannot link`,
          },
          { status: 400 }
        );
      }
      combinedRotations.push(r);
    }
  }

  // Newly added rotations (not already in the target)
  const newRotations = combinedRotations.filter(
    (r) => !target.rotations.includes(r)
  );

  // Teacher conflict check: does the owner have another session in any new rotation?
  if (newRotations.length > 0) {
    const teacherConflict = await prisma.clubSession.findFirst({
      where: {
        id: { notIn: [sessionId, ...mergeSessionIds] },
        flexDayId: target.flexDayId,
        club: { ownerId: target.club.ownerId },
        rotations: { hasSome: newRotations },
      },
      include: { club: { select: { name: true } } },
    });
    if (teacherConflict) {
      return NextResponse.json(
        {
          error: `The teacher already has "${teacherConflict.club.name}" scheduled in one of these rotations. Cannot link.`,
        },
        { status: 409 }
      );
    }
  }

  // Student conflict check: any student from merged sessions who has a
  // different club in one of the newly added rotations?
  const allMergeStudentIds = new Set(
    merges.flatMap((m) => m!.signups.map((s) => s.studentId))
  );
  const targetStudentIds = new Set(target.signups.map((s) => s.studentId));
  // Students coming in from merges who weren't already in the target
  const incomingStudentIds = [...allMergeStudentIds].filter(
    (id) => !targetStudentIds.has(id)
  );

  if (incomingStudentIds.length > 0 && newRotations.length > 0) {
    const conflicts = await prisma.signup.findMany({
      where: {
        studentId: { in: incomingStudentIds },
        clubSession: {
          flexDayId: target.flexDayId,
          id: { notIn: [sessionId, ...mergeSessionIds] },
          rotations: { hasSome: newRotations },
        },
      },
      include: {
        student: { select: { name: true } },
        clubSession: {
          select: {
            rotations: true,
            club: { select: { name: true } },
          },
        },
      },
    });

    if (conflicts.length > 0) {
      return NextResponse.json(
        {
          error: "Some students have conflicting signups in the new rotations",
          conflicts: conflicts.map((c) => ({
            studentName: c.student.name,
            rotation: c.clubSession.rotations.find((r) =>
              newRotations.includes(r)
            ),
            conflictingClub: c.clubSession.club.name,
          })),
        },
        { status: 409 }
      );
    }
  }

  // Run all DB mutations atomically
  const allIncomingStudentIds = [
    ...new Set(merges.flatMap((m) => m!.signups.map((s) => s.studentId))),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.clubSession.update({
      where: { id: sessionId },
      data: { rotations: combinedRotations },
    });

    if (allIncomingStudentIds.length > 0) {
      await tx.signup.createMany({
        data: allIncomingStudentIds.map((studentId) => ({
          studentId,
          clubSessionId: sessionId,
        })),
        skipDuplicates: true,
      });
    }

    for (const m of merges) {
      for (const rc of m!.rotationCoverage) {
        await tx.sessionRotationCoverage.upsert({
          where: { sessionId_rotation: { sessionId, rotation: rc.rotation } },
          create: {
            sessionId,
            rotation: rc.rotation,
            primaryTeacherId: rc.primaryTeacherId,
            secondaryTeacherId: rc.secondaryTeacherId,
          },
          update: {
            primaryTeacherId: rc.primaryTeacherId,
            secondaryTeacherId: rc.secondaryTeacherId,
          },
        });
      }
    }

    // Delete merged sessions (cascade removes their signups and rotationCoverage)
    await tx.clubSession.deleteMany({
      where: { id: { in: mergeSessionIds } },
    });
  });

  // Delete merged sessions' Google Calendar events non-blocking after commit
  for (const m of merges) {
    if (m!.club.googleCalendarId && m!.googleEventId) {
      deleteEvent(m!.club.googleCalendarId, m!.googleEventId).catch((err) =>
        console.error(
          `Failed to delete calendar event for merged session ${m!.id}:`,
          err
        )
      );
    }
  }

  return NextResponse.json({
    linkedSession: { id: sessionId, rotations: combinedRotations },
  });
}
