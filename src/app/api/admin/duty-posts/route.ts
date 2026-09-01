import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createDutyPostSchema } from "@/lib/validations";

/**
 * Duty posts — the supervision spots that are not clubs.
 *
 * ADMIN only, and the check is written out here rather than relied upon from
 * middleware: `src/proxy.ts` gates *pages* under /admin by role, but its check is
 * `pathname.startsWith("/admin")`, which this path does not match. For an API
 * route the middleware only enforces that the caller is signed in. Every route
 * under /api/admin does its own role check for exactly this reason.
 */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const dutyPosts = await prisma.dutyPost.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(dutyPosts);
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = createDutyPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const dutyPost = await prisma.dutyPost.create({ data: parsed.data });
    return NextResponse.json(dutyPost, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A duty post with that name already exists" },
        { status: 409 }
      );
    }
    throw error;
  }
}
