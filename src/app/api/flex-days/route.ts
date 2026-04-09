import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { createFlexDaySchema } from "@/lib/validations";

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

    // Auto-schedule all existing clubs with their default rotations
    const clubs = await prisma.club.findMany({
      select: { id: true, defaultRotations: true },
    });

    // Create sessions for all clubs that have default rotations
    const sessionPromises = clubs
      .filter((club) => club.defaultRotations && club.defaultRotations.length > 0)
      .map((club) =>
        prisma.clubSession.create({
          data: {
            flexDayId: flexDay.id,
            clubId: club.id,
            rotations: club.defaultRotations,
          },
        })
      );

    await Promise.all(sessionPromises);

    return NextResponse.json(flexDay, { status: 201 });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.includes("Unique constraint")
    ) {
      return NextResponse.json(
        { error: "A Flex Day already exists on this date" },
        { status: 409 }
      );
    }
    throw error;
  }
}
