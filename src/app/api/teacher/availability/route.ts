import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

const ALL_ROTATIONS = ["FLEX_1", "FLEX_2", "FLEX_3"] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nextFlexDay = await prisma.flexDay.findFirst({
    where: { date: { gte: today }, isActive: true },
    orderBy: { date: "asc" },
    include: {
      clubSessions: {
        where: { club: { ownerId: session.user.id } },
        select: { rotations: true },
      },
    },
  });

  if (!nextFlexDay) {
    // No upcoming flex day — nothing to schedule, hide the link
    return NextResponse.json({ fullyBooked: true });
  }

  const coveredRotations = new Set(
    nextFlexDay.clubSessions.flatMap((s) => s.rotations)
  );

  const fullyBooked = ALL_ROTATIONS.every((r) => coveredRotations.has(r));

  return NextResponse.json({ fullyBooked });
}
