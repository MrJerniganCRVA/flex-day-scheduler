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
      select: { id: true, name: true, googleCalendarId: true, defaultRotations: true },
    });

    // Create sessions for all clubs that have default rotations
    const eligibleClubs = clubs.filter(
      (club) => club.defaultRotations && club.defaultRotations.length > 0
    );
    const sessionPromises = eligibleClubs.map((club) =>
      prisma.clubSession.create({
        data: {
          flexDayId: flexDay.id,
          clubId: club.id,
          rotations: club.defaultRotations,
        },
      })
    );

    const createdSessions = await Promise.all(sessionPromises);

    // Create Google Calendar events for each auto-scheduled session (non-blocking)
    for (let i = 0; i < eligibleClubs.length; i++) {
      const club = eligibleClubs[i];
      const createdSession = createdSessions[i];
      if (club.googleCalendarId) {
        createEventForSession({
          calendarId: club.googleCalendarId,
          clubName: club.name,
          location: null,
          flexDayDate: flexDay.date,
          rotations: club.defaultRotations,
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
