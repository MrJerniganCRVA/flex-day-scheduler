import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import {
  buildExportRows,
  exportFilename,
  toCsv,
  type ExportStudent,
} from "@/lib/csv-export";

/**
 * GET /api/admin/flex-days/[flexDayId]/export — roster CSV for one Flex Day.
 *
 * The contingency plan for the app being unavailable on a Flex Day morning.
 * An admin downloads this ahead of time and it stands on its own: one row per
 * student, their club for each rotation, no app required to read it.
 *
 * Admin-only. It is the whole student roster with email addresses attached, so
 * it stays behind the same gate as the rest of /api/admin.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true, date: true },
  });
  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  // Driven from signups rather than from users: a student with nothing booked
  // has no row, and every row is a real placement someone has to act on.
  // Ordered by email so re-exporting the same day produces the same file, which
  // makes two downloads diffable.
  const signups = await prisma.signup.findMany({
    where: { clubSession: { flexDayId } },
    select: {
      student: { select: { email: true } },
      clubSession: {
        select: {
          rotations: true,
          title: true,
          club: { select: { name: true } },
        },
      },
    },
    orderBy: [{ student: { email: "asc" } }],
  });

  const byEmail = new Map<string, ExportStudent>();
  for (const signup of signups) {
    const email = signup.student.email;
    const student = byEmail.get(email) ?? { email, signups: [] };
    student.signups.push({
      rotations: signup.clubSession.rotations,
      // Same precedence as every other display of a session name: a title only
      // exists on one-off sessions, which have no club to name them.
      sessionName:
        signup.clubSession.title ?? signup.clubSession.club?.name ?? "Session",
    });
    byEmail.set(email, student);
  }

  const csv = toCsv(buildExportRows([...byEmail.values()]));

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(flexDay.date)}"`,
      // A stale roster is worse than a slow one — this is the file staff act
      // on when nothing else is available.
      "Cache-Control": "no-store",
    },
  });
}
