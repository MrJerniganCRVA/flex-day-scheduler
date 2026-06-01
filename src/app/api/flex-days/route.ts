import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createFlexDaySchema } from "@/lib/validations";
import { createEventForSession } from "@/lib/google-calendar";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const flexDays = await prisma.flexDay.findMany({
    where: { isActive: true },
    include: {
      clubSessions: {
        include: {
          club: { select: { name: true, maxCapacity: true } },
          _count: { select: { signups: true } },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  return NextResponse.json(flexDays);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createFlexDaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { date, label } = parsed.data;
  const dateObj = new Date(`${date}T00:00:00.000Z`);

  try {
    const flexDay = await prisma.flexDay.create({
      data: { date: dateObj, label },
    });

    // Auto-schedule all existing clubs with their default rotations
    const clubs = await prisma.club.findMany({
      select: { id: true, name: true, googleCalendarId: true, defaultRotations: true, defaultLinked: true },
    });

    // Create sessions for all clubs that have default rotations
    const eligibleClubs = clubs.filter(
      (club) => club.defaultRotations && club.defaultRotations.length > 0
    );

    // Build a flat list of (club, rotations) pairs — one-session-per-club when linked,
    // one-session-per-rotation when not linked
    const sessionEntries = eligibleClubs.flatMap((club) => {
      const linked = club.defaultLinked || club.defaultRotations.length <= 1;
      const rotationGroups = linked
        ? [club.defaultRotations]
        : club.defaultRotations.map((r) => [r]);
      return rotationGroups.map((rotations) => ({ club, rotations }));
    });

    const createdSessions = await Promise.all(
      sessionEntries.map(({ club, rotations }) =>
        prisma.clubSession.create({
          data: {
            flexDayId: flexDay.id,
            clubId: club.id,
            rotations,
          },
        })
      )
    );

    // Auto-enroll required members for the newly created sessions
    const memberships = await prisma.clubMember.findMany({
      where: { clubId: { in: eligibleClubs.map((c) => c.id) } },
      select: { clubId: true, studentId: true },
    });
    if (memberships.length > 0) {
      await prisma.signup.createMany({
        data: createdSessions.flatMap((s) =>
          memberships
            .filter((m) => m.clubId === s.clubId)
            .map((m) => ({ studentId: m.studentId, clubSessionId: s.id, forced: true }))
        ),
        skipDuplicates: true,
      });
    }

    // Create Google Calendar events for each auto-scheduled session (non-blocking)
    for (let i = 0; i < sessionEntries.length; i++) {
      const { club, rotations } = sessionEntries[i];
      const createdSession = createdSessions[i];
      if (club.googleCalendarId) {
        createEventForSession({
          calendarId: club.googleCalendarId,
          clubName: club.name,
          location: null,
          flexDayDate: flexDay.date,
          rotations,
        })
          .then((eventId) =>
            prisma.clubSession.update({
              where: { id: createdSession.id },
              data: { googleEventId: eventId },
            })
          )
          .catch((err) =>
            console.error(
              `Failed to create calendar event for auto-scheduled session ${createdSession.id}:`,
              err
            )
          );
      }
    }

    return NextResponse.json(flexDay, { status: 201 });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A Flex Day already exists on this date" },
        { status: 409 }
      );
    }
    throw error;
  }
}
