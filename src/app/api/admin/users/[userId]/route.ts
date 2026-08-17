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

  const newRole = parsed.data.role;

  // Guard against locking every admin out of the app. The DELETE handler below
  // already blocks self-deletion; the same reasoning applies to demotion, and
  // recovering from a zero-admin state needs direct database access or a
  // SEED_ADMIN_EMAIL container restart.
  if (newRole !== "ADMIN") {
    if (userId === session.user.id) {
      return NextResponse.json(
        {
          error:
            "You cannot remove your own admin access. Ask another admin to change your role.",
        },
        { status: 409 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.role === "ADMIN") {
      const otherAdmins = await prisma.user.count({
        where: { role: "ADMIN", id: { not: userId } },
      });
      if (otherAdmins === 0) {
        return NextResponse.json(
          {
            error:
              "This is the only admin account. Promote another user to admin before changing this one.",
          },
          { status: 409 }
        );
      }
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { role: newRole },
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
              ? `This teacher still owns ${clubCount} club${clubCount === 1 ? "" : "s"}. Reassign each club to another teacher, or set it to "No teacher assigned", before removing them.`
              : "This user can't be removed because other records still reference them.",
        },
        { status: 409 }
      );
    }
    throw error;
  }

  return new NextResponse(null, { status: 204 });
}
