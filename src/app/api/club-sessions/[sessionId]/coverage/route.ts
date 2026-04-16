import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z
  .object({
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

  const { primary, secondary } = parsed.data;

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

  // Build update only from fields present in the request body
  const updateData: {
    primaryTeacherId?: string | null;
    secondaryTeacherId?: string | null;
  } = {};

  if ("primary" in parsed.data) updateData.primaryTeacherId = primary ?? null;
  if ("secondary" in parsed.data)
    updateData.secondaryTeacherId = secondary ?? null;

  const updated = await prisma.clubSession.update({
    where: { id: sessionId },
    data: updateData,
    select: { id: true },
  });

  if (!updated) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
