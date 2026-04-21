import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createEventForSession, deleteEvent } from "@/lib/google-calendar";

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
      signups: { select: { studentId: true } },
      rotationCoverage: true,
      club: {
        select: {
          id: true,
          ownerId: true,
          name: true,
          googleCalendarId: true,
          defaultRoom: { select: { name: true } },
        },
      },
      flexDay: { select: { date: true } },
      roomOverride: { select: { name: true } },
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

  const studentIds = original.signups.map((s) => s.studentId);
  const location =
    original.roomOverride?.name ?? original.club?.defaultRoom?.name ?? null;

  // Run all DB mutations atomically: create new sessions + migrate data + delete original
  const newSessions = await prisma.$transaction(async (tx) => {
    const created: { id: string; rotation: typeof original.rotations[number] }[] = [];

    for (const rotation of original.rotations) {
      const newSession = await tx.clubSession.create({
        data: {
          flexDayId: original.flexDayId,
          clubId: original.clubId,
          rotations: [rotation],
          roomOverrideId: original.roomOverrideId,
        },
      });

      const coverage = original.rotationCoverage.find(
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

      created.push({ id: newSession.id, rotation });
    }

    // Delete original (cascades signups and rotationCoverage)
    await tx.clubSession.delete({ where: { id: sessionId } });

    return created;
  });

  // Fire calendar events non-blocking after the transaction commits
  if (original.club?.googleCalendarId) {
    for (const { id: newSessionId, rotation } of newSessions) {
      createEventForSession({
        calendarId: original.club.googleCalendarId!,
        clubName: original.club.name!,
        location,
        flexDayDate: original.flexDay.date,
        rotations: [rotation],
      })
        .then((eventId) =>
          prisma.clubSession.update({
            where: { id: newSessionId },
            data: { googleEventId: eventId },
          })
        )
        .catch((err) =>
          console.error(
            `Failed to create calendar event for split session ${newSessionId}:`,
            err
          )
        );
    }
  }

  // Delete original Google Calendar event non-blocking
  if (original.club?.googleCalendarId && original.googleEventId) {
    deleteEvent(original.club!.googleCalendarId, original.googleEventId).catch(
      (err) =>
        console.error(
          `Failed to delete original calendar event for split session ${sessionId}:`,
          err
        )
    );
  }

  return NextResponse.json({ splitInto: newSessions });
}
