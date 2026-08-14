import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createClubSchema } from "@/lib/validations";
import { createCalendarForClub } from "@/lib/google-calendar";
import { createAutoScheduledSessions, getDefaultRoomConflictIds } from "@/lib/scheduling";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const where =
    session.user.role === "TEACHER"
      ? {
          OR: [
            { ownerId: session.user.id },
            { cosponsors: { some: { id: session.user.id } } },
          ],
        }
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

    const conflictIds = await getDefaultRoomConflictIds({
      rotations: parsed.data.defaultRotations,
    });
    if (conflictIds.has(parsed.data.defaultRoomId)) {
      return NextResponse.json(
        {
          error: `${room.name} is already another club's default room during one of these rotations`,
        },
        { status: 409 }
      );
    }
  }

  // Admin can assign a club to a specific teacher; everyone else owns their own club
  const { ownerId: requestedOwnerId, cosponsorIds, ...clubData } = parsed.data;
  const ownerId =
    session.user.role === "ADMIN" && requestedOwnerId
      ? requestedOwnerId
      : session.user.id;

  // Strip the resolved owner out of cosponsors so a club never lists its
  // own owner as a cosponsor too.
  const filteredCosponsorIds = cosponsorIds?.filter((id) => id !== ownerId);

  // Create the club record first
  const club = await prisma.club.create({
    data: {
      ...clubData,
      ownerId,
      ...(filteredCosponsorIds?.length
        ? { cosponsors: { connect: filteredCosponsorIds.map((id) => ({ id })) } }
        : {}),
    },
  });

  // Attempt to create a Google Calendar for this club (non-blocking). The
  // calendar itself is created eagerly, but it is NOT shared with the
  // teacher and no events/invites go out yet — that only happens when an
  // admin finalizes the specific Flex Day this club is scheduled on.
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

    await Promise.all(
      futureFlexDays.map((fd) => createAutoScheduledSessions(club, fd.id))
    );
  }

  return NextResponse.json(club, { status: 201 });
}
