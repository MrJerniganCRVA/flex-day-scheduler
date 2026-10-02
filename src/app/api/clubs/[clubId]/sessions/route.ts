import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { isClubManager } from "@/lib/auth-helpers";

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
    select: { ownerId: true, cosponsorId: true },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (!isClubManager(club, session.user.id, session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessions = await prisma.clubSession.findMany({
    where: { clubId },
    include: {
      flexDay: { select: { id: true, date: true, label: true } },
      _count: { select: { signups: true } },
    },
    orderBy: { flexDay: { date: "asc" } },
  });

  return NextResponse.json(sessions);
}
