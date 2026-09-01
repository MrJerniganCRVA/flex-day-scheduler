import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { updateDutyPostSchema } from "@/lib/validations";

/** ADMIN only — see the note in ../route.ts on why this is not left to middleware. */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ dutyPostId: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { dutyPostId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateDutyPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const dutyPost = await prisma.dutyPost.update({
      where: { id: dutyPostId },
      data: parsed.data,
    });
    return NextResponse.json(dutyPost);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json(
          { error: "Duty post not found" },
          { status: 404 }
        );
      }
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A duty post with that name already exists" },
          { status: 409 }
        );
      }
    }
    throw error;
  }
}

/**
 * Permanently remove a duty post.
 *
 * Cascades its assignments, so the record of who covered this post on past Flex
 * Days goes with it. Deactivating (PATCH isActive:false) is the normal retirement
 * path and keeps that history; the UI offers it first. The count of assignments
 * about to be destroyed is returned so the client can say what was lost.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ dutyPostId: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { dutyPostId } = await params;

  const dutyPost = await prisma.dutyPost.findUnique({
    where: { id: dutyPostId },
    select: { id: true, _count: { select: { assignments: true } } },
  });
  if (!dutyPost) {
    return NextResponse.json({ error: "Duty post not found" }, { status: 404 });
  }

  await prisma.dutyPost.delete({ where: { id: dutyPostId } });

  return NextResponse.json({
    ok: true,
    assignmentsRemoved: dutyPost._count.assignments,
  });
}
