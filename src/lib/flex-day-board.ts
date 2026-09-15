import prisma from "@/lib/prisma";
import type { RotationSlot } from "@prisma/client";
import {
  SESSION_ABSENCE_SELECT,
  SESSION_COVERAGE_SELECT,
  resolveSessionCoverage,
  sessionRef,
} from "@/lib/coverage";
import { resolveRoomName } from "@/lib/session-event";
import type {
  BoardDuty,
  BoardSession,
  ResolvedAssignment,
} from "@/lib/board-rows";

/**
 * "What is happening on the next Flex Day, where, and who is in the room."
 *
 * Lived inside the admin Coverage page until the read-only Building board needed
 * the same answer. Two copies of this query would be two chances to show
 * different days, different rooms, or — worst — different teachers on the two
 * screens, since resolving coverage has fallbacks and absences folded into it
 * (see the header of src/lib/coverage.ts, which makes this argument at length).
 *
 * The pure half of the grid — how these sessions fold into rows — is in
 * src/lib/board-rows.ts, kept free of Prisma so it can be unit-tested. This half
 * is the query, and is verified by using the screens.
 */

/** The soonest upcoming active day, its sessions, and its duty posts. */
export type FlexDayBoard = {
  flexDay: { id: string; date: Date; label: string | null };
  /** The day's own label, or the long-form date when it has none. */
  flexDayLabel: string;
  /** Alphabetical, with an id tiebreak. */
  sessions: BoardSession[];
  /** Alphabetical, with an id tiebreak. */
  duties: BoardDuty[];
  /**
   * The raw session rows behind `sessions`, for callers that build
   * ExpectedPlacements out of them. Only the admin Coverage page does — it
   * detects double-booking — and it needs the coverage rows and absences that
   * `BoardSession` has already resolved away.
   */
  clubSessions: RawClubSession[];
  /** The raw duty posts, for the same reason. */
  dutyPosts: RawDutyPost[];
  /**
   * Everyone who can be in a room, by name — the coverage ids above are ids.
   *
   * Sorted by name, and `name` is left nullable rather than defaulted to the id
   * here: the Coverage dropdowns want the id as a visible fallback, and the
   * clash banner wants "A teacher" instead. Deciding that centrally would make
   * one of them wrong.
   */
  staff: { id: string; name: string | null }[];
};

const SESSION_INCLUDE = {
  club: {
    select: {
      id: true,
      name: true,
      ownerId: true,
      cosponsorId: true,
      owner: { select: { name: true } },
      cosponsor: { select: { name: true } },
      defaultRoom: { select: { name: true } },
    },
  },
  // The grid is read as "what is happening, where, and who is there", so the
  // room belongs beside the name. Same precedence as every other surface that
  // shows one — see the note on effectiveRoomId in src/lib/scheduling.ts.
  roomOverride: { select: { name: true } },
  oneOffOwner: { select: { name: true } },
  _count: { select: { signups: true } },
  rotationCoverage: { select: SESSION_COVERAGE_SELECT },
  // Without these, a teacher who has stepped back still showed as covering the
  // session — on the one screen an admin uses to find gaps.
  teacherAbsences: { select: SESSION_ABSENCE_SELECT },
} as const;

type RawFlexDay = NonNullable<
  Awaited<ReturnType<typeof findNextFlexDay>>
>;
type RawClubSession = RawFlexDay["clubSessions"][number];
type RawDutyPost = Awaited<ReturnType<typeof findDutyPosts>>[number];

function findNextFlexDay() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return prisma.flexDay.findFirst({
    where: { date: { gte: today }, isActive: true },
    orderBy: { date: "asc" },
    include: { clubSessions: { include: SESSION_INCLUDE } },
  });
}

function findDutyPosts(flexDayId: string) {
  // Duty posts are a separate model from ClubSession on purpose — see the note on
  // DutyPost in the schema. That is why nothing student-facing had to change to
  // add them; it also means they have to be loaded and merged in explicitly.
  return prisma.dutyPost.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      assignments: {
        where: { flexDayId },
        select: { rotation: true, teacherId: true },
      },
    },
  });
}

/**
 * Load the board for the soonest upcoming active Flex Day, or null when there
 * isn't one.
 *
 * The day is not a parameter: both screens that draw this grid are about the day
 * that is coming, and neither offers a picker.
 */
export async function loadFlexDayBoard(): Promise<FlexDayBoard | null> {
  const nextFlexDay = await findNextFlexDay();
  if (!nextFlexDay) return null;

  const dutyPosts = await findDutyPosts(nextFlexDay.id);

  // Admins are included deliberately — an admin can own a club or take a duty
  // post, so they appear in coverage exactly as a teacher does.
  const staff = await prisma.user.findMany({
    where: { role: { in: ["TEACHER", "ADMIN"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Coverage is resolved here, on the server, through the same function finalize
  // and the teacher dashboard use. It used to be re-derived inside the Coverage
  // client component from owner/cosponsor fallbacks, which is why absences never
  // showed up on that page: the copy never learned about them. One implementation
  // only.
  const sessions: BoardSession[] = nextFlexDay.clubSessions.map((cs) => {
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
      // Lets the grid merge the per-rotation sessions of an unlinked club back
      // into one row. Null for one-offs, which never merge with anything.
      clubId: cs.club?.id ?? null,
      // One-off sessions have no club; they are still real sessions in real rooms
      // whose teacher can be absent or double-booked, so they belong here.
      name: cs.title ?? cs.club?.name ?? "Session",
      // Only used to label the "fall back to the owner/cosponsor" options.
      ownerName: cs.club?.owner?.name ?? cs.oneOffOwner?.name ?? null,
      cosponsorName: cs.club?.cosponsor?.name ?? null,
      roomName: resolveRoomName(cs),
      rotations: cs.rotations,
      studentCount: cs._count.signups,
      assignments,
    };
  });

  // Alphabetical, and only alphabetical.
  //
  // The grid lines clubs up in rows across all three rotations, which only helps
  // if a club sits in the same place every time you look. Ordering used to be
  // "gaps first", computed per column, so a club running all three rotations
  // appeared at three different heights and could not be followed across the
  // page — the thing these screens actually exist for. Finding gaps is a filter
  // on the admin page (see its Only show gaps toggle), not an ordering.
  //
  // Sorted here rather than in the client so the components stay renderers, and
  // in JS rather than by the database so both tabs order by the same rule —
  // Postgres collation and localeCompare disagree on punctuation and case.
  const byName = <T extends { name: string; id: string }>(a: T, b: T) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  // Two sessions of the same club on one day are legitimate, so the name is not
  // a unique key — the id tiebreak is what keeps their order stable across
  // renders instead of flipping on every refresh.
  sessions.sort((a, b) =>
    byName({ ...a, id: a.sessionId }, { ...b, id: b.sessionId })
  );

  const duties: BoardDuty[] = dutyPosts.map((post) => ({
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

  duties.sort((a, b) =>
    byName({ ...a, id: a.dutyPostId }, { ...b, id: b.dutyPostId })
  );

  const flexDayLabel = nextFlexDay.label
    ? nextFlexDay.label
    : new Date(nextFlexDay.date).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });

  return {
    flexDay: {
      id: nextFlexDay.id,
      date: nextFlexDay.date,
      label: nextFlexDay.label,
    },
    flexDayLabel,
    sessions,
    duties,
    clubSessions: nextFlexDay.clubSessions,
    dutyPosts,
    staff,
  };
}
