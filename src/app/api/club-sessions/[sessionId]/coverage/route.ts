import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

/**
 * Three distinct things can be said about each slot, so the wire format carries
 * three states for both. The id fields keep their existing meanings and the
 * `*Cleared` flags add the one that was missing:
 *
 *   primary: "<id>"          assign that teacher
 *   primary: null            fall back to the club's owner (unchanged)
 *   primaryCleared: true     explicitly nobody — suppress the fallback
 *
 *   secondary: "<id>"        assign that teacher
 *   secondary: null          fall back to the club's cosponsor (unchanged)
 *   secondaryCleared: true   explicitly nobody — suppress the fallback
 *
 * T1 gained its third state late: without it, `primary: null` was accepted and
 * stored faithfully, then overwritten by the owner fallback on the next read, so
 * the Coverage page reported a save that had no visible effect.
 */
const patchSchema = z
  .object({
    rotation: z.enum(["FLEX_1", "FLEX_2", "FLEX_3"]),
    primary: z.string().nullable().optional(),
    primaryCleared: z.boolean().optional(),
    secondary: z.string().nullable().optional(),
    secondaryCleared: z.boolean().optional(),
  })
  .refine(
    (d) =>
      "primary" in d ||
      "primaryCleared" in d ||
      "secondary" in d ||
      "secondaryCleared" in d,
    {
      message:
        "At least one of primary, primaryCleared, secondary or secondaryCleared must be provided",
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

  const { rotation, primary, primaryCleared, secondary, secondaryCleared } =
    parsed.data;

  // A bogus sessionId used to reach the upsert and fail on the foreign key,
  // surfacing as a 500. It is a missing session, so say so.
  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!clubSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

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
    primaryCleared?: boolean;
    secondaryTeacherId?: string | null;
    secondaryCleared?: boolean;
  } = {};
  if ("primary" in parsed.data) {
    updateData.primaryTeacherId = primary ?? null;
    // Naming a teacher, or reverting to the owner default, both mean the slot is
    // no longer deliberately empty.
    updateData.primaryCleared = false;
  }

  // An explicit clear wins over `primary` in the same request: nobody is
  // assigned, and the owner fallback stays suppressed.
  if ("primaryCleared" in parsed.data) {
    updateData.primaryCleared = primaryCleared;
    if (primaryCleared) updateData.primaryTeacherId = null;
  }

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
      primaryCleared: updateData.primaryCleared ?? false,
      secondaryTeacherId: updateData.secondaryTeacherId ?? null,
      secondaryCleared: updateData.secondaryCleared ?? false,
    },
    update: updateData,
  });

  return NextResponse.json({ ok: true });
}
