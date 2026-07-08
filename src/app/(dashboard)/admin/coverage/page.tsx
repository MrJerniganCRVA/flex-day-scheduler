import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import CoverageDashboard from "@/components/admin/CoverageDashboard";
import type { CoverageClub, CoverageTeacher, CoverageDutyStation } from "@/components/admin/CoverageDashboard";
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
      teacherAbsences: { select: { userId: true, rotation: true, type: true } },
      clubSessions: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              ownerId: true,
              owner: { select: { name: true } },
              defaultCoTeacherId: true,
            },
          },
          oneOffOwner: { select: { id: true, name: true } },
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

  const [teacherUsers, allDutyStations, rawDutyAssignments] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ["TEACHER", "ADMIN"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.dutyStation.findMany({ orderBy: { name: "asc" } }),
    nextFlexDay
      ? prisma.dutyStationAssignment.findMany({
          where: { flexDayId: nextFlexDay.id },
          include: { teacher: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const teachers: CoverageTeacher[] = teacherUsers.map((u) => ({
    id: u.id,
    name: u.name ?? u.id,
  }));

  const dutyStations: CoverageDutyStation[] = allDutyStations.map((ds) => {
    const stationAssignments = rawDutyAssignments.filter(
      (a) => a.dutyStationId === ds.id
    );
    const assignments: CoverageDutyStation["assignments"] = {};
    for (const a of stationAssignments) {
      if (!assignments[a.rotation]) assignments[a.rotation] = [];
      assignments[a.rotation]!.push({
        assignmentId: a.id,
        teacherId: a.teacherId,
        teacherName: a.teacher.name ?? a.teacherId,
        adminLocked: a.adminLocked,
      });
    }
    return {
      stationId: ds.id,
      name: ds.name,
      maxTeachers: ds.maxTeachers,
      assignments,
    };
  });

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

  // A teacher is "fully absent" (sidebar section + excluded from dropdowns) only when
  // ALL of their session's rotations have an ABSENT record (REASSIGNED doesn't count here)
  const absentTeacherIds = [
    ...new Set(
      nextFlexDay.clubSessions
        .filter((cs) => {
          const ownerId = cs.club?.ownerId ?? cs.oneOffOwner?.id;
          if (!ownerId || cs.rotations.length === 0) return false;
          return cs.rotations.every((r) =>
            nextFlexDay.teacherAbsences.some(
              (a) => a.userId === ownerId && a.rotation === r && a.type === "ABSENT"
            )
          );
        })
        .flatMap((cs) =>
          [cs.club?.ownerId, cs.oneOffOwner?.id].filter(Boolean) as string[]
        )
    ),
  ];

  const clubs: CoverageClub[] = nextFlexDay.clubSessions.map((cs) => {
    const ownerId = cs.club?.ownerId ?? cs.oneOffOwner?.id ?? "";
    return {
      sessionId: cs.id,
      clubId: cs.club?.id ?? null,
      name: cs.club?.name ?? cs.title ?? "Untitled Activity",
      ownerId,
      ownerName: cs.club?.owner.name ?? cs.oneOffOwner?.name ?? "Unknown",
      rotations: cs.rotations,
      studentCount: cs._count.signups,
      ownerAbsentRotations: cs.rotations.filter((r) =>
        nextFlexDay.teacherAbsences.some((a) => a.userId === ownerId && a.rotation === r)
      ),
      defaultCoTeacherId: cs.club?.defaultCoTeacherId ?? null,
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
      absentTeacherIds={absentTeacherIds}
      dutyStations={dutyStations}
      flexDayId={nextFlexDay.id}
    />
  );
}
