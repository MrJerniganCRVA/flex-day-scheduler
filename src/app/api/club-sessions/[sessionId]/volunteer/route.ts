import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import type { RotationSlot } from "@prisma/client";

const rotationSchema = z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]);

const bodySchema = z.object({ rotation: rotationSchema });

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await params;
  const userId = session.user.id!;

  const rotationParam = req.nextUrl.searchParams.get("rotation");
  const parsed = rotationSchema.safeParse(rotationParam);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rotation" }, { status: 400 });
  }
  const rotation = parsed.data;

  const existing = await prisma.sessionRotationCoverage.findUnique({
    where: { sessionId_rotation: { sessionId, rotation } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Coverage record not found" }, { status: 404 });
  }

  const isT1 = existing.primaryTeacherId === userId;
  const isT2 = existing.secondaryTeacherId === userId;
  if (!isT1 && !isT2) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const newT1 = isT1 ? null : existing.primaryTeacherId;
  const newT2 = isT2 ? null : existing.secondaryTeacherId;

  if (newT1 === null && newT2 === null) {
    await prisma.sessionRotationCoverage.delete({
      where: { sessionId_rotation: { sessionId, rotation } },
    });
  } else {
    await prisma.sessionRotationCoverage.update({
      where: { sessionId_rotation: { sessionId, rotation } },
      data: { primaryTeacherId: newT1, secondaryTeacherId: newT2 },
    });
  }

  return new NextResponse(null, { status: 204 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await params;
  const userId = session.user.id!;

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { rotation } = parsed.data;

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true, rotations: true, flexDayId: true },
  });

  if (!clubSession || !clubSession.rotations.includes(rotation)) {
    return NextResponse.json({ error: "Session or rotation not found" }, { status: 404 });
  }

  const existing = await prisma.sessionRotationCoverage.findUnique({
    where: { sessionId_rotation: { sessionId, rotation } },
  });

  if (existing?.primaryTeacherId === userId || existing?.secondaryTeacherId === userId) {
    return NextResponse.json({ error: "Already volunteered for this slot" }, { status: 409 });
  }

  // Check whether this teacher already has another commitment in the same rotation
  const conflict = await prisma.clubSession.findFirst({
    where: {
      id: { not: sessionId },
      flexDayId: clubSession.flexDayId,
      rotations: { has: rotation },
      OR: [
        {
          club: { ownerId: userId },
          teacherAbsent: false,
          teacherReassigned: false,
          rotationCoverage: { none: { rotation, primaryTeacherId: { not: null } } },
        },
        {
          oneOffOwnerId: userId,
          teacherAbsent: false,
          teacherReassigned: false,
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

  if (conflict) {
    const conflictName = conflict.club?.name ?? conflict.title ?? "another session";
    return NextResponse.json(
      { error: `You are already assigned to "${conflictName}" in this rotation` },
      { status: 409 }
    );
  }

  if (!existing || existing.primaryTeacherId === null) {
    const coverage = await prisma.sessionRotationCoverage.upsert({
      where: { sessionId_rotation: { sessionId, rotation } },
      create: { sessionId, rotation, primaryTeacherId: userId },
      update: { primaryTeacherId: userId },
    });
    return NextResponse.json(coverage);
  }

  if (existing.secondaryTeacherId === null) {
    const coverage = await prisma.sessionRotationCoverage.update({
      where: { sessionId_rotation: { sessionId, rotation } },
      data: { secondaryTeacherId: userId },
    });
    return NextResponse.json(coverage);
  }

  return NextResponse.json({ error: "No open spots for this rotation" }, { status: 409 });
}
