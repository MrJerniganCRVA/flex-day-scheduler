import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateRoomSchema } from "@/lib/validations";

/**
 * PUT /api/admin/rooms/[roomId]
 * Update a room
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { roomId } = await params;

  // Check if room exists
  const existing = await prisma.room.findUnique({
    where: { id: roomId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateRoomSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, capacity, isActive } = parsed.data;

  // If updating name, check for duplicates
  if (name && name !== existing.name) {
    const duplicate = await prisma.room.findUnique({
      where: { name },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: "A room with this name already exists" },
        { status: 409 }
      );
    }
  }

  const room = await prisma.room.update({
    where: { id: roomId },
    data: {
      ...(name !== undefined && { name }),
      ...(capacity !== undefined && { capacity }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  return NextResponse.json(room);
}

/**
 * DELETE /api/admin/rooms/[roomId]
 * Soft delete a room (sets isActive to false)
 * Prevents deletion if room is currently in use
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { roomId } = await params;

  // Check if room exists
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      _count: {
        select: {
          clubsWithDefault: true,
          sessionOverrides: true,
        },
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Prevent deletion if room is in use
  const inUseCount = room._count.clubsWithDefault + room._count.sessionOverrides;
  if (inUseCount > 0) {
    return NextResponse.json(
      {
        error: "Cannot delete room that is in use",
        details: {
          clubsUsing: room._count.clubsWithDefault,
          sessionsUsing: room._count.sessionOverrides,
        },
      },
      { status: 409 }
    );
  }

  // Soft delete by setting isActive to false
  const updated = await prisma.room.update({
    where: { id: roomId },
    data: { isActive: false },
  });

  return NextResponse.json(updated);
}
