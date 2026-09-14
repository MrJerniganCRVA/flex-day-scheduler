import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

/**
 * Split a linked session into one session per rotation.
 *
 * Since each rotation already has its own calendar event, the split does not
 * touch Google at all: the `SessionCalendarEvent` rows simply follow their
 * rotation to the session that now owns it. This used to delete the single
 * spanning event and create a fresh one per rotation, which re-sent an invite to
 * every student for a change that, to them, altered nothing.
 */

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string; sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { clubId, sessionId } = await params;

  const original = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: {
      signups: {
        select: {
          studentId: true,
          student: { select: { email: true } },
        },
      },
      rotationCoverage: true,
      sessionEvents: { select: { id: true, rotation: true } },
    },
  });

  if (!original || original.clubId !== clubId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (original.rotations.length < 2) {
    return NextResponse.json(
      { error: "Session only covers one rotation — nothing to split" },
      { status: 400 }
    );
  }

  const rotationCoverage = original.rotationCoverage;
  const rotations = original.rotations;
  const studentIds = original.signups.map((s) => s.studentId);
  const eventByRotation = new Map(
    original.sessionEvents.map((e) => [e.rotation, e])
  );

  // Run all DB mutations atomically: create new sessions + migrate data + delete original
  const newSessions = await prisma.$transaction(async (tx) => {
    const created: { id: string; rotation: (typeof rotations)[number] }[] = [];

    for (const rotation of rotations) {
      const newSession = await tx.clubSession.create({
        data: {
          flexDayId: original.flexDayId,
          clubId: original.clubId,
          rotations: [rotation],
          roomOverrideId: original.roomOverrideId,
        },
      });

      const coverage = rotationCoverage.find(
        (rc) => rc.rotation === rotation
      );
      if (coverage) {
        await tx.sessionRotationCoverage.create({
          data: {
            sessionId: newSession.id,
            rotation,
            primaryTeacherId: coverage.primaryTeacherId,
            secondaryTeacherId: coverage.secondaryTeacherId,
          },
        });
      }

      if (studentIds.length > 0) {
        await tx.signup.createMany({
          data: studentIds.map((studentId) => ({
            studentId,
            clubSessionId: newSession.id,
          })),
          skipDuplicates: true,
        });
      }

      // Hand this rotation's existing invite to the session that now owns the
      // rotation. Re-parenting must happen before the delete below, which would
      // otherwise cascade the row away and strand a live event in Google with
      // nothing pointing at it.
      const event = eventByRotation.get(rotation);
      if (event) {
        await tx.sessionCalendarEvent.update({
          where: { id: event.id },
          data: { sessionId: newSession.id },
        });
      }

      created.push({ id: newSession.id, rotation });
    }

    // Delete original (cascades signups and rotationCoverage)
    await tx.clubSession.delete({ where: { id: sessionId } });

    return created;
  });

  return NextResponse.json({ splitInto: newSessions });
}
