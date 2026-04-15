import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createSignupSchema } from "@/lib/validations";
import { addAttendeeToEvent } from "@/lib/google-calendar";
import { isPastSignupDeadline } from "@/lib/flex-day-utils";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Only students can sign up for clubs
  if (session.user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can sign up for clubs" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = createSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { clubSessionId } = parsed.data;
  const studentId = session.user.id;

  try {
    const signup = await prisma.$transaction(async (tx) => {
      const targetSession = await tx.clubSession.findUnique({
        where: { id: clubSessionId },
        include: {
          club: { select: { maxCapacity: true, googleCalendarId: true } },
          flexDay: { select: { id: true, date: true } },
        },
      });

      if (!targetSession) {
        throw Object.assign(new Error("SESSION_NOT_FOUND"), { status: 404 });
      }

      // Check signup deadline
      if (isPastSignupDeadline(targetSession.flexDay.date)) {
        throw Object.assign(new Error("SIGNUPS_CLOSED"), { status: 403 });
      }

      // Check capacity
      const currentCount = await tx.signup.count({
        where: { clubSessionId },
      });
      if (currentCount >= targetSession.club.maxCapacity) {
        throw Object.assign(new Error("CAPACITY_FULL"), { status: 409 });
      }

      // Check for rotation conflicts on the same flex day
      const existingSignups = await tx.signup.findMany({
        where: {
          studentId,
          clubSession: { flexDayId: targetSession.flexDay.id },
        },
        include: { clubSession: { select: { rotations: true } } },
      });

      const occupiedRotations = existingSignups.flatMap(
        (s) => s.clubSession.rotations
      );
      const conflicts = targetSession.rotations.filter((r) =>
        occupiedRotations.includes(r)
      );

      if (conflicts.length > 0) {
        throw Object.assign(new Error("ROTATION_CONFLICT"), {
          status: 409,
          rotations: conflicts,
        });
      }

      return tx.signup.create({
        data: { studentId, clubSessionId },
        include: {
          clubSession: {
            include: {
              club: {
                select: { name: true, googleCalendarId: true },
              },
              flexDay: { select: { date: true } },
            },
          },
        },
      });
    });

    // Add to Google Calendar (non-blocking)
    const cs = signup.clubSession;
    if (cs.club.googleCalendarId && cs.googleEventId && session.user.email) {
      addAttendeeToEvent({
        calendarId: cs.club.googleCalendarId,
        eventId: cs.googleEventId,
        studentEmail: session.user.email,
      }).catch((err) =>
        console.error("Failed to add attendee to Google Calendar:", err)
      );
    }

    return NextResponse.json(signup, { status: 201 });
  } catch (error: unknown) {
    const err = error as Error & { status?: number; rotations?: string[] };
    if (err.message === "SESSION_NOT_FOUND") {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (err.message === "SIGNUPS_CLOSED") {
      return NextResponse.json(
        { error: "Signups for this flex day are closed" },
        { status: 403 }
      );
    }
    if (err.message === "CAPACITY_FULL") {
      return NextResponse.json(
        { error: "This club is full" },
        { status: 409 }
      );
    }
    if (err.message === "ROTATION_CONFLICT") {
      return NextResponse.json(
        {
          error: "You are already signed up for a club in this rotation",
          conflicts: err.rotations,
        },
        { status: 409 }
      );
    }
    // Unique constraint = already signed up for this exact session
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "You are already signed up for this session" },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const signups = await prisma.signup.findMany({
    where: { studentId: session.user.id },
    include: {
      clubSession: {
        include: {
          club: { select: { id: true, name: true } },
          flexDay: { select: { id: true, date: true, label: true } },
        },
      },
    },
    orderBy: { clubSession: { flexDay: { date: "asc" } } },
  });

  return NextResponse.json(signups);
}
