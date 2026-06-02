import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/rooms?excludeClubId=<id>&all=true
 * Returns rooms not already claimed as default by another club.
 * Accessible to TEACHER and ADMIN.
 * Pass excludeClubId when editing a club so that club's own room still appears.
 * Pass all=true (admin only) to return every room regardless of default status.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const excludeClubId = searchParams.get("excludeClubId");
  const showAll = searchParams.get("all") === "true" && session.user.role === "ADMIN";

  if (showAll) {
    const rooms = await prisma.room.findMany({
      select: { id: true, name: true, capacity: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(rooms);
  }

  const rooms = await prisma.room.findMany({
    where: {
      clubsWithDefault: {
        none: excludeClubId ? { id: { not: excludeClubId } } : {},
      },
    },
    select: { id: true, name: true, capacity: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(rooms);
}
