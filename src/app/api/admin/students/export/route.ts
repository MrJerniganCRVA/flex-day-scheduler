import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import {
  buildStudentRosterRows,
  studentRosterFilename,
  toStudentRosterCsv,
  type StudentRosterStudent,
} from "@/lib/student-roster-export";

/**
 * GET /api/admin/students/export — every student the app knows about.
 *
 * The reconciliation file. An admin diffs its `email` column against the
 * school's master student list in a spreadsheet; anyone in the master list but
 * missing here has never signed in, so the app has no way to notice them and no
 * way to auto-assign them. See src/lib/student-roster-export.ts.
 *
 * Optional ?flexDayId= reports signup status against a specific Flex Day;
 * without it, the next upcoming active one.
 *
 * Admin-only. This is the entire student body with email addresses attached, so
 * it stays behind the same gate as the rest of /api/admin.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const flexDayId = req.nextUrl.searchParams.get("flexDayId");

  let flexDay: { id: string; date: Date } | null;
  if (flexDayId) {
    flexDay = await prisma.flexDay.findUnique({
      where: { id: flexDayId },
      select: { id: true, date: true },
    });
    if (!flexDay) {
      return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
    }
  } else {
    // Same "next upcoming day" query as the admin students tab and the three
    // dashboards. UTC midnight matters: FlexDay.date is a @db.Date, so a local
    // midnight would drop today's day west of UTC.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    flexDay = await prisma.flexDay.findFirst({
      where: { date: { gte: today }, isActive: true },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    });
  }

  // Driven from students rather than from signups — the exact inverse of the
  // Flex Day roster export, and the whole reason this endpoint exists. A student
  // with nothing booked is not an empty row here, it is the row that matters.
  //
  // Two branches rather than one query with a conditional `select` spread: the
  // spread widens Prisma's inferred row type to a full Signup and loses the
  // nested clubSession entirely.
  const students: StudentRosterStudent[] = flexDay
    ? (
        await prisma.user.findMany({
          where: { role: "STUDENT" },
          select: {
            name: true,
            email: true,
            signups: {
              where: { clubSession: { flexDayId: flexDay.id } },
              select: { clubSession: { select: { rotations: true } } },
            },
          },
        })
      ).map((student) => ({
        name: student.name,
        email: student.email,
        signups: student.signups.map((signup) => ({
          rotations: signup.clubSession.rotations,
        })),
      }))
    : (
        await prisma.user.findMany({
          where: { role: "STUDENT" },
          select: { name: true, email: true },
        })
      ).map((student) => ({ ...student, signups: [] }));

  const rows = buildStudentRosterRows(students, {
    hasFlexDay: flexDay !== null,
  });

  return new NextResponse(toStudentRosterCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${studentRosterFilename(
        flexDay?.date ?? null
      )}"`,
      // Chasing students against a stale roster wastes the email of whoever
      // signed up ten minutes ago.
      "Cache-Control": "no-store",
    },
  });
}
