import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createOneOffSchema } from "@/lib/validations";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createOneOffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { flexDayId, title, rotations, roomOverrideId, capacity, override } = parsed.data;
  const userId = session.user.id;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true, isActive: true },
  });
  if (!flexDay) {
    return NextResponse.json({ error: "Flex day not found" }, { status: 404 });
  }
  if (!flexDay.isActive) {
    return NextResponse.json({ error: "Flex day is not active" }, { status: 400 });
  }

  const room = await prisma.room.findUnique({
    where: { id: roomOverrideId },
    select: { id: true },
  });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Step 1: Hard block — already owns another one-off in these rotations
  const oneOffConflict = await prisma.clubSession.findFirst({
    where: {
      flexDayId,
      rotations: { hasSome: rotations },
      oneOffOwnerId: userId,
    },
    select: { title: true },
  });
  if (oneOffConflict) {
    return NextResponse.json(
      {
        error: `You already have "${oneOffConflict.title ?? "another activity"}" scheduled in one of these rotations.`,
        canOverride: false,
      },
      { status: 409 }
    );
  }

  // Step 2: Club ownership conflict — skip rotations already flagged REASSIGNED
  const existingReassigned = await prisma.teacherFlexDayAbsence.findMany({
    where: { userId, flexDayId, type: "REASSIGNED", rotation: { in: rotations } },
    select: { rotation: true },
  });
  const reassignedSet = new Set(existingReassigned.map((a) => a.rotation));

  const ownedClubSessions = await prisma.clubSession.findMany({
    where: {
      flexDayId,
      rotations: { hasSome: rotations },
      club: { ownerId: userId },
    },
    include: { club: { select: { name: true } } },
  });
  const clubConflicts = ownedClubSessions.filter((cs) =>
    cs.rotations.some((r) => rotations.includes(r) && !reassignedSet.has(r))
  );

  // Step 3: Coverage assignment conflict
  const coverageConflicts = await prisma.sessionRotationCoverage.findMany({
    where: {
      primaryTeacherId: userId,
      rotation: { in: rotations },
      session: { flexDayId },
    },
    include: {
      session: {
        include: { club: { select: { name: true } } },
      },
    },
  });

  const hasConflicts = clubConflicts.length > 0 || coverageConflicts.length > 0;

  if (hasConflicts && !override) {
    return NextResponse.json(
      {
        error: "You have scheduling conflicts for the selected rotations.",
        canOverride: true,
        conflicts: {
          ownedClubs: clubConflicts.map((cs) => ({
            name: cs.club?.name ?? "Unknown club",
            rotations: cs.rotations.filter((r) => rotations.includes(r) && !reassignedSet.has(r)),
          })),
          coverageAssignments: coverageConflicts.map((rc) => ({
            name: rc.session.title ?? rc.session.club?.name ?? "Unknown session",
            rotation: rc.rotation,
          })),
        },
      },
      { status: 409 }
    );
  }

  if (hasConflicts && override) {
    // Resolve club conflicts: upsert REASSIGNED absence for each conflicting rotation
    const rotationsToReassign = clubConflicts.flatMap((cs) =>
      cs.rotations.filter((r) => rotations.includes(r) && !reassignedSet.has(r))
    );
    const uniqueRotations = [...new Set(rotationsToReassign)];
    await Promise.all(
      uniqueRotations.map((rotation) =>
        prisma.teacherFlexDayAbsence.upsert({
          where: { userId_flexDayId_rotation: { userId, flexDayId, rotation } },
          create: { userId, flexDayId, rotation, type: "REASSIGNED" },
          update: { type: "REASSIGNED" },
        })
      )
    );

    // Resolve coverage conflicts: unassign teacher as primary
    await Promise.all(
      coverageConflicts.map((rc) =>
        prisma.sessionRotationCoverage.update({
          where: { id: rc.id },
          data: { primaryTeacherId: null },
        })
      )
    );
  }

  const clubSession = await prisma.clubSession.create({
    data: {
      flexDayId,
      clubId: null,
      title,
      rotations,
      roomOverrideId,
      capacityOverride: capacity,
      oneOffOwnerId: userId,
    },
    select: { id: true },
  });

  return NextResponse.json(clubSession, { status: 201 });
}
