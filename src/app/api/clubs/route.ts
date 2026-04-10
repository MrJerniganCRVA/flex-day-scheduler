import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createClubSchema } from "@/lib/validations";
import { createCalendarForClub } from "@/lib/google-calendar";

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

  // Admin can assign a club to a specific teacher; everyone else owns their own club
  const { ownerId: requestedOwnerId, ...clubData } = parsed.data;
  const ownerId =
    session.user.role === "ADMIN" && requestedOwnerId
      ? requestedOwnerId
      : session.user.id;

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
      select: { id: true },
    });

    const sessionPromises = futureFlexDays.map((fd) =>
      prisma.clubSession.create({
        data: {
          flexDayId: fd.id,
          clubId: club.id,
          rotations: clubData.defaultRotations,
        },
      })
    );

    await Promise.all(sessionPromises);
  }

  return NextResponse.json(club, { status: 201 });
}
