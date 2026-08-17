import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateClubSessionPerDaySchema } from "@/lib/validations";
import { deleteEvent, getOneOffCalendarId } from "@/lib/google-calendar";
import { getOccupiedRoomIds } from "@/lib/scheduling";
import { isClubManager } from "@/lib/auth-helpers";
import type { Role } from "@prisma/client";

async function resolveOwnerAndSession(sessionId: string, userId: string, userRole: Role) {
  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: {
      club: {
        select: {
          ownerId: true,
          googleCalendarId: true,
          defaultRoom: { select: { id: true, capacity: true } },
          cosponsorId: true,
        },
      },
    },
  });
  if (!clubSession) return { error: "Session not found", status: 404, clubSession: null };

  const isOneOffOwner = clubSession.oneOffOwnerId === userId;
  const canManageClub = clubSession.club
    ? isClubManager(clubSession.club, userId, userRole)
    : userRole === "ADMIN";

  if (!canManageClub && !isOneOffOwner) {
    return { error: "Forbidden", status: 403, clubSession: null };
  }

  return { error: null, status: 200, clubSession };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  const { error, status, clubSession } = await resolveOwnerAndSession(
    sessionId,
    session.user.id,
    session.user.role
  );
  if (error || !clubSession) {
    return NextResponse.json({ error }, { status });
  }

  const body = await request.json();
  const parsed = updateClubSessionPerDaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.roomOverrideId) {
    const room = await prisma.room.findUnique({
      where: { id: parsed.data.roomOverrideId },
      select: { id: true, capacity: true },
    });
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
  }

  // Prevent double-booking a room during an overlapping rotation on this flex day
  const finalRoomId =
    "roomOverrideId" in parsed.data
      ? (parsed.data.roomOverrideId ?? clubSession.club?.defaultRoom?.id ?? null)
      : (clubSession.roomOverrideId ?? clubSession.club?.defaultRoom?.id ?? null);
  const finalRotations = parsed.data.rotations ?? clubSession.rotations;
  if (finalRoomId) {
    const occupiedRoomIds = await getOccupiedRoomIds({
      flexDayId: clubSession.flexDayId,
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

  // Validate capacityOverride does not exceed the applicable room's capacity
  if ("capacityOverride" in parsed.data && parsed.data.capacityOverride != null) {
    // Resolve which room applies: new override from body > existing session override > club default room
    const effectiveRoomId =
      "roomOverrideId" in parsed.data
        ? (parsed.data.roomOverrideId ?? null)
        : (clubSession.roomOverrideId ?? null);

    let roomCapacity: number | null = null;
    if (effectiveRoomId) {
      const room = await prisma.room.findUnique({
        where: { id: effectiveRoomId },
        select: { capacity: true },
      });
      roomCapacity = room?.capacity ?? null;
    } else if (clubSession.club?.defaultRoom) {
      roomCapacity = clubSession.club.defaultRoom.capacity;
    }

    if (roomCapacity !== null && parsed.data.capacityOverride > roomCapacity) {
      return NextResponse.json(
        {
          error: `Capacity override (${parsed.data.capacityOverride}) exceeds room capacity (${roomCapacity})`,
        },
        { status: 400 }
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.rotations !== undefined) updateData.rotations = parsed.data.rotations;
  if ("roomOverrideId" in parsed.data) updateData.roomOverrideId = parsed.data.roomOverrideId ?? null;
  if ("capacityOverride" in parsed.data) updateData.capacityOverride = parsed.data.capacityOverride ?? null;
  if (parsed.data.teacherAbsent !== undefined) updateData.teacherAbsent = parsed.data.teacherAbsent;

  const updated = await prisma.clubSession.update({
    where: { id: sessionId },
    data: updateData,
    select: {
      id: true,
      rotations: true,
      roomOverrideId: true,
      capacityOverride: true,
      teacherAbsent: true,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  const { error, status, clubSession } = await resolveOwnerAndSession(
    sessionId,
    session.user.id,
    session.user.role
  );
  if (error || !clubSession) {
    return NextResponse.json({ error }, { status });
  }

  // Resolve the host calendar before deleting: club sessions live on their
  // club's calendar, one-off sessions on the shared one-off calendar. Guarding
  // only on `club.googleCalendarId` would leak every deleted one-off's event.
  let calendarId: string | null = null;
  if (clubSession.googleEventId) {
    calendarId = clubSession.club
      ? clubSession.club.googleCalendarId
      : await getOneOffCalendarId();
  }

  await prisma.clubSession.delete({ where: { id: sessionId } });

  if (calendarId && clubSession.googleEventId) {
    deleteEvent(calendarId, clubSession.googleEventId).catch((err) =>
      console.error("Failed to delete Google Calendar event:", err)
    );
  }

  return new NextResponse(null, { status: 204 });
}
