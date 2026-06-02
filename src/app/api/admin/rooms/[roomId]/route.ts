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

  const { name, capacity } = parsed.data;

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
    },
  });

  return NextResponse.json(room);
}

/**
 * DELETE /api/admin/rooms/[roomId]
 * Hard deletes the room. FK onDelete: SetNull clears Club.defaultRoomId
 * and ClubSession.roomOverrideId automatically.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { roomId } = await params;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  await prisma.room.delete({ where: { id: roomId } });

  return new NextResponse(null, { status: 204 });
}
