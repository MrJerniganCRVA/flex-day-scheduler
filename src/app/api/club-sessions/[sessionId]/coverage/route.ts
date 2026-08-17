import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

/**
 * Three distinct things can be said about T2, so the wire format has to carry
 * three states. `secondary` keeps its existing meanings and `secondaryCleared`
 * adds the one that was missing:
 *
 *   secondary: "<id>"        assign that teacher
 *   secondary: null          fall back to the club's cosponsor (unchanged)
 *   secondaryCleared: true   explicitly nobody — suppress the fallback
 */
const patchSchema = z
  .object({
    rotation: z.enum(["FLEX_1", "FLEX_2", "FLEX_3"]),
    primary: z.string().nullable().optional(),
    secondary: z.string().nullable().optional(),
    secondaryCleared: z.boolean().optional(),
  })
  .refine(
    (d) => "primary" in d || "secondary" in d || "secondaryCleared" in d,
    {
      message:
        "At least one of primary, secondary or secondaryCleared must be provided",
    }
  );

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

  const { rotation, primary, secondary, secondaryCleared } = parsed.data;

  // Verify referenced teachers exist and have an appropriate role
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
    }
  }

  // Build update data from only the fields present in the request body, so
  // touching T1 never disturbs T2 (or its cleared flag) and vice versa.
  const updateData: {
    primaryTeacherId?: string | null;
    secondaryTeacherId?: string | null;
    secondaryCleared?: boolean;
  } = {};
  if ("primary" in parsed.data) updateData.primaryTeacherId = primary ?? null;

  if ("secondary" in parsed.data) {
    updateData.secondaryTeacherId = secondary ?? null;
    // Naming a teacher, or reverting to the cosponsor default, both mean the slot
    // is no longer deliberately empty.
    updateData.secondaryCleared = false;
  }

  // An explicit clear wins over `secondary` in the same request: nobody is
  // assigned, and the cosponsor fallback stays suppressed.
  if ("secondaryCleared" in parsed.data) {
    updateData.secondaryCleared = secondaryCleared;
    if (secondaryCleared) updateData.secondaryTeacherId = null;
  }

  await prisma.sessionRotationCoverage.upsert({
    where: { sessionId_rotation: { sessionId, rotation } },
    create: {
      sessionId,
      rotation,
      primaryTeacherId: updateData.primaryTeacherId ?? null,
      secondaryTeacherId: updateData.secondaryTeacherId ?? null,
      secondaryCleared: updateData.secondaryCleared ?? false,
    },
    update: updateData,
  });

  return NextResponse.json({ ok: true });
}
