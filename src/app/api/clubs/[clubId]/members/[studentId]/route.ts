import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

async function checkAccess(clubId: string, userId: string, role: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) return null;
  if (role !== "ADMIN" && club.ownerId !== userId) return null;
  return club;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clubId: string; studentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clubId, studentId } = await params;
  const club = await checkAccess(clubId, session.user.id!, session.user.role);
  if (!club) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
  }

  const member = await prisma.clubMember.findUnique({
    where: { clubId_studentId: { clubId, studentId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  await prisma.clubMember.delete({
    where: { clubId_studentId: { clubId, studentId } },
  });

  return new NextResponse(null, { status: 204 });
}
