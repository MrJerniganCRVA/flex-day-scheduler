import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

const bodySchema = z.object({ studentId: z.string().cuid() });

async function checkAccess(clubId: string, userId: string, role: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) return null;
  if (role !== "ADMIN" && club.ownerId !== userId) return null;
  return club;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId } = await params;
  const club = await checkAccess(clubId, session.user.id!, session.user.role);
  if (!club) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
  }

  const members = await prisma.clubMember.findMany({
    where: { clubId },
    include: { student: { select: { id: true, name: true, email: true } } },
    orderBy: { student: { name: "asc" } },
  });

  return NextResponse.json(members);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId } = await params;
  const club = await checkAccess(clubId, session.user.id!, session.user.role);
  if (!club) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { studentId } = parsed.data;

  // Validate student exists and is a STUDENT
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { id: true, role: true, name: true, email: true },
  });
  if (!student || student.role !== "STUDENT") {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Check for duplicate
  const existing = await prisma.clubMember.findUnique({
    where: { clubId_studentId: { clubId, studentId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Student is already a required member" }, { status: 409 });
  }

  // Create the membership record
  const member = await prisma.clubMember.create({
    data: { clubId, studentId },
    include: { student: { select: { id: true, name: true, email: true } } },
  });

  // Auto-enroll in all future non-finalized sessions for this club
  const futureSessions = await prisma.clubSession.findMany({
    where: {
      clubId,
      flexDay: { isFinalized: false, date: { gte: new Date() } },
    },
    select: { id: true },
  });

  let signupsCreated = 0;
  if (futureSessions.length > 0) {
    const result = await prisma.signup.createMany({
      data: futureSessions.map((s) => ({
        studentId,
        clubSessionId: s.id,
        forced: true,
      })),
      skipDuplicates: true,
    });
    signupsCreated = result.count;
  }

  return NextResponse.json({ member, signupsCreated }, { status: 201 });
}
