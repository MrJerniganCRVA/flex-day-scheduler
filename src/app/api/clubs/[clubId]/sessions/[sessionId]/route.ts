import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateClubSessionSchema } from "@/lib/validations";
import { deleteEvent } from "@/lib/google-calendar";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string; sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: {
      flexDay: { select: { id: true, date: true, label: true } },
      club: {
        select: { id: true, name: true, maxCapacity: true, location: true },
      },
      _count: { select: { signups: true } },
      signups:
        session.user.role !== "STUDENT"
          ? {
              include: {
                student: { select: { id: true, name: true, email: true } },
              },
            }
          : { where: { studentId: session.user.id }, select: { id: true } },
    },
  });

  if (!clubSession) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(clubSession);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clubId: string; sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId, sessionId } = await params;

  // Verify access: owner or admin
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (session.user.role !== "ADMIN" && club.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateClubSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Build update data - only include fields that were provided
  const updateData: any = {};
  if (parsed.data.rotations) {
    updateData.rotations = parsed.data.rotations;
  }
  if (parsed.data.locationOverride !== undefined) {
    updateData.locationOverride = parsed.data.locationOverride || null;
  }

  const updatedSession = await prisma.clubSession.update({
    where: { id: sessionId },
    data: updateData,
    include: {
      flexDay: { select: { date: true, label: true } },
      club: { select: { name: true } },
    },
  });

  return NextResponse.json(updatedSession);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string; sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId, sessionId } = await params;

  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (session.user.role !== "ADMIN" && club.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
  });
  if (!clubSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await prisma.clubSession.delete({ where: { id: sessionId } });

  // Delete Google Calendar event (non-blocking)
  if (club.googleCalendarId && clubSession.googleEventId) {
    deleteEvent(club.googleCalendarId, clubSession.googleEventId).catch((err) =>
      console.error("Failed to delete Google Calendar event:", err)
    );
  }

  return new NextResponse(null, { status: 204 });
}
