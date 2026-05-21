import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z
  .object({
    rotation: z.enum(["FLEX_1", "FLEX_2", "FLEX_3"]),
    primary: z.string().nullable().optional(),
    secondary: z.string().nullable().optional(),
  })
  .refine((d) => "primary" in d || "secondary" in d, {
    message: "At least one of primary or secondary must be provided",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await params;

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { rotation, primary, secondary } = parsed.data;

  // Fetch session to get flexDayId for conflict checks
  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { flexDayId: true },
  });
  if (!clubSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Verify referenced teachers exist and have an appropriate role;
  // also block assignments that would place a teacher in two sessions in the same rotation
  for (const [field, teacherId] of [
    ["primary", primary],
    ["secondary", secondary],
  ] as const) {
    if (teacherId != null) {
      const teacher = await prisma.user.findUnique({
        where: { id: teacherId },
        select: { role: true },
      });
      if (!teacher) {
        return NextResponse.json(
          { error: `${field} teacher not found` },
          { status: 404 }
        );
      }
      if (teacher.role === "STUDENT") {
        return NextResponse.json(
          { error: `${field} teacher must have role TEACHER or ADMIN` },
          { status: 400 }
        );
      }

      const conflict = await prisma.clubSession.findFirst({
        where: {
          id: { not: sessionId },
          flexDayId: clubSession.flexDayId,
          rotations: { has: rotation },
          OR: [
            { club: { ownerId: teacherId } },
            { oneOffOwnerId: teacherId },
            {
              rotationCoverage: {
                some: {
                  rotation,
                  OR: [{ primaryTeacherId: teacherId }, { secondaryTeacherId: teacherId }],
                },
              },
            },
          ],
        },
        select: { club: { select: { name: true } }, title: true },
      });

      if (conflict) {
        const conflictName = conflict.club?.name ?? conflict.title ?? "another session";
        return NextResponse.json(
          { error: `This teacher is already assigned to "${conflictName}" in ${rotation.replace("_", " ")}` },
          { status: 409 }
        );
      }
    }
  }

  // Build update data from only the fields present in the request body
  const updateData: {
    primaryTeacherId?: string | null;
    secondaryTeacherId?: string | null;
  } = {};
  if ("primary" in parsed.data) updateData.primaryTeacherId = primary ?? null;
  if ("secondary" in parsed.data)
    updateData.secondaryTeacherId = secondary ?? null;

  await prisma.sessionRotationCoverage.upsert({
    where: { sessionId_rotation: { sessionId, rotation } },
    create: {
      sessionId,
      rotation,
      primaryTeacherId: updateData.primaryTeacherId ?? null,
      secondaryTeacherId: updateData.secondaryTeacherId ?? null,
    },
    update: updateData,
  });

  return NextResponse.json({ ok: true });
}
