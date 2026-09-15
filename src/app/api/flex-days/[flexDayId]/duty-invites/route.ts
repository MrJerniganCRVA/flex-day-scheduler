import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import {
  describeProblems,
  isFailed,
  isSent,
  isSkipped,
} from "@/lib/calendar-outcome";
import { makeBackstop, makeClientCache } from "@/lib/calendar-sender";
import { sendDutyInvites } from "@/lib/duty-calendar";

/**
 * Send (or re-send) just this Flex Day's duty invites.
 *
 * Finalizing already does this as its second pass, so this route exists for one
 * specific situation: a day that was **already finalized** before duty posts had
 * calendar events at all, or one where an assignment changed after the invites
 * went out. Those days need their duty events without their students being
 * touched, and re-finalizing is not a safe way to get there.
 *
 * Why not just unfinalize and re-finalize? `POST ../unfinalize` only flips the
 * flag — every `SessionCalendarEvent` row survives — so a re-finalize *patches*
 * each session event, and with identical text and attendees that is normally a
 * no-op to Google. But where a block's sender has changed in the meantime, and a
 * lapsed or revoked OAuth grant is enough to change it, the finalize route
 * deletes the old event with `sendUpdates: "all"` and creates a new one with
 * `sendUpdates: "all"`. That is a cancellation *and* a fresh invite to every
 * student in that session, for a day where nothing about the students changed.
 *
 * This route cannot do that to anybody. `sendDutyInvites` reads `DutyAssignment`
 * and writes `DutyCalendarEvent`; it never opens a session's event, so there is
 * no path from here to a student's mailbox.
 *
 * Two deliberate differences from finalize: it does not require the day to be
 * unfinalized, and it never touches `isFinalized`. Running it is idempotent —
 * every assignment either patches the event it has or creates the one it is
 * missing — so pressing the button twice costs a few API calls and changes
 * nothing.
 *
 * ADMIN only, checked here rather than left to middleware: `src/proxy.ts` gates
 * pages under /admin by role but an /api path does not match that check.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actorId = session.user.id;

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true },
  });
  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  const clientFor = makeClientCache();
  const blocks = await sendDutyInvites({
    flexDayId,
    clientFor,
    getBackstop: makeBackstop(actorId, clientFor),
  });

  const sent = blocks.filter(isSent);
  const failed = blocks.filter(isFailed);
  const skipped = blocks.filter(isSkipped);

  for (const f of failed) {
    console.error(`Failed to send the duty invite for ${f.label}:`, f.error);
  }

  // No refusal-to-finalize equivalent here: this route changes no state of the
  // day, so there is nothing that could go misleadingly green. A day with no
  // duty posts at all is a perfectly ordinary success that sent nothing, and the
  // counts below say so.
  return NextResponse.json({
    dutyBlocks: blocks.length,
    sessionsSent: sent.length,
    sessionsFailed: failed.length,
    sessionsSkipped: skipped.length,
    problems: describeProblems(blocks),
  });
}
