import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { isClubManager } from "@/lib/auth-helpers";
import { addRequiredMemberSchema } from "@/lib/validations";
import {
  enrollRequiredMembers,
  RequiredMemberConflictError,
} from "@/lib/required-members-io";

/**
 * A club's required-member roster: the students whose attendance is mandatory.
 *
 * Managed by whoever manages the club — admins, the owner, the cosponsor — via
 * the same `isClubManager` predicate every other club-editing route uses. The
 * original version of this feature checked `club.ownerId` by hand and so locked
 * cosponsors out of a club they otherwise co-own.
 */

const memberSelect = {
  id: true,
  studentId: true,
  createdAt: true,
  student: { select: { id: true, name: true, email: true } },
} as const;

async function authorize(clubId: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, name: true, ownerId: true, cosponsorId: true },
  });
  if (!club) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  if (!isClubManager(club, session.user.id!, session.user.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { club, user: session.user };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const { clubId } = await params;
  const gate = await authorize(clubId);
  if (gate.error) return gate.error;

  const members = await prisma.requiredMember.findMany({
    where: { clubId },
    select: memberSelect,
    orderBy: { student: { name: "asc" } },
  });

  return NextResponse.json(members);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const { clubId } = await params;
  const gate = await authorize(clubId);
  if (gate.error) return gate.error;

  const body = await request.json().catch(() => null);
  const parsed = addRequiredMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { studentId } = parsed.data;

  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { id: true, name: true, role: true },
  });
  if (!student || student.role !== "STUDENT") {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const existing = await prisma.requiredMember.findUnique({
    where: { clubId_studentId: { clubId, studentId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: `${student.name} is already a required member of this club.` },
      { status: 409 }
    );
  }

  const member = await prisma.requiredMember.create({
    data: { clubId, studentId },
    select: memberSelect,
  });

  // Enroll into the club's existing future sessions. Every session created
  // afterwards is covered by the hooks in src/lib/scheduling.ts.
  try {
    const enrollment = await enrollRequiredMembers({
      clubId,
      studentIds: [studentId],
      actor: {
        id: gate.user.id ?? null,
        email: gate.user.email ?? "unknown",
      },
    });
    return NextResponse.json({ member, enrollment }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof RequiredMemberConflictError) {
      // The membership row is rolled back by hand: it is a single row, and
      // wrapping the whole enrollment sweep in one outer transaction to get
      // this for free would hold a Serializable lock across every future flex
      // day of the club for the sake of an error path.
      await prisma.requiredMember.delete({
        where: { clubId_studentId: { clubId, studentId } },
      });
      return NextResponse.json(
        {
          error:
            `${student.name} is already a required member of ${error.otherSessionName}, ` +
            `which runs at the same time. Remove them from that club first.`,
        },
        { status: 409 }
      );
    }
    throw error;
  }
}
