import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import type { RotationSlot } from "@prisma/client";

const bodySchema = z.object({
  flexDayId: z.string().cuid(),
  rotation: z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]),
  type: z.enum(["PRESENT", "ABSENT", "REASSIGNED"]),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = session.user.id!;

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { flexDayId, rotation, type } = parsed.data;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true },
  });
  if (!flexDay) {
    return NextResponse.json({ error: "Flex day not found" }, { status: 404 });
  }

  if (type === "PRESENT") {
    await prisma.teacherFlexDayAbsence.deleteMany({
      where: { userId, flexDayId, rotation },
    });
  } else {
    await prisma.teacherFlexDayAbsence.upsert({
      where: { userId_flexDayId_rotation: { userId, flexDayId, rotation } },
      create: { userId, flexDayId, rotation, type },
      update: { type },
    });
  }

  return NextResponse.json({ ok: true });
}
