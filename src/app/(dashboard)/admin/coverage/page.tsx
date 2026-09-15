import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CoverageDashboard from "@/components/admin/CoverageDashboard";
import type {
  CoverageClash,
  CoverageSummary,
  CoverageTab,
  CoverageTeacher,
} from "@/components/admin/CoverageDashboard";
import { findTeacherClashes, sessionPlacement } from "@/lib/coverage";
import { loadFlexDayBoard } from "@/lib/flex-day-board";
import { ALL_ROTATIONS } from "@/types";
import { usersWithLiveGrant } from "@/lib/google-oauth";
import CalendarReadinessPanel from "@/components/calendar/CalendarReadinessPanel";

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

  // The day, its sessions and its duty posts, with coverage already resolved —
  // see src/lib/flex-day-board.ts. Shared with the read-only Building board so
  // the two screens can never disagree about who is in which room.
  const board = await loadFlexDayBoard();

  if (!board) {
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

  const { sessions: clubs, duties, flexDayLabel, staff } = board;

  const teachers: CoverageTeacher[] = staff.map((u) => ({
    id: u.id,
    name: u.name ?? u.id,
  }));

  // Teachers expected in two places at once. Computed here, on the server, from
  // the same resolution the cards are built from — so a clash can never be a
  // second opinion that disagrees with what the page shows.
  //
  // Duty posts join the club sessions as placements. A duty assignment is already
  // an explicit decision with no owner or cosponsor to derive from, so it carries
  // no coverage rows and no absences — the assigned teacher goes straight into the
  // `ownerId` slot that resolveSessionCoverage reads as T1.
  const dutyPlacements = board.dutyPosts.flatMap((post) =>
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
    [...board.clubSessions.map(sessionPlacement), ...dutyPlacements],
    ALL_ROTATIONS
  );

  const teacherNameById = new Map(staff.map((u) => [u.id, u.name]));
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
    hasDutyPosts: board.dutyPosts.length > 0,
  };

  // Who on this day cannot send their own invites yet.
  //
  // Only T1 decides the sender of a block, but a T2 who has not connected is
  // worth naming too: coverage changes right up to the morning, and a T2
  // promoted to T1 the day before would otherwise become a surprise fallback.
  const assignedTeacherIds = [
    ...new Set(
      clubs.flatMap((club) =>
        Object.values(club.assignments).flatMap((a) =>
          [a?.t1, a?.t2].filter((id): id is string => Boolean(id))
        )
      )
    ),
  ];
  const connected = await usersWithLiveGrant([
    ...assignedTeacherIds,
    session.user.id,
  ]);
  const unconnectedTeachers = assignedTeacherIds
    .filter((id) => !connected.has(id) && id !== session.user.id)
    .map((id) => ({ id, name: teacherNameById.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <CalendarReadinessPanel
        unconnected={unconnectedTeachers}
        adminConnected={connected.has(session.user.id)}
      />
      <CoverageDashboard
        // Keyed on the tab so switching remounts the component. A same-route
        // search-param navigation does not reliably do that on its own, and the
        // gaps filter's frozen row set is mount-scoped — this is what stops the
        // Clubs tab's filter carrying over onto Building.
        key={tab}
        tab={tab}
        clubs={clubs}
        teachers={teachers}
        duties={duties}
        flexDayId={board.flexDay.id}
        clashes={clashWarnings}
        summary={summary}
        flexDayLabel={flexDayLabel}
      />
    </>
  );
}
