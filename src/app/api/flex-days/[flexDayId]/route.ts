import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateFlexDaySchema } from "@/lib/validations";
import { deleteEvent, getOneOffCalendarId } from "@/lib/google-calendar";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    include: {
      clubSessions: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              description: true,
              maxCapacity: true,
              owner: { select: { name: true } },
            },
          },
          _count: { select: { signups: true } },
          signups:
            session.user.role === "STUDENT"
              ? { where: { studentId: session.user.id }, select: { id: true } }
              : false,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!flexDay) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(flexDay);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;
  const body = await request.json();
  const parsed = updateFlexDaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const flexDay = await prisma.flexDay.update({
    where: { id: flexDayId },
    data: parsed.data,
  });

  return NextResponse.json(flexDay);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;

  // Collect the calendar events *before* deleting. Deleting a FlexDay cascades
  // its ClubSessions away, which takes the googleEventId values with them — so
  // after the delete there is no record of which events to clean up, and every
  // student is left holding an invite for a day that no longer exists.
  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: {
      id: true,
      clubSessions: {
        where: { googleEventId: { not: null } },
        select: {
          googleEventId: true,
          clubId: true,
          club: { select: { googleCalendarId: true } },
        },
      },
    },
  });

  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  // One-off sessions live on the shared host calendar. Read it without creating
  // one — if none was ever provisioned there are no one-off events to remove.
  const hasOneOffEvents = flexDay.clubSessions.some((cs) => cs.clubId === null);
  const oneOffCalendarId = hasOneOffEvents ? await getOneOffCalendarId() : null;

  const eventsToDelete = flexDay.clubSessions
    .map((cs) => ({
      calendarId:
        cs.clubId === null ? oneOffCalendarId : cs.club?.googleCalendarId ?? null,
      eventId: cs.googleEventId!,
    }))
    .filter(
      (e): e is { calendarId: string; eventId: string } => e.calendarId !== null
    );

  await prisma.flexDay.delete({ where: { id: flexDayId } });

  // Non-blocking, matching how every other delete path treats calendar cleanup:
  // the database is the source of truth and the row is already gone.
  for (const { calendarId, eventId } of eventsToDelete) {
    deleteEvent(calendarId, eventId).catch((err) =>
      console.error(
        `Failed to delete calendar event ${eventId} while deleting flex day ${flexDayId}:`,
        err
      )
    );
  }

  return new NextResponse(null, { status: 204 });
}
