import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import type { RotationSlot } from "@prisma/client";

const rotationSchema = z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]);

const bodySchema = z.object({
  flexDayId: z.string().min(1),
  rotation: rotationSchema,
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: dutyStationId } = await params;
  const userId = session.user.id!;

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { flexDayId, rotation } = parsed.data;

  const station = await prisma.dutyStation.findUnique({ where: { id: dutyStationId } });
  if (!station) {
    return NextResponse.json({ error: "Duty station not found" }, { status: 404 });
  }

  if (station.maxTeachers === 0) {
    return NextResponse.json({ error: "This station has no open slots" }, { status: 409 });
  }

  const existing = await prisma.dutyStationAssignment.findFirst({
    where: { dutyStationId, flexDayId, rotation, teacherId: userId },
  });
  if (existing) {
    return NextResponse.json({ error: "Already assigned to this slot" }, { status: 409 });
  }

  const currentCount = await prisma.dutyStationAssignment.count({
    where: { dutyStationId, flexDayId, rotation },
  });
  if (currentCount >= station.maxTeachers) {
    return NextResponse.json({ error: "No open slots for this station and rotation" }, { status: 409 });
  }

  const absent = await prisma.teacherFlexDayAbsence.findFirst({
    where: { userId, flexDayId, rotation, type: "ABSENT" },
  });
  if (absent) {
    return NextResponse.json(
      { error: "You are marked absent from school for this rotation" },
      { status: 409 }
    );
  }

  // Check for existing duty assignment conflict in this rotation (different station)
  const dutyConflict = await prisma.dutyStationAssignment.findFirst({
    where: { dutyStationId: { not: dutyStationId }, flexDayId, rotation, teacherId: userId },
    include: { dutyStation: { select: { name: true } } },
  });
  if (dutyConflict) {
    return NextResponse.json(
      { error: `You are already assigned to duty station "${dutyConflict.dutyStation.name}" in this rotation` },
      { status: 409 }
    );
  }

  // Check for club session conflict
  const sessionConflict = await prisma.clubSession.findFirst({
    where: {
      flexDayId,
      rotations: { has: rotation },
      OR: [
        {
          club: { ownerId: userId },
          flexDay: { teacherAbsences: { none: { userId, rotation } } },
          rotationCoverage: { none: { rotation, primaryTeacherId: { not: null } } },
        },
        {
          oneOffOwnerId: userId,
          flexDay: { teacherAbsences: { none: { userId, rotation } } },
          rotationCoverage: { none: { rotation, primaryTeacherId: { not: null } } },
        },
        {
          rotationCoverage: {
            some: {
              rotation,
              OR: [{ primaryTeacherId: userId }, { secondaryTeacherId: userId }],
            },
          },
        },
      ],
    },
    select: { club: { select: { name: true } }, title: true },
  });

  if (sessionConflict) {
    const name = sessionConflict.club?.name ?? sessionConflict.title ?? "another session";
    return NextResponse.json(
      { error: `You are already assigned to "${name}" in this rotation` },
      { status: 409 }
    );
  }

  const assignment = await prisma.dutyStationAssignment.create({
    data: { dutyStationId, flexDayId, rotation, teacherId: userId, adminLocked: false },
    include: { teacher: { select: { id: true, name: true } } },
  });

  return NextResponse.json(assignment, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: dutyStationId } = await params;
  const userId = session.user.id!;
  const isAdmin = session.user.role === "ADMIN";

  const flexDayId = req.nextUrl.searchParams.get("flexDayId");
  const rotationParam = req.nextUrl.searchParams.get("rotation");
  const parsed = rotationSchema.safeParse(rotationParam);
  if (!flexDayId || !parsed.success) {
    return NextResponse.json({ error: "flexDayId and rotation required" }, { status: 400 });
  }
  const rotation = parsed.data;

  const teacherId = isAdmin
    ? (req.nextUrl.searchParams.get("teacherId") ?? userId)
    : userId;

  const assignment = await prisma.dutyStationAssignment.findFirst({
    where: { dutyStationId, flexDayId, rotation, teacherId },
  });
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  if (!isAdmin && assignment.adminLocked) {
    return NextResponse.json(
      { error: "This assignment was set by an admin and cannot be removed" },
      { status: 403 }
    );
  }

  await prisma.dutyStationAssignment.delete({ where: { id: assignment.id } });
  return new NextResponse(null, { status: 204 });
}
