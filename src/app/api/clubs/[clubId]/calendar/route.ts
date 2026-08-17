import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { isClubManager } from "@/lib/auth-helpers";
import { createCalendarForClub } from "@/lib/google-calendar";

/**
 * POST /api/clubs/[clubId]/calendar
 *
 * Repair path for a club whose Google Calendar was never created. Club creation
 * treats a Calendar API failure as non-fatal (the club is still usable for
 * signups), but the result was a club that finalize silently skipped forever:
 * no calendar meant no event, so nobody on its roster ever got an invite and
 * nothing said so. This provisions the missing calendar so the day can be
 * re-sent.
 *
 * Idempotent: a club that already has a calendar returns 200 unchanged rather
 * than creating a second one and orphaning the first.
 */
export async function POST(
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
    select: { id: true, name: true, ownerId: true, cosponsorId: true, googleCalendarId: true },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }

  if (!isClubManager(club, session.user.id, session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (club.googleCalendarId) {
    return NextResponse.json({
      googleCalendarId: club.googleCalendarId,
      created: false,
    });
  }

  let calendarId: string;
  try {
    calendarId = await createCalendarForClub(club.name);
  } catch (err) {
    console.error(`Calendar setup retry failed for club ${club.id}:`, err);
    return NextResponse.json(
      {
        error:
          "Google Calendar could not be reached. Check the service account credentials and try again.",
      },
      { status: 502 }
    );
  }

  await prisma.club.update({
    where: { id: club.id },
    data: { googleCalendarId: calendarId },
  });

  return NextResponse.json({ googleCalendarId: calendarId, created: true });
}
