import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { updateUserRoleSchema } from "@/lib/validations";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  const body = await request.json();
  const parsed = updateUserRoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { role: parsed.data.role },
    select: { id: true, name: true, email: true, role: true },
  });

  return NextResponse.json(user);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;

  // Prevent admins from deleting themselves
  if (userId === session.user.id) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    // Club.owner is onDelete: Restrict — a teacher who still owns clubs
    // can't be deleted without silently destroying that club's history.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      const clubCount = await prisma.club.count({ where: { ownerId: userId } });
      return NextResponse.json(
        {
          error:
            clubCount > 0
              ? `This teacher still owns ${clubCount} club${clubCount === 1 ? "" : "s"}. Reassign ownership before removing them.`
              : "This user can't be removed because other records still reference them.",
        },
        { status: 409 }
      );
    }
    throw error;
  }

  return new NextResponse(null, { status: 204 });
}
