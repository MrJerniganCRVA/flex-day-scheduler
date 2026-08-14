import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createClubSessionSchema } from "@/lib/validations";
import { getOccupiedRoomIds } from "@/lib/scheduling";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId } = await params;

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { ownerId: true },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (session.user.role !== "ADMIN" && club.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { ownerId: true, defaultRoomId: true },
  });
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

  const { flexDayId, rotations, roomOverrideId } = parsed.data;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true },
  });
  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  // Prevent teacher from being scheduled in the same rotation twice on the same flex day
  const teacherConflict = await prisma.clubSession.findFirst({
    where: {
      flexDayId,
      club: { ownerId: club.ownerId },
      rotations: { hasSome: rotations },
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

  // Prevent double-booking a room during an overlapping rotation on this flex day
  const resolvedRoomId = roomOverrideId ?? club.defaultRoomId ?? null;
  if (resolvedRoomId) {
    const occupiedRoomIds = await getOccupiedRoomIds({ flexDayId, rotations });
    if (occupiedRoomIds.has(resolvedRoomId)) {
      return NextResponse.json(
        {
          error: "Selected room is already in use during one of these rotations on this flex day",
        },
        { status: 409 }
      );
    }
  }

  // Create the session. No calendar event is created here — that happens
  // when an admin finalizes this specific Flex Day.
  const clubSession = await prisma.clubSession.create({
    data: { clubId, flexDayId, rotations, roomOverrideId },
    include: {
      flexDay: { select: { id: true, date: true, label: true } },
      club: { select: { name: true } },
    },
  });

  return NextResponse.json(clubSession, { status: 201 });
}
