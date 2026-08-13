import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateClubSchema } from "@/lib/validations";
import { deleteCalendar } from "@/lib/google-calendar";
import { getDefaultRoomConflictIds } from "@/lib/scheduling";

async function checkClubAccess(clubId: string, userId: string, role: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) return null;
  if (role !== "ADMIN" && club.ownerId !== userId) return null;
  return club;
}

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
    include: {
      owner: { select: { id: true, name: true, email: true } },
      clubSessions: {
        include: {
          flexDay: { select: { id: true, date: true, label: true } },
          _count: { select: { signups: true } },
        },
        orderBy: { flexDay: { date: "asc" } },
      },
    },
  });

  if (!club) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(club);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId } = await params;
  const club = await checkClubAccess(clubId, session.user.id, session.user.role);
  if (!club) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateClubSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Validate that club capacity doesn't exceed room capacity
  // Need to check both current and updated values
  const { defaultRoomId: newRoomId, maxCapacity: newMaxCapacity } = parsed.data;

  // Determine final values after update
  const finalRoomId = newRoomId !== undefined ? newRoomId : club.defaultRoomId;
  const finalMaxCapacity = newMaxCapacity !== undefined ? newMaxCapacity : club.maxCapacity;
  const finalRotations =
    parsed.data.defaultRotations !== undefined
      ? parsed.data.defaultRotations
      : club.defaultRotations;

  if (newRoomId !== undefined || newMaxCapacity !== undefined) {
    // If there's a room, validate capacity constraint
    if (finalRoomId && finalMaxCapacity) {
      const room = await prisma.room.findUnique({
        where: { id: finalRoomId },
        select: { capacity: true, name: true },
      });

      if (!room) {
        return NextResponse.json(
          { error: "Selected room not found" },
          { status: 404 }
        );
      }

      if (finalMaxCapacity > room.capacity) {
        return NextResponse.json(
          {
            error: `Club capacity (${finalMaxCapacity}) cannot exceed room capacity (${room.capacity} for ${room.name})`,
          },
          { status: 400 }
        );
      }
    }
  }

  // If the room or rotations changed, validate the resolved room isn't
  // already claimed by another club during one of these rotations
  if (
    finalRoomId &&
    (newRoomId !== undefined || parsed.data.defaultRotations !== undefined)
  ) {
    const conflictIds = await getDefaultRoomConflictIds({
      rotations: finalRotations,
      excludeClubId: clubId,
    });
    if (conflictIds.has(finalRoomId)) {
      return NextResponse.json(
        {
          error: "Selected room is already another club's default room during one of these rotations",
        },
        { status: 409 }
      );
    }
  }

  // Only admin can reassign ownership; strip ownerId from non-admin updates
  const { ownerId: newOwnerId, ...updateData } = parsed.data;
  const finalData =
    session.user.role === "ADMIN" && newOwnerId
      ? { ...updateData, ownerId: newOwnerId }
      : updateData;

  const updated = await prisma.club.update({
    where: { id: clubId },
    data: finalData,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId } = await params;
  const club = await checkClubAccess(clubId, session.user.id, session.user.role);
  if (!club) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
  }

  await prisma.club.delete({ where: { id: clubId } });

  // Delete the Google Calendar (non-blocking)
  if (club.googleCalendarId) {
    deleteCalendar(club.googleCalendarId).catch((err) =>
      console.error("Failed to delete Google Calendar:", err)
    );
  }

  return new NextResponse(null, { status: 204 });
}
