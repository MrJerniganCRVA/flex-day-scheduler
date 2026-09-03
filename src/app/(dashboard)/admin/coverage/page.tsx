import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import CoverageDashboard from "@/components/admin/CoverageDashboard";
import type {
  CoverageClash,
  CoverageClub,
  CoverageDuty,
  CoverageSummary,
  CoverageTab,
  CoverageTeacher,
  ResolvedAssignment,
} from "@/components/admin/CoverageDashboard";
import type { RotationSlot } from "@prisma/client";
import {
  SESSION_ABSENCE_SELECT,
  SESSION_COVERAGE_SELECT,
  findTeacherClashes,
  resolveSessionCoverage,
  sessionPlacement,
  sessionRef,
} from "@/lib/coverage";
import { ALL_ROTATIONS } from "@/types";

export default async function AdminCoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  // Validated rather than trusted, the way the Users page does it: a junk value
  // in the URL should land on Clubs, not render an empty page.
  const { tab: rawTab } = await searchParams;
  const tab: CoverageTab = rawTab === "building" ? "building" : "clubs";

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

  // Duty posts are a separate model from ClubSession on purpose — see the note on
  // DutyPost in the schema. That is why nothing student-facing had to change to
  // add them; it also means they have to be loaded and merged in explicitly here.
  const dutyPosts = await prisma.dutyPost.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      assignments: {
        where: { flexDayId: nextFlexDay.id },
        select: { rotation: true, teacherId: true },
      },
    },
  });


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
            t1Cleared: row?.primaryCleared ?? false,
            t2Cleared: row?.secondaryCleared ?? false,
            absentTeacherIds: cs.teacherAbsences
              .filter((a) => a.rotation === rotation)
              .map((a) => a.teacherId),
          } satisfies ResolvedAssignment,
        ];
      })
    ) as Partial<Record<RotationSlot, ResolvedAssignment>>;

    return {
      sessionId: cs.id,
      // One-off sessions have no club; they are still real sessions in real rooms
      // whose teacher can be absent or double-booked, so they belong here.
      name: cs.title ?? cs.club?.name ?? "Session",
      // Only used to label the "fall back to the owner/cosponsor" options.
      ownerName: cs.club?.owner?.name ?? cs.oneOffOwner?.name ?? null,
      cosponsorName: cs.club?.cosponsor?.name ?? null,
      rotations: cs.rotations,
      studentCount: cs._count.signups,
      assignments,
    };
  });

  const duties: CoverageDuty[] = dutyPosts.map((post) => ({
    dutyPostId: post.id,
    name: post.name,
    location: post.location,
    // Only the rotations the post actually needs staffing for get a slot, so an
    // empty slot always means "needs someone" and never "not needed here".
    rotations: post.requiredRotations,
    assignments: Object.fromEntries(
      post.requiredRotations.map((rotation) => [
        rotation,
        post.assignments.find((a) => a.rotation === rotation)?.teacherId ?? null,
      ])
    ) as Partial<Record<RotationSlot, string | null>>,
  }));

  // Teachers expected in two places at once. Computed here, on the server, from
  // the same resolution the cards are built from — so a clash can never be a
  // second opinion that disagrees with what the page shows.
  //
  // Duty posts join the club sessions as placements. A duty assignment is already
  // an explicit decision with no owner or cosponsor to derive from, so it carries
  // no coverage rows and no absences — the assigned teacher goes straight into the
  // `ownerId` slot that resolveSessionCoverage reads as T1.
  const dutyPlacements = dutyPosts.flatMap((post) =>
    post.assignments
      .filter((a) => a.teacherId !== null && post.requiredRotations.includes(a.rotation))
      .map((a) => ({
        id: `duty:${post.id}:${a.rotation}`,
        name: post.name,
        rotations: [a.rotation],
        session: { ownerId: a.teacherId },
        rows: [],
        absences: [],
      }))
  );

  const clashes = findTeacherClashes(
    [...nextFlexDay.clubSessions.map(sessionPlacement), ...dutyPlacements],
    ALL_ROTATIONS
  );

  const teacherNameById = new Map(teacherUsers.map((u) => [u.id, u.name]));
  const clashWarnings: CoverageClash[] = clashes.map((clash) => ({
    rotation: clash.rotation,
    teacherId: clash.teacherId,
    teacherName: teacherNameById.get(clash.teacherId) ?? "A teacher",
    placements: clash.placements,
  }));

  // The three numbers the page exists to answer, derived from the same resolution
  // the cards are built from. Never recomputed in the client, for the reason the
  // coverage module header gives: a second implementation is a second chance to
  // disagree with the cards underneath it.
  const summary: CoverageSummary = {
    sessionsNeedingTeacher: clubs.filter((c) =>
      c.rotations.some((r) => !c.assignments[r]?.t1)
    ).length,
    totalSessions: clubs.length,
    dutySlotsUnstaffed: duties.reduce(
      (n, d) => n + d.rotations.filter((r) => !d.assignments[r]).length,
      0
    ),
    totalDutySlots: duties.reduce((n, d) => n + d.rotations.length, 0),
    // Distinct people, not clash rows: one teacher double-booked in two
    // rotations is one person to talk to, not two problems.
    doubleBookedTeachers: new Set(clashWarnings.map((c) => c.teacherId)).size,
    hasDutyPosts: dutyPosts.length > 0,
  };

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
      // Keyed on the tab so switching remounts the component. A same-route
      // search-param navigation does not reliably do that on its own, and the
      // frozen band order below is mount-scoped — this is what makes "switching
      // tabs re-sorts the columns" true rather than incidental.
      key={tab}
      tab={tab}
      clubs={clubs}
      teachers={teachers}
      duties={duties}
      flexDayId={nextFlexDay.id}
      clashes={clashWarnings}
      summary={summary}
      flexDayLabel={flexDayLabel}
    />
  );
}
