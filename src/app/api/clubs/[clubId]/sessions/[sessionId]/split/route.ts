import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createEventForSession, deleteEvent } from "@/lib/google-calendar";
import { resolveSessionTeacherIds } from "@/lib/coverage";

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
          primaryTeacher: { select: { id: true, email: true } },
          secondaryTeacher: { select: { id: true, email: true } },
        },
      },
      teacherAbsences: { select: { teacherId: true, rotation: true } },
      club: {
        select: {
          id: true,
          ownerId: true,
          cosponsorId: true,
          name: true,
          googleCalendarId: true,
          defaultRoom: { select: { name: true } },
          owner: { select: { id: true, email: true } },
          cosponsor: { select: { id: true, email: true } },
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
  const teacherAbsences = original.teacherAbsences;
  const rotations = original.rotations;

  // Teacher id -> email, for turning resolved coverage back into attendees.
  const teacherEmailById = new Map<string, string>();
  if (club?.ownerId && club.owner?.email) {
    teacherEmailById.set(club.ownerId, club.owner.email);
  }
  if (club?.cosponsorId && club.cosponsor?.email) {
    teacherEmailById.set(club.cosponsorId, club.cosponsor.email);
  }
  for (const rc of rotationCoverage) {
    if (rc.primaryTeacher?.id && rc.primaryTeacher.email) {
      teacherEmailById.set(rc.primaryTeacher.id, rc.primaryTeacher.email);
    }
    if (rc.secondaryTeacher?.id && rc.secondaryTeacher.email) {
      teacherEmailById.set(rc.secondaryTeacher.id, rc.secondaryTeacher.email);
    }
  }
  const studentIds = original.signups.map((s) => s.studentId);
  const studentEmails = original.signups
    .map((s) => s.student.email)
    .filter((email): email is string => Boolean(email));
  const location =
    original.roomOverride?.name ?? club?.defaultRoom?.name ?? null;

  // Per-rotation attendees for the split-off sessions, used only when the
  // original session was already finalized/invited.
  //
  // Routed through the shared resolver rather than hand-rolling the fallback:
  // the previous version fell back to the club owner only, so splitting a
  // session dropped its cosponsor from the resulting calendar events.
  function attendeeEmailsForRotation(rotation: (typeof rotations)[number]) {
    const teacherIds = resolveSessionTeacherIds(
      club,
      rotationCoverage,
      [rotation],
      teacherAbsences
    );
    const emails = new Set<string>();
    for (const id of teacherIds) {
      const email = teacherEmailById.get(id);
      if (email) emails.add(email);
    }
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
        title: original.club.name!,
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
