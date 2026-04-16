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
    original.roomOverride?.name ?? original.club.defaultRoom?.name ?? null;

  const newSessions: { id: string; rotation: string }[] = [];

  for (const rotation of original.rotations) {
    const newSession = await prisma.clubSession.create({
      data: {
        flexDayId: original.flexDayId,
        clubId: original.clubId,
        rotations: [rotation],
        roomOverrideId: original.roomOverrideId,
      },
    });

    // Migrate matching coverage record
    const coverage = original.rotationCoverage.find(
      (rc) => rc.rotation === rotation
    );
    if (coverage) {
      await prisma.sessionRotationCoverage.create({
        data: {
          sessionId: newSession.id,
          rotation,
          primaryTeacherId: coverage.primaryTeacherId,
          secondaryTeacherId: coverage.secondaryTeacherId,
        },
      });
    }

    // Migrate signups
    if (studentIds.length > 0) {
      await prisma.signup.createMany({
        data: studentIds.map((studentId) => ({
          studentId,
          clubSessionId: newSession.id,
        })),
        skipDuplicates: true,
      });
    }

    // Create Google Calendar event non-blocking
    if (original.club.googleCalendarId) {
      createEventForSession({
        calendarId: original.club.googleCalendarId,
        clubName: original.club.name,
        location,
        flexDayDate: original.flexDay.date,
        rotations: [rotation],
      })
        .then((eventId) =>
          prisma.clubSession.update({
            where: { id: newSession.id },
            data: { googleEventId: eventId },
          })
        )
        .catch((err) =>
          console.error(
            `Failed to create calendar event for split session ${newSession.id}:`,
            err
          )
        );
    }

    newSessions.push({ id: newSession.id, rotation });
  }

  // Delete original session (cascades signups and rotationCoverage)
  await prisma.clubSession.delete({ where: { id: sessionId } });

  // Delete original Google Calendar event non-blocking
  if (original.club.googleCalendarId && original.googleEventId) {
    deleteEvent(original.club.googleCalendarId, original.googleEventId).catch(
      (err) =>
        console.error(
          `Failed to delete original calendar event for split session ${sessionId}:`,
          err
        )
    );
  }

  return NextResponse.json({ splitInto: newSessions });
}
