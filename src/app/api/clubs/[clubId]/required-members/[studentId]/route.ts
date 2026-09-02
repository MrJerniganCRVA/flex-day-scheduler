import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { isClubManager } from "@/lib/auth-helpers";
import {
  applyCalendarWithdrawals,
  dropFutureForcedSignups,
} from "@/lib/required-members-io";

/**
 * End a student's required membership of a club.
 *
 * Their forced signups on *future* flex days go with it — leaving them behind
 * was the original implementation's worst edge: a student removed from the
 * Yearbook roster stayed locked into every Yearbook session already on the
 * calendar, unable to cancel, because the flag that blocked them had outlived
 * the membership that justified it.
 *
 * Past signups stay. They are attendance history, and rewriting them would
 * change what the register says happened.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string; studentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId, studentId } = await params;

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, ownerId: true, cosponsorId: true },
  });
  if (!club) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isClubManager(club, session.user.id!, session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const member = await prisma.requiredMember.findUnique({
    where: { clubId_studentId: { clubId, studentId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Drop the signups first: if this fails, the membership still stands and the
  // student is still legitimately enrolled, which is a consistent state. The
  // reverse order could leave forced signups nobody can explain or cancel.
  const { removed, calendarOps } = await dropFutureForcedSignups({
    clubId,
    studentId,
  });

  await prisma.requiredMember.delete({
    where: { clubId_studentId: { clubId, studentId } },
  });

  // After the database change, as in the admin roster override: a Google hiccup
  // must not undo a removal the teacher has already been told about.
  await applyCalendarWithdrawals(calendarOps);

  return NextResponse.json({
    ok: true,
    signupsRemoved: removed,
    calendarUpdates: calendarOps.length,
  });
}
