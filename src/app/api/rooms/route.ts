import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { getDefaultRoomConflictIds, getOccupiedRoomIds } from "@/lib/scheduling";
import type { RotationSlot } from "@prisma/client";

const VALID_ROTATIONS = new Set<string>(["FLEX_1", "FLEX_2", "FLEX_3"]);

/**
 * GET /api/rooms?rotations=FLEX_1&rotations=FLEX_2&flexDayId=<id>&excludeClubId=<id>&excludeSessionId=<id>
 *
 * Returns active rooms available for the given rotation(s):
 * - flexDayId given: excludes rooms occupied by another ClubSession on that
 *   same day whose rotations overlap (session-level, precise availability).
 * - rotations given without flexDayId: excludes rooms claimed as another
 *   club's default room whose default rotations overlap (day-agnostic
 *   template check, used while picking a club's recurring default room).
 * - neither given: returns all active rooms unfiltered.
 *
 * excludeClubId/excludeSessionId let the club/session being edited keep
 * seeing its own currently-assigned room in the list.
 * Accessible to TEACHER and ADMIN.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const excludeClubId = searchParams.get("excludeClubId") ?? undefined;
  const excludeSessionId = searchParams.get("excludeSessionId") ?? undefined;
  const flexDayId = searchParams.get("flexDayId") ?? undefined;
  const rotations = searchParams
    .getAll("rotations")
    .filter((r): r is RotationSlot => VALID_ROTATIONS.has(r));

  let excludedRoomIds: Set<string> = new Set();
  if (flexDayId && rotations.length > 0) {
    excludedRoomIds = await getOccupiedRoomIds({
      flexDayId,
      rotations,
      excludeSessionId,
    });
  } else if (rotations.length > 0) {
    excludedRoomIds = await getDefaultRoomConflictIds({
      rotations,
      excludeClubId,
    });
  }

  const rooms = await prisma.room.findMany({
    where: { isActive: true },
    select: { id: true, name: true, capacity: true },
    orderBy: { name: "asc" },
  });

  const available = rooms.filter((r) => !excludedRoomIds.has(r.id));

  return NextResponse.json(available);
}
