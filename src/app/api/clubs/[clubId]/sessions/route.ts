import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { enrollRequiredMembers } from "@/lib/required-members-io";
import { createClubSessionSchema } from "@/lib/validations";
import { getOccupiedRoomIds } from "@/lib/scheduling";
import { isClubManager } from "@/lib/auth-helpers";

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
    select: { ownerId: true, cosponsorId: true },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (!isClubManager(club, session.user.id, session.user.role)) {
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

  // Verify access: owner, cosponsor, or admin
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { ownerId: true, defaultRoomId: true, cosponsorId: true },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (!isClubManager(club, session.user.id, session.user.role)) {
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
  const teacherConflict = club.ownerId
    ? await prisma.clubSession.findFirst({
        where: {
          flexDayId,
          club: { ownerId: club.ownerId },
          rotations: { hasSome: rotations },
        },
        include: { club: { select: { name: true } } },
      })
    : null;
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

  // A club's required members belong on every session it gets, including the
  // ones a teacher schedules by hand. Reported back so the teacher sees who was
  // added, and what it displaced, rather than discovering it on the roster.
  const enrollment = await enrollRequiredMembers({
    clubId,
    sessionIds: [clubSession.id],
    actor: { id: session.user.id ?? null, email: session.user.email ?? "unknown" },
  });

  return NextResponse.json({ ...clubSession, enrollment }, { status: 201 });
}
