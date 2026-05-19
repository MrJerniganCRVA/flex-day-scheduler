import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { isFinalized: true },
  });

  if (!flexDay) {
    return NextResponse.json({ error: "Flex Day not found" }, { status: 404 });
  }

  if (!flexDay.isFinalized) {
    return NextResponse.json(
      { error: "This flex day is not finalized" },
      { status: 409 }
    );
  }

  await prisma.flexDay.update({
    where: { id: flexDayId },
    data: { isFinalized: false },
  });

  return NextResponse.json({ unfinalized: true });
}
