import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateClubSessionSchema } from "@/lib/validations";
import {
  SESSION_EVENTS_SELECT,
  resyncSessionEvents,
  withdrawEvents,
} from "@/lib/session-calendar";
import { resolveRoomName } from "@/lib/session-event";
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

  // Fetch the existing session for flexDayId, its calendar events, and room.
  const existingSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: {
      flexDayId: true,
      roomOverrideId: true,
      rotations: true,
      sessionEvents: { select: SESSION_EVENTS_SELECT },
    },
  });
  if (!existingSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // If rotations are being changed, re-run teacher conflict check (excluding this session)
  // Skipped for a club with no owner. `ownerId: null` becomes `IS NULL` in the
  // generated SQL, so this matched every *other* ownerless club's session in the
  // same rotations and refused legitimate scheduling — a club run by a rotation of
  // teachers has no single owner to double-book in the first place.
  //
  // Deliberately still owner-only otherwise, and deliberately still the only
  // blocking check: it cannot see cosponsors, per-rotation coverage or one-off
  // owners, and the clashes that matter most arise from those. Those are warned
  // about on the admin Coverage page by findTeacherClashes rather than blocked
  // here, so a legitimate double-booking can be recorded and resolved.
  if (parsed.data.rotations && club.ownerId) {
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

  // Bring the existing events in line if rotations or room changed. A rotation
  // dropped has its invite withdrawn here; a rotation *added* gets no invite
  // until the day is re-finalized, because picking its organizer needs coverage
  // this route has not loaded. See resyncSessionEvents.
  const rotationsChanged = Boolean(parsed.data.rotations);
  const roomChanged = parsed.data.roomOverrideId !== undefined;
  if (
    (rotationsChanged || roomChanged) &&
    existingSession.sessionEvents.length > 0
  ) {
    const location = resolveRoomName({
      roomOverride: updatedSession.roomOverride,
      club: { defaultRoom: club.defaultRoom },
    });
    void resyncSessionEvents({
      events: existingSession.sessionEvents,
      rotations: updatedSession.rotations,
      name: updatedSession.club!.name,
      roomName: location,
      flexDayDate: updatedSession.flexDay.date,
      context: `Edited session ${sessionId}`,
    });
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
    select: { sessionEvents: { select: SESSION_EVENTS_SELECT } },
  });
  if (!clubSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Read before deleting: the rows cascade away with the session.
  const eventsToCancel = clubSession.sessionEvents;

  await prisma.clubSession.delete({ where: { id: sessionId } });

  // Non-blocking: the database is the source of truth and the row is gone.
  void withdrawEvents(eventsToCancel, `Deleted session ${sessionId}`);

  return new NextResponse(null, { status: 204 });
}
