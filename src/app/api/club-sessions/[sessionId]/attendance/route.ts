import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { bulkAttendanceSchema } from "@/lib/validations";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  const body = await req.json();
  const parsed = bulkAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: {
      flexDay: { select: { date: true } },
      club: { select: { ownerId: true } },
      oneOffOwnerId: true,
    },
  });

  if (!clubSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const isAdmin = session.user.role === "ADMIN";
  const isOwner =
    clubSession.club?.ownerId === session.user.id ||
    clubSession.oneOffOwnerId === session.user.id;
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Allow attendance recording any time during the week of the session (Mon–Sun)
  const flexDayDate = clubSession.flexDay.date;
  const flexLocal = new Date(
    flexDayDate.getUTCFullYear(),
    flexDayDate.getUTCMonth(),
    flexDayDate.getUTCDate()
  );
  const dow = flexLocal.getDay(); // 0=Sun … 6=Sat
  const weekStart = new Date(flexLocal);
  weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  const now = new Date();
  if (now < weekStart || now > weekEnd) {
    return NextResponse.json(
      { error: "Attendance can only be recorded during the week of the session" },
      { status: 403 }
    );
  }

  const { records } = parsed.data;

  await prisma.$transaction(
    records.map((r) =>
      prisma.signup.updateMany({
        where: { id: r.signupId, clubSessionId: sessionId },
        data: { attended: r.attended },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
