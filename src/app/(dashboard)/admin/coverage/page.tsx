import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import CoverageDashboard from "@/components/admin/CoverageDashboard";
import type { CoverageClub, CoverageTeacher } from "@/components/admin/CoverageDashboard";
import type { RotationSlot } from "@prisma/client";

export default async function AdminCoveragePage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const nextFlexDay = await prisma.flexDay.findFirst({
    where: { date: { gte: today }, isActive: true },
    orderBy: { date: "asc" },
    include: {
      clubSessions: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              ownerId: true,
              cosponsorId: true,
              owner: { select: { name: true } },
              cosponsor: { select: { name: true } },
              teachers: { select: { teacherId: true } },
            },
          },
          _count: { select: { signups: true } },
          rotationCoverage: {
            select: {
              rotation: true,
              primaryTeacherId: true,
              secondaryTeacherId: true,
            },
          },
        },
      },
    },
  });

  const teacherUsers = await prisma.user.findMany({
    where: { role: { in: ["TEACHER", "ADMIN"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const teachers: CoverageTeacher[] = teacherUsers.map((u) => ({
    id: u.id,
    name: u.name ?? u.id,
  }));

  if (!nextFlexDay) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-2xl font-semibold text-gray-700 dark:text-gray-300">
          No upcoming flex days
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Create an active flex day to manage coverage.
        </p>
      </div>
    );
  }

  const clubs: CoverageClub[] = nextFlexDay.clubSessions
    .filter((cs) => cs.club !== null)
    .map((cs) => ({
    sessionId: cs.id,
    clubId: cs.club!.id,
    name: cs.club!.name,
    // Null for a club with no permanent teacher — T1 then resolves to nothing
    // and the session shows as needing coverage, which is correct.
    ownerId: cs.club!.ownerId,
    ownerName: cs.club!.owner?.name ?? null,
    // A club's cosponsor is its default second teacher. Without this the
    // cosponsor never appeared as T2, showed as fully free (so they could be
    // double-booked into another club in the same rotation), and never received
    // the calendar invite for a club they co-run.
    cosponsorId: cs.club!.cosponsorId,
    cosponsorName: cs.club!.cosponsor?.name ?? null,
    poolTeacherIds: cs.club!.teachers.map((t) => t.teacherId),
    rotations: cs.rotations,
    studentCount: cs._count.signups,
    coverage: Object.fromEntries(
      cs.rotationCoverage.map((rc) => [
        rc.rotation,
        {
          primaryTeacherId: rc.primaryTeacherId,
          secondaryTeacherId: rc.secondaryTeacherId,
        },
      ])
    ) as Partial<
      Record<
        RotationSlot,
        { primaryTeacherId: string | null; secondaryTeacherId: string | null }
      >
    >,
  }));

  const flexDayLabel = nextFlexDay.label
    ? nextFlexDay.label
    : new Date(nextFlexDay.date).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });

  return (
    <CoverageDashboard
      clubs={clubs}
      teachers={teachers}
      flexDayLabel={flexDayLabel}
    />
  );
}
