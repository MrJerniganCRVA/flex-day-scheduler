import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createRoomSchema } from "@/lib/validations";

/**
 * GET /api/admin/rooms
 * List all rooms with optional filter for inactive rooms
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get("includeInactive") === "true";

  const rooms = await prisma.room.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          clubsWithDefault: true,
          sessionOverrides: true,
        },
      },
    },
  });

  return NextResponse.json(rooms);
}

/**
 * POST /api/admin/rooms
 * Create a new room
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createRoomSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, capacity } = parsed.data;

  // Check if room name already exists
  const existing = await prisma.room.findUnique({
    where: { name },
  });

  if (existing) {
    return NextResponse.json(
      { error: "A room with this name already exists" },
      { status: 409 }
    );
  }

  const room = await prisma.room.create({
    data: {
      name,
      capacity,
    },
  });

  return NextResponse.json(room, { status: 201 });
}
