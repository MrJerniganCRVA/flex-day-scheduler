import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createClubSchema } from "@/lib/validations";
import { createCalendarForClub, createEventForSession, shareCalendarWithTeacher } from "@/lib/google-calendar";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const where =
    session.user.role === "TEACHER"
      ? { ownerId: session.user.id }
      : undefined;

  const clubs = await prisma.club.findMany({
    where,
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { clubSessions: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(clubs);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (
    !session?.user ||
    (session.user.role !== "TEACHER" && session.user.role !== "ADMIN")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createClubSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Validate that club capacity doesn't exceed room capacity
  if (parsed.data.defaultRoomId) {
    const room = await prisma.room.findUnique({
      where: { id: parsed.data.defaultRoomId },
      select: { capacity: true, name: true },
    });

    if (!room) {
      return NextResponse.json(
        { error: "Selected room not found" },
        { status: 404 }
      );
    }

    if (parsed.data.maxCapacity > room.capacity) {
      return NextResponse.json(
        {
          error: `Club capacity (${parsed.data.maxCapacity}) cannot exceed room capacity (${room.capacity} for ${room.name})`,
        },
        { status: 400 }
      );
    }
  }

  // Admin can assign a club to a specific teacher; everyone else owns their own club
  const { ownerId: requestedOwnerId, ...clubData } = parsed.data;
  const ownerId =
    session.user.role === "ADMIN" && requestedOwnerId
      ? requestedOwnerId
      : session.user.id;

  // Fetch owner email for calendar sharing (needed whether teacher or admin-assigned)
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { email: true },
  });

  // Create the club record first
  const club = await prisma.club.create({
    data: { ...clubData, ownerId },
  });

  // Attempt to create a Google Calendar for this club (non-blocking)
  try {
    const calendarId = await createCalendarForClub(parsed.data.name);
    await prisma.club.update({
      where: { id: club.id },
      data: { googleCalendarId: calendarId },
    });
    club.googleCalendarId = calendarId;

    // Share the calendar with the teacher so it appears in their Google Calendar
    // and they can edit events directly — no domain-wide delegation required
    if (owner?.email) {
      shareCalendarWithTeacher(calendarId, owner.email).catch((err) =>
        console.error("Failed to share calendar with teacher:", club.id, err)
      );
    }
  } catch (err) {
    console.error("Google Calendar creation failed for club:", club.id, err);
  }

  // Auto-schedule club on all future flex days with default rotations
  if (clubData.defaultRotations && clubData.defaultRotations.length > 0) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const futureFlexDays = await prisma.flexDay.findMany({
      where: {
        date: { gte: today },
        isActive: true,
      },
      select: { id: true, date: true },
    });

    const linked = clubData.defaultLinked !== false;
    const rotationsPerSession =
      linked || clubData.defaultRotations.length <= 1
        ? [clubData.defaultRotations]
        : clubData.defaultRotations.map((r) => [r]);

    const sessionEntries: { flexDayId: string; date: Date; rotations: typeof clubData.defaultRotations }[] =
      futureFlexDays.flatMap((fd) =>
        rotationsPerSession.map((rots) => ({
          flexDayId: fd.id,
          date: fd.date,
          rotations: rots,
        }))
      );

    const createdSessions = await Promise.all(
      sessionEntries.map((entry) =>
        prisma.clubSession.create({
          data: {
            flexDayId: entry.flexDayId,
            clubId: club.id,
            rotations: entry.rotations,
          },
        })
      )
    );

    // Create Google Calendar events for each auto-scheduled session (non-blocking)
    if (club.googleCalendarId) {
      for (let i = 0; i < sessionEntries.length; i++) {
        const entry = sessionEntries[i];
        const createdSession = createdSessions[i];
        createEventForSession({
          calendarId: club.googleCalendarId,
          clubName: club.name,
          location: null,
          flexDayDate: entry.date,
          rotations: entry.rotations,
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
  }

  return NextResponse.json(club, { status: 201 });
}
