import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import type { RotationSlot } from "@prisma/client";

const bodySchema = z.object({
  flexDayId: z.string().min(1),
  rotation: z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]),
  teacherId: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: dutyStationId } = await params;
  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { flexDayId, rotation, teacherId } = parsed.data;

  const station = await prisma.dutyStation.findUnique({ where: { id: dutyStationId } });
  if (!station) {
    return NextResponse.json({ error: "Duty station not found" }, { status: 404 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { role: true },
  });
  if (!teacher || teacher.role === "STUDENT") {
    return NextResponse.json({ error: "Teacher not found or invalid role" }, { status: 400 });
  }

  const currentCount = await prisma.dutyStationAssignment.count({
    where: { dutyStationId, flexDayId, rotation },
  });
  if (currentCount >= station.maxTeachers) {
    return NextResponse.json({ error: "No open slots for this station and rotation" }, { status: 409 });
  }

  const existing = await prisma.dutyStationAssignment.findFirst({
    where: { dutyStationId, flexDayId, rotation, teacherId },
  });
  if (existing) {
    return NextResponse.json({ error: "Teacher already assigned to this slot" }, { status: 409 });
  }

  const assignment = await prisma.dutyStationAssignment.create({
    data: { dutyStationId, flexDayId, rotation, teacherId, adminLocked: true },
    include: { teacher: { select: { id: true, name: true } } },
  });

  return NextResponse.json(assignment, { status: 201 });
}
