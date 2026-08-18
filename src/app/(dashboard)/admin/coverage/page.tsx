import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import CoverageDashboard from "@/components/admin/CoverageDashboard";
import type {
  CoverageClub,
  CoverageTeacher,
  ResolvedAssignment,
} from "@/components/admin/CoverageDashboard";
import type { RotationSlot } from "@prisma/client";
import {
  SESSION_ABSENCE_SELECT,
  SESSION_COVERAGE_SELECT,
  resolveSessionCoverage,
  sessionRef,
} from "@/lib/coverage";

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
          oneOffOwner: { select: { name: true } },
          _count: { select: { signups: true } },
          rotationCoverage: { select: SESSION_COVERAGE_SELECT },
          // Without these, a teacher who has stepped back still showed here as
          // covering the session — on the one screen an admin uses to find gaps.
          teacherAbsences: { select: SESSION_ABSENCE_SELECT },
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

  // Coverage is resolved here, on the server, through the same function finalize
  // and the teacher dashboard use. It used to be re-derived inside the client
  // component from owner/cosponsor fallbacks, which is why absences never showed
  // up on this page: the copy never learned about them. One implementation only.
  const clubs: CoverageClub[] = nextFlexDay.clubSessions.map((cs) => {
    const ref = sessionRef(cs);
    const assignments = Object.fromEntries(
      cs.rotations.map((rotation) => {
        const resolved = resolveSessionCoverage(
          ref,
          cs.rotationCoverage,
          rotation,
          cs.teacherAbsences
        );
        const row = cs.rotationCoverage.find((r) => r.rotation === rotation);
        return [
          rotation,
          {
            t1: resolved.primaryTeacherId,
            t2: resolved.secondaryTeacherId,
            t2Cleared: row?.secondaryCleared ?? false,
          } satisfies ResolvedAssignment,
        ];
      })
    ) as Partial<Record<RotationSlot, ResolvedAssignment>>;

    return {
      sessionId: cs.id,
      // One-off sessions have no club; they are still real sessions in real rooms
      // whose teacher can be absent or double-booked, so they belong here.
      name: cs.title ?? cs.club?.name ?? "Session",
      // Only used to label the "fall back to the cosponsor" option.
      cosponsorName: cs.club?.cosponsor?.name ?? null,
      poolTeacherIds: cs.club?.teachers.map((t) => t.teacherId) ?? [],
      rotations: cs.rotations,
      studentCount: cs._count.signups,
      assignments,
    };
  });

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
