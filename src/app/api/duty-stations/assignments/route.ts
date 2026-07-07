import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const flexDayId = req.nextUrl.searchParams.get("flexDayId");
  if (!flexDayId) {
    return NextResponse.json({ error: "flexDayId required" }, { status: 400 });
  }

  const assignments = await prisma.dutyStationAssignment.findMany({
    where: { flexDayId },
    include: {
      dutyStation: { select: { id: true, name: true, location: true, maxTeachers: true } },
      teacher: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(assignments);
}
