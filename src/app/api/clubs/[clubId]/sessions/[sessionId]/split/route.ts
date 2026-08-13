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
      signups: {
        select: {
          studentId: true,
          student: { select: { email: true } },
        },
      },
      rotationCoverage: {
        include: {
          primaryTeacher: { select: { email: true } },
          secondaryTeacher: { select: { email: true } },
        },
      },
      club: {
        select: {
          id: true,
          ownerId: true,
          name: true,
          googleCalendarId: true,
          defaultRoom: { select: { name: true } },
          owner: { select: { email: true } },
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

  const club = original.club;
  const rotationCoverage = original.rotationCoverage;
  const rotations = original.rotations;
  const studentIds = original.signups.map((s) => s.studentId);
  const studentEmails = original.signups
    .map((s) => s.student.email)
    .filter((email): email is string => Boolean(email));
  const location =
    original.roomOverride?.name ?? club?.defaultRoom?.name ?? null;

  // Per-rotation coverage teacher emails, falling back to the club owner —
  // used only when the original session was already finalized/invited.
  function attendeeEmailsForRotation(rotation: (typeof rotations)[number]) {
    const coverage = rotationCoverage.find((rc) => rc.rotation === rotation);
    const emails = new Set<string>();
    const primaryEmail = coverage?.primaryTeacher?.email ?? club?.owner.email;
    if (primaryEmail) emails.add(primaryEmail);
    if (coverage?.secondaryTeacher?.email) emails.add(coverage.secondaryTeacher.email);
    for (const email of studentEmails) emails.add(email);
    return [...emails];
  }

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

      created.push({ id: newSession.id, rotation });
    }

    // Delete original (cascades signups and rotationCoverage)
    await tx.clubSession.delete({ where: { id: sessionId } });

    return created;
  });

  // Only create calendar events for the split-off sessions if the original
  // session had already been finalized/invited — otherwise leave the new
  // sessions eventless, consistent with every other not-yet-finalized session.
  if (original.club?.googleCalendarId && original.googleEventId) {
    for (const { id: newSessionId, rotation } of newSessions) {
      createEventForSession({
        calendarId: original.club.googleCalendarId!,
        clubName: original.club.name!,
        location,
        flexDayDate: original.flexDay.date,
        rotations: [rotation],
        attendeeEmails: attendeeEmailsForRotation(rotation),
        sendUpdates: "all",
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
