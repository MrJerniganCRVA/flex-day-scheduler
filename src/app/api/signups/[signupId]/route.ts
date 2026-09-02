import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { isPastSignupDeadline } from "@/lib/flex-day-utils";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ signupId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { signupId } = await params;

  const signup = await prisma.signup.findUnique({
    where: { id: signupId },
    include: {
      clubSession: {
        include: {
          flexDay: { select: { date: true } },
        },
      },
    },
  });

  if (!signup) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only the student or an admin can cancel
  if (
    session.user.role !== "ADMIN" &&
    signup.studentId !== session.user.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A forced signup is not the student's to cancel — that is the whole point of
  // a required member. Admins keep their escape hatch through the roster
  // override, which records a reason; teachers end the obligation itself by
  // removing the student from the club's required roster.
  if (signup.forced && session.user.role === "STUDENT") {
    return NextResponse.json(
      {
        error:
          "This club is required for you and can't be cancelled. Talk to the club's teacher.",
      },
      { status: 403 }
    );
  }

  // Enforce deadline for students (admins can override)
  if (
    session.user.role !== "ADMIN" &&
    isPastSignupDeadline(signup.clubSession.flexDay.date)
  ) {
    return NextResponse.json(
      { error: "Signups for this flex day are closed" },
      { status: 403 }
    );
  }

  await prisma.signup.delete({ where: { id: signupId } });

  return new NextResponse(null, { status: 204 });
}
