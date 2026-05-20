import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import type { RotationSlot } from "@prisma/client";

const bodySchema = z.object({
  rotation: z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await params;
  const userId = session.user.id!;

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { rotation } = parsed.data;

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true, rotations: true },
  });

  if (!clubSession || !clubSession.rotations.includes(rotation)) {
    return NextResponse.json({ error: "Session or rotation not found" }, { status: 404 });
  }

  const existing = await prisma.sessionRotationCoverage.findUnique({
    where: { sessionId_rotation: { sessionId, rotation } },
  });

  if (existing?.primaryTeacherId === userId || existing?.secondaryTeacherId === userId) {
    return NextResponse.json({ error: "Already volunteered for this slot" }, { status: 409 });
  }

  if (!existing || existing.primaryTeacherId === null) {
    const coverage = await prisma.sessionRotationCoverage.upsert({
      where: { sessionId_rotation: { sessionId, rotation } },
      create: { sessionId, rotation, primaryTeacherId: userId },
      update: { primaryTeacherId: userId },
    });
    return NextResponse.json(coverage);
  }

  if (existing.secondaryTeacherId === null) {
    const coverage = await prisma.sessionRotationCoverage.update({
      where: { sessionId_rotation: { sessionId, rotation } },
      data: { secondaryTeacherId: userId },
    });
    return NextResponse.json(coverage);
  }

  return NextResponse.json({ error: "No open spots for this rotation" }, { status: 409 });
}
