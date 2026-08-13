import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createFlexDaySchema } from "@/lib/validations";
import { createAutoScheduledSessions } from "@/lib/scheduling";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const flexDays = await prisma.flexDay.findMany({
    where: { isActive: true },
    include: {
      clubSessions: {
        include: {
          club: { select: { name: true, maxCapacity: true } },
          _count: { select: { signups: true } },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  return NextResponse.json(flexDays);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createFlexDaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { date, label } = parsed.data;
  const dateObj = new Date(`${date}T00:00:00.000Z`);

  try {
    const flexDay = await prisma.flexDay.create({
      data: { date: dateObj, label },
    });

    // Auto-schedule all existing clubs with their default rotations. No
    // calendar events are created here — that happens when an admin
    // finalizes this specific Flex Day.
    const clubs = await prisma.club.findMany({
      select: { id: true, defaultRotations: true, linkedRotations: true },
    });

    const eligibleClubs = clubs.filter(
      (club) => club.defaultRotations && club.defaultRotations.length > 0
    );

    await Promise.all(
      eligibleClubs.map((club) => createAutoScheduledSessions(club, flexDay.id))
    );

    return NextResponse.json(flexDay, { status: 201 });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A Flex Day already exists on this date" },
        { status: 409 }
      );
    }
    throw error;
  }
}
