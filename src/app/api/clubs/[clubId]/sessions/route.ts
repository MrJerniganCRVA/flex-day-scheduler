import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createClubSessionSchema } from "@/lib/validations";
import { createEventForSession } from "@/lib/google-calendar";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId } = await params;

  const sessions = await prisma.clubSession.findMany({
    where: { clubId },
    include: {
      flexDay: { select: { id: true, date: true, label: true } },
      _count: { select: { signups: true } },
    },
    orderBy: { flexDay: { date: "asc" } },
  });

  return NextResponse.json(sessions);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId } = await params;

  // Verify access: owner or admin
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (session.user.role !== "ADMIN" && club.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createClubSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { flexDayId, rotations } = parsed.data;

  const flexDay = await prisma.flexDay.findUnique({ where: { id: flexDayId } });
  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  // Create the session
  const clubSession = await prisma.clubSession.create({
    data: { clubId, flexDayId, rotations },
    include: {
      flexDay: { select: { id: true, date: true, label: true } },
      club: { select: { name: true, location: true } },
    },
  });

  // Create Google Calendar event (non-blocking)
  if (club.googleCalendarId) {
    createEventForSession({
      calendarId: club.googleCalendarId,
      clubName: club.name,
      location: club.location,
      flexDayDate: flexDay.date,
      rotations,
    })
      .then(async (eventId) => {
        await prisma.clubSession.update({
          where: { id: clubSession.id },
          data: { googleEventId: eventId },
        });
      })
      .catch((err) =>
        console.error("Failed to create Google Calendar event:", err)
      );
  }

  return NextResponse.json(clubSession, { status: 201 });
}
