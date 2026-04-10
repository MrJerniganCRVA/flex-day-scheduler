import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { updateFlexDaySchema } from "@/lib/validations";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    include: {
      clubSessions: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              description: true,
              maxCapacity: true,
              owner: { select: { name: true } },
            },
          },
          _count: { select: { signups: true } },
          signups:
            session.user.role === "STUDENT"
              ? { where: { studentId: session.user.id }, select: { id: true } }
              : false,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!flexDay) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(flexDay);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;
  const body = await request.json();
  const parsed = updateFlexDaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const flexDay = await prisma.flexDay.update({
    where: { id: flexDayId },
    data: parsed.data,
  });

  return NextResponse.json(flexDay);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;

  await prisma.flexDay.delete({ where: { id: flexDayId } });

  return new NextResponse(null, { status: 204 });
}
