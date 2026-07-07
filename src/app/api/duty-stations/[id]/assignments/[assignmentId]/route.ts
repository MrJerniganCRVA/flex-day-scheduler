import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; assignmentId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { assignmentId } = await params;

  const assignment = await prisma.dutyStationAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin) {
    if (assignment.adminLocked) {
      return NextResponse.json(
        { error: "This assignment was set by an admin and cannot be removed" },
        { status: 403 }
      );
    }
    if (assignment.teacherId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  await prisma.dutyStationAssignment.delete({ where: { id: assignmentId } });
  return new NextResponse(null, { status: 204 });
}
