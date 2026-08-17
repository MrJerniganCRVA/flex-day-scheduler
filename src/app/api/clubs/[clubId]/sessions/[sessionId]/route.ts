import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateClubSessionSchema } from "@/lib/validations";
import { deleteEvent, updateEventForSession } from "@/lib/google-calendar";
import { getOccupiedRoomIds } from "@/lib/scheduling";
import { isClubManager } from "@/lib/auth-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string; sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: {
      flexDay: { select: { id: true, date: true, label: true } },
      club: {
        select: { id: true, name: true, maxCapacity: true },
      },
      _count: { select: { signups: true } },
      signups:
        session.user.role !== "STUDENT"
          ? {
              include: {
                student: { select: { id: true, name: true, email: true } },
              },
            }
          : { where: { studentId: session.user.id }, select: { id: true } },
    },
  });

  if (!clubSession) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(clubSession);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clubId: string; sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId, sessionId } = await params;

  // Verify access: owner, cosponsor, or admin
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      ownerId: true,
      maxCapacity: true,
      googleCalendarId: true,
      defaultRoomId: true,
      defaultRoom: { select: { name: true } },
      cosponsorId: true,
    },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (!isClubManager(club, session.user.id, session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateClubSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Fetch the existing session to get flexDayId, googleEventId, and room for calendar sync
  const existingSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { flexDayId: true, googleEventId: true, roomOverrideId: true, rotations: true },
  });
  if (!existingSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // If rotations are being changed, re-run teacher conflict check (excluding this session)
  if (parsed.data.rotations) {
    const teacherConflict = await prisma.clubSession.findFirst({
      where: {
        id: { not: sessionId },
        flexDayId: existingSession.flexDayId,
        club: { ownerId: club.ownerId },
        rotations: { hasSome: parsed.data.rotations },
      },
      include: { club: { select: { name: true } } },
    });
    if (teacherConflict) {
      return NextResponse.json(
        {
          error: `This teacher already has "${teacherConflict.club?.name ?? "another session"}" scheduled in one of these rotations on this day. A teacher cannot be in two places at once.`,
        },
        { status: 409 }
      );
    }
  }

  // If a room override is being set, validate it fits the club's capacity
  if (parsed.data.roomOverrideId) {
    const room = await prisma.room.findUnique({
      where: { id: parsed.data.roomOverrideId },
      select: { capacity: true, name: true },
    });
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (room.capacity < club.maxCapacity) {
      return NextResponse.json(
        {
          error: `Room capacity (${room.capacity}) is less than the club's max capacity (${club.maxCapacity} for ${room.name})`,
        },
        { status: 400 }
      );
    }
  }

  // Prevent double-booking a room during an overlapping rotation on this flex day
  const finalRoomId =
    "roomOverrideId" in parsed.data
      ? (parsed.data.roomOverrideId ?? club.defaultRoomId ?? null)
      : (existingSession.roomOverrideId ?? club.defaultRoomId ?? null);
  const finalRotations = parsed.data.rotations ?? existingSession.rotations;
  if (finalRoomId) {
    const occupiedRoomIds = await getOccupiedRoomIds({
      flexDayId: existingSession.flexDayId,
      rotations: finalRotations,
      excludeSessionId: sessionId,
    });
    if (occupiedRoomIds.has(finalRoomId)) {
      return NextResponse.json(
        {
          error: "Selected room is already in use during one of these rotations on this flex day",
        },
        { status: 409 }
      );
    }
  }

  // Build update data - only include fields that were provided
  const updateData: Partial<{
    rotations: typeof parsed.data.rotations;
    roomOverrideId: string | null;
    capacityOverride: number | null;
  }> = {};
  if (parsed.data.rotations) {
    updateData.rotations = parsed.data.rotations;
  }
  if ("roomOverrideId" in parsed.data) {
    updateData.roomOverrideId = parsed.data.roomOverrideId ?? null;
  }
  if ("capacityOverride" in parsed.data) {
    updateData.capacityOverride = parsed.data.capacityOverride ?? null;
  }

  const updatedSession = await prisma.clubSession.update({
    where: { id: sessionId },
    data: updateData,
    include: {
      flexDay: { select: { date: true, label: true } },
      club: { select: { name: true } },
      roomOverride: { select: { name: true } },
    },
  });

  // Sync the Google Calendar event if rotations or room changed
  const rotationsChanged = Boolean(parsed.data.rotations);
  const roomChanged = parsed.data.roomOverrideId !== undefined;
  if (
    (rotationsChanged || roomChanged) &&
    club.googleCalendarId &&
    existingSession.googleEventId
  ) {
    const location =
      updatedSession.roomOverride?.name ?? club.defaultRoom?.name ?? null;
    updateEventForSession({
      calendarId: club.googleCalendarId,
      eventId: existingSession.googleEventId,
      title: updatedSession.club!.name,
      location,
      flexDayDate: updatedSession.flexDay.date,
      rotations: updatedSession.rotations,
    }).catch((err) =>
      console.error(
        `Failed to update calendar event for session ${sessionId}:`,
        err
      )
    );
  }

  return NextResponse.json(updatedSession);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string; sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId, sessionId } = await params;

  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (!isClubManager(club, session.user.id, session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
  });
  if (!clubSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await prisma.clubSession.delete({ where: { id: sessionId } });

  // Delete Google Calendar event (non-blocking)
  if (club.googleCalendarId && clubSession.googleEventId) {
    deleteEvent(club.googleCalendarId, clubSession.googleEventId).catch((err) =>
      console.error("Failed to delete Google Calendar event:", err)
    );
  }

  return new NextResponse(null, { status: 204 });
}
