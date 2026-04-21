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

  const { flexDayId, title, rotations, roomOverrideId, capacity } = parsed.data;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true, isActive: true },
  });
  if (!flexDay) {
    return NextResponse.json({ error: "Flex day not found" }, { status: 404 });
  }
  if (!flexDay.isActive) {
    return NextResponse.json(
      { error: "Flex day is not active" },
      { status: 400 }
    );
  }

  const room = await prisma.room.findUnique({
    where: { id: roomOverrideId },
    select: { id: true },
  });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const clubSession = await prisma.clubSession.create({
    data: {
      flexDayId,
      clubId: null,
      title,
      rotations,
      roomOverrideId,
      capacityOverride: capacity,
      oneOffOwnerId: session.user.id,
    },
    select: { id: true },
  });

  return NextResponse.json(clubSession, { status: 201 });
}
