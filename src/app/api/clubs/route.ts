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
            { cosponsorId: session.user.id },
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

  // Admin can assign a club to a specific teacher, or pass an explicit null to
  // create a club with no permanent teacher (run by a rotation, managed by
  // admins). Everyone else owns the clubs they create.
  const { ownerId: requestedOwnerId, cosponsorId, teacherIds, ...clubData } =
    parsed.data;
  const ownerId =
    session.user.role === "ADMIN"
      ? (requestedOwnerId ?? null)
      : session.user.id;

  // Null the cosponsor out if it matches the resolved owner so a club never
  // lists its own owner as its cosponsor too.
  const finalCosponsorId =
    cosponsorId && cosponsorId !== ownerId ? cosponsorId : null;

  // Create the club record first
  const club = await prisma.club.create({
    data: { ...clubData, ownerId, cosponsorId: finalCosponsorId },
  });

  // Teacher pool: who rotates through this club. Grants no edit rights.
  if (teacherIds && teacherIds.length > 0) {
    const eligible = await prisma.user.findMany({
      where: { id: { in: teacherIds }, role: { in: ["TEACHER", "ADMIN"] } },
      select: { id: true },
    });
    await prisma.clubTeacher.createMany({
      data: eligible.map((t) => ({ clubId: club.id, teacherId: t.id })),
      skipDuplicates: true,
    });
  }

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
