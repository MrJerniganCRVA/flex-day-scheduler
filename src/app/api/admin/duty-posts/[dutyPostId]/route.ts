import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { updateDutyPostSchema } from "@/lib/validations";
import { deleteEvent } from "@/lib/google-calendar";
import { makeClientCache } from "@/lib/calendar-sender";
import { rotationName } from "@/lib/session-event";

/** ADMIN only — see the note in ../route.ts on why this is not left to middleware. */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ dutyPostId: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { dutyPostId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateDutyPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const dutyPost = await prisma.dutyPost.update({
      where: { id: dutyPostId },
      data: parsed.data,
    });
    return NextResponse.json(dutyPost);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json(
          { error: "Duty post not found" },
          { status: 404 }
        );
      }
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A duty post with that name already exists" },
          { status: 409 }
        );
      }
    }
    throw error;
  }
}

/**
 * Permanently remove a duty post.
 *
 * Cascades its assignments, so the record of who covered this post on past Flex
 * Days goes with it. Deactivating (PATCH isActive:false) is the normal retirement
 * path and keeps that history; the UI offers it first. The count of assignments
 * about to be destroyed is returned so the client can say what was lost.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ dutyPostId: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { dutyPostId } = await params;

  const dutyPost = await prisma.dutyPost.findUnique({
    where: { id: dutyPostId },
    select: {
      id: true,
      name: true,
      _count: { select: { assignments: true } },
      // Read *before* the delete. Deleting a post cascades its assignments and
      // those cascade their DutyCalendarEvent rows, and after that there is no
      // record of which events to cancel — leaving every teacher who was staffing
      // it holding an invite to a post that no longer exists. Same ordering
      // src/lib/session-calendar.ts documents for sessions.
      assignments: {
        select: {
          rotation: true,
          calendarEvent: { select: { googleEventId: true, ownerId: true } },
        },
      },
    },
  });
  if (!dutyPost) {
    return NextResponse.json({ error: "Duty post not found" }, { status: 404 });
  }

  const liveEvents = dutyPost.assignments.flatMap((a) =>
    a.calendarEvent
      ? [{ rotation: a.rotation, ...a.calendarEvent }]
      : []
  );

  await prisma.dutyPost.delete({ where: { id: dutyPostId } });

  // After the delete, and never thrown from: the post is already gone, and the
  // calendar is a copy of a decision made in the database. A failure is logged
  // with the event id so it can be removed by hand.
  if (liveEvents.length > 0) {
    const clientFor = makeClientCache();
    for (const event of liveEvents) {
      const label = `${dutyPost.name} duty — ${rotationName(event.rotation)}`;
      const calendar = event.ownerId ? await clientFor(event.ownerId) : null;
      if (!calendar) {
        console.error(
          `Cannot cancel the ${label} event ${event.googleEventId} after deleting the post: nobody can send from its calendar any more, so it may linger there.`
        );
        continue;
      }
      await deleteEvent(calendar, event.googleEventId, "all").catch((err) =>
        console.error(
          `Failed to cancel the ${label} event ${event.googleEventId} after deleting the post:`,
          err
        )
      );
    }
  }

  return NextResponse.json({
    ok: true,
    assignmentsRemoved: dutyPost._count.assignments,
    eventsWithdrawn: liveEvents.length,
  });
}
