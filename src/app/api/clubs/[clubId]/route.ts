import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateClubSchema } from "@/lib/validations";
import { deleteCalendar } from "@/lib/google-calendar";

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

  const updated = await prisma.club.update({
    where: { id: clubId },
    data: parsed.data,
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
