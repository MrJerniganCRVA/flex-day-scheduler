"use client";

import { Fragment, useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatTile from "@/components/admin/StatTile";
import type { RotationSlot } from "@prisma/client";
import {
  ALL_ROTATIONS,
  ROTATION_LABELS,
  SHORT_ROTATION_LABELS as SHORT_LABELS,
} from "@/types";

const HIGH_ENROLLMENT_THRESHOLD = 20;

/**
 * Select value meaning "no teacher at all in this slot", as distinct from "" which
 * means "use the club's owner (T1) or cosponsor (T2)". A `<select>` can only hold
 * strings, and the two empty states have to be distinguishable — a cuid can never
 * collide with this.
 */
const CLEARED = "__none__";

/**
 * What one session's card needs. Deliberately *not* the raw ingredients of
 * coverage resolution: the owner, cosponsor and coverage rows used to be passed
 * here so this component could derive T1/T2 itself, and that second
 * implementation is exactly why absences never reached this screen. The server
 * resolves now; this renders and edits.
 */
export type CoverageClub = {
  sessionId: string;
  /**
   * Null for a one-off session, which belongs to no club.
   *
   * A club whose rotations are *unlinked* gets one session per rotation, so
   * students can sign up for one, two or three of them independently — see
   * desiredSessionShapes in src/lib/reconcile.ts. Those sessions are separate
   * rows in the database and separate cards on every other screen, but they are
   * one club to an admin reading across the day, so the grid groups by this.
   */
  clubId: string | null;
  name: string;
  /** Labels the "fall back to the owner" option; not used to derive anything. */
  ownerName: string | null;
  /** Labels the "fall back to the cosponsor" option; not used to derive anything. */
  cosponsorName: string | null;
  /** Where it meets, resolved server-side from the override or the club default. */
  roomName: string | null;
  rotations: RotationSlot[];
  studentCount: number;
  /** Server-resolved starting state, per rotation. */
  assignments: Partial<Record<RotationSlot, ResolvedAssignment>>;
};

/** Effective coverage for one rotation, as resolved by src/lib/coverage.ts. */
export type ResolvedAssignment = {
  t1: string | null;
  t2: string | null;
  /** True when an admin explicitly said this rotation needs no primary teacher. */
  t1Cleared: boolean;
  /** True when an admin explicitly said this rotation needs no second teacher. */
  t2Cleared: boolean;
  /**
   * Teachers already marked absent from this session for this rotation, so the
   * "Not here" control knows whether it is setting or undoing.
   */
  absentTeacherIds: string[];
};

export type CoverageTeacher = {
  id: string;
  name: string;
};

/**
 * One teacher expected in two or more places during one rotation, as found by
 * `findTeacherClashes` on the server.
 *
 * Resolved server-side rather than derived here, for the reason the file header
 * gives: a second implementation of the coverage rules is a second chance to be
 * quietly wrong, and a clash warning that disagreed with the cards beneath it
 * would be worse than none.
 */
/**
 * A supervision post that is not a club — see the DutyPost model.
 *
 * `rotations` holds only the rotations the post is required to be staffed for, so
 * a blank slot always means "needs someone" and never "not needed here".
 */
export type CoverageDuty = {
  dutyPostId: string;
  name: string;
  location: string | null;
  rotations: RotationSlot[];
  /** teacherId per required rotation; null means unstaffed. */
  assignments: Partial<Record<RotationSlot, string | null>>;
};

/**
 * The headline numbers, resolved on the server. Coverage was the only admin
 * screen that went straight from its heading to its content, so "is anything
 * wrong today?" cost a scroll past three full-height columns.
 */
export type CoverageSummary = {
  sessionsNeedingTeacher: number;
  totalSessions: number;
  dutySlotsUnstaffed: number;
  totalDutySlots: number;
  doubleBookedTeachers: number;
  /** False when no duty posts exist at all, which needs a different empty hint. */
  hasDutyPosts: boolean;
};

export type CoverageClash = {
  rotation: RotationSlot;
  teacherId: string;
  teacherName: string;
  placements: { id: string; name: string }[];
};

// assignments[sessionId][rotation] — seeded from the server's resolution and then
// updated optimistically as the admin edits.
//
// Each slot's id and its cleared flag together carry three states, because an
// empty slot is ambiguous on a club that has an owner or a cosponsor to fall back
// to:
//   t1 set                     → that teacher
//   t1 null, t1Cleared false   → fall back to the club's owner
//   t1 null, t1Cleared true    → deliberately nobody
//   t2 set                     → that teacher
//   t2 null, t2Cleared false   → fall back to the club's cosponsor
//   t2 null, t2Cleared true    → deliberately nobody
type Assignment = ResolvedAssignment;

/**
 * A rotation with nothing recorded yet. Shared rather than written inline at each
 * use: it grew two fields when T1 gained its cleared state, and three separate
 * copies is three chances to update two of them.
 */
const EMPTY_ASSIGNMENT: Assignment = {
  t1: null,
  t2: null,
  t1Cleared: false,
  t2Cleared: false,
  absentTeacherIds: [],
};
type Assignments = Record<string, Partial<Record<RotationSlot, Assignment>>>;
/** dutyPostId -> rotation -> teacherId, or null for unstaffed. */
type DutyAssignments = Record<
  string,
  Partial<Record<RotationSlot, string | null>>
>;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type SaveStatuses = Record<string, Partial<Record<RotationSlot, SaveStatus>>>;

type Urgency = "needs" | "consider" | "covered";

/**
 * One thing in a rotation column. Clubs and duty posts share the column, the
 * urgency banding and the card grammar, but not their content — a duty post has
 * no second teacher, no students and no absences — so they stay separate shapes
 * rather than one type full of nullable fields.
 */
const TABS = [
  { key: "clubs", label: "Clubs" },
  { key: "building", label: "Building" },
] as const satisfies readonly { key: CoverageTab; label: string }[];

/**
 * Which half of the page's job is on screen.
 *
 * "Is every club staffed?" and "does the building have eyes?" are different
 * questions asked at different moments, and the columns got long enough that
 * doing both at once was a scroll. Only the columns are tabbed — the summary,
 * the clash banner and the teacher panel sit outside and answer for both.
 */
export type CoverageTab = "clubs" | "building";

/** A teacher expected in one rotation, and what put them there. */
type ExpectedPlacement = {
  teacherId: string;
  rotation: RotationSlot;
  source:
    | { kind: "club"; sessionId: string; slot: "t1" | "t2" }
    | { kind: "duty"; dutyPostId: string };
};

/**
 * One line of the grid: a club, or a duty post. Which of the two the grid is
 * showing is the tab's business; the shell around them is identical.
 *
 * A club row holds a session *per rotation* rather than a single session,
 * because a club with unlinked rotations has one session per rotation — three
 * database rows that are one club to the admin reading across the day. Each
 * cell edits whichever session covers its rotation, so the three keep their own
 * rosters, rooms and coverage while sharing a line.
 */
type GridRow =
  | {
      kind: "club";
      key: string;
      name: string;
      /** The room, when every session in the row agrees; null when they differ. */
      roomName: string | null;
      sessions: Partial<Record<RotationSlot, CoverageClub>>;
    }
  | { kind: "duty"; key: string; name: string; duty: CoverageDuty };

/**
 * What one cell of the grid is.
 *
 * "not-scheduled" is the state the old three-column layout could not express: a
 * club with no card in Flex 2 might have been not running, or running with
 * nothing recorded, and the layout said the same nothing either way. Here every
 * row spans every rotation, so the distinction has to be — and now can be —
 * drawn explicitly.
 */
type CellState = Urgency | "not-scheduled";

function urgencyOf(
  club: CoverageClub,
  assignment: Assignment | undefined
): Urgency {
  if (!assignment?.t1) return "needs";
  // A large session without a second teacher is worth a nudge — unless an admin
  // has already decided it doesn't need one. Continuing to flag a deliberately
  // cleared slot would make the signal noise.
  if (
    club.studentCount >= HIGH_ENROLLMENT_THRESHOLD &&
    !assignment.t2 &&
    !assignment.t2Cleared
  )
    return "consider";
  return "covered";
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CoverageDashboard({
  clubs,
  teachers,
  duties,
  flexDayId,
  clashes,
  summary,
  flexDayLabel,
  tab,
}: {
  clubs: CoverageClub[];
  teachers: CoverageTeacher[];
  duties: CoverageDuty[];
  flexDayId: string;
  clashes: CoverageClash[];
  summary: CoverageSummary;
  flexDayLabel: string;
  tab: CoverageTab;
}) {
  const router = useRouter();

  // Seeded straight from the server's resolution — no fallback logic here. The
  // previous version rebuilt T1/T2 from owner/cosponsor in this file, which meant
  // every rule added to src/lib/coverage.ts (absences, most recently) had to be
  // remembered a second time, and wasn't.
  const [assignments, setAssignments] = useState<Assignments>(() =>
    Object.fromEntries(clubs.map((c) => [c.sessionId, { ...c.assignments }]))
  );

  // dutyAssignments[dutyPostId][rotation] — teacherId, or null for unstaffed.
  // Simpler than the club equivalent because a duty post has no owner to fall
  // back to, so there is no third state to carry.
  const [dutyAssignments, setDutyAssignments] = useState<DutyAssignments>(() =>
    Object.fromEntries(duties.map((d) => [d.dutyPostId, { ...d.assignments }]))
  );
  const [dutySaveStatus, setDutySaveStatus] = useState<SaveStatuses>({});

  // Show only the rows with a gap in them. Off by default: the aligned, complete
  // list is what the page is for, and this narrows it to a worklist on demand.
  //
  // Null means "showing everything". Switched on, it holds the keys of the rows
  // that had a gap *at that moment* and filters against that frozen set rather
  // than against live state. Filtering live would delete a row from under the
  // admin the instant they filled its last slot — the same "the card I just
  // edited jumped away" problem the old frozen band order existed to prevent,
  // and the one lesson from that machinery worth keeping. The row stays put and
  // turns green; `Hide N covered` below re-takes the set.
  const [gapRows, setGapRows] = useState<Set<string> | null>(null);

  // Keyed `teacherId:rotation`, matching how the banner lists clashes.
  const [clashBusy, setClashBusy] = useState<string | null>(null);
  const [clashError, setClashError] = useState<string | null>(null);

  // Number of saves in flight. Not state we render — state we *wait* on; see the
  // effect below.
  const [pendingSaves, setPendingSaves] = useState(0);

  // Re-seed whenever the server sends a fresh resolution.
  //
  // Edits are applied optimistically below, which is what makes the dropdowns feel
  // instant — but a `useState` initializer never re-runs, so without this the
  // optimistic guess was the *last word* on screen until a manual reload. That is
  // how "Saved ✓" was able to sit above a value the server had resolved
  // differently. Each save triggers router.refresh(), and this puts the answer
  // that comes back on screen.
  //
  // Held back while any save is in flight. An admin staffing a whole day edits
  // several dropdowns in quick succession, and a refresh triggered by the first
  // edit can land after the second has been applied optimistically — re-seeding
  // then would flash the second edit away and put it back a moment later, on the
  // one screen that is supposed to be trustworthy. Waiting for the queue to drain
  // means the re-seed happens once, against a server response that includes every
  // edit. `pendingSaves` is in the dependency list so dropping to zero re-runs
  // this with the latest props.
  useEffect(() => {
    if (pendingSaves > 0) return;
    setAssignments(
      Object.fromEntries(clubs.map((c) => [c.sessionId, { ...c.assignments }]))
    );
    setDutyAssignments(
      Object.fromEntries(duties.map((d) => [d.dutyPostId, { ...d.assignments }]))
    );
  }, [clubs, duties, pendingSaves]);

  const [saveStatus, setSaveStatus] = useState<SaveStatuses>(() =>
    Object.fromEntries(
      clubs.map((c) => [
        c.sessionId,
        Object.fromEntries(c.rotations.map((r) => [r, "idle" as SaveStatus])),
      ])
    )
  );

  /**
   * `value` is a teacher id, `null` to fall back to the club's owner (T1) or
   * cosponsor (T2), or the CLEARED sentinel for "nobody at all in this slot".
   *
   * T1 gained its third state late. Before it existed, choosing "None" for T1
   * wrote a null that the owner fallback immediately overwrote, so this function
   * reported a successful save for a change that never took effect — the admin
   * had no way to take a double-booked teacher off one of their two clubs.
   */
  const assign = useCallback(
    async (
      sessionId: string,
      rotation: RotationSlot,
      slot: "t1" | "t2",
      value: string | null
    ) => {
      const cleared = value === CLEARED;
      const teacherId = cleared ? null : value;

      setAssignments((prev) => ({
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          [rotation]: {
            ...(prev[sessionId]?.[rotation] ?? EMPTY_ASSIGNMENT),
            [slot]: teacherId,
            ...(slot === "t1"
              ? { t1Cleared: cleared }
              : { t2Cleared: cleared }),
          },
        },
      }));
      setSaveStatus((prev) => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], [rotation]: "saving" },
      }));
      setPendingSaves((n) => n + 1);
      try {
        const body =
          slot === "t1"
            ? cleared
              ? { rotation, primaryCleared: true }
              : { rotation, primary: teacherId }
            : cleared
              ? { rotation, secondaryCleared: true }
              : { rotation, secondary: teacherId };
        const res = await fetch(`/api/club-sessions/${sessionId}/coverage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setSaveStatus((prev) => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            [rotation]: res.ok ? "saved" : "error",
          },
        }));
        if (res.ok) {
          // Ask the server what this actually resolved to. The response body is
          // only `{ok:true}`, and the resolution rules live in
          // src/lib/coverage.ts on the server, so re-rendering the page is how
          // this component learns the truth rather than guessing it a second time.
          router.refresh();
          setTimeout(() => {
            setSaveStatus((prev) => ({
              ...prev,
              [sessionId]: { ...prev[sessionId], [rotation]: "idle" },
            }));
          }, 2000);
        }
      } catch {
        setSaveStatus((prev) => ({
          ...prev,
          [sessionId]: { ...prev[sessionId], [rotation]: "error" },
        }));
      } finally {
        setPendingSaves((n) => n - 1);
      }
    },
    [router]
  );

  const assignDuty = useCallback(
    async (dutyPostId: string, rotation: RotationSlot, teacherId: string | null) => {
      setDutyAssignments((prev) => ({
        ...prev,
        [dutyPostId]: { ...prev[dutyPostId], [rotation]: teacherId },
      }));
      setDutySaveStatus((prev) => ({
        ...prev,
        [dutyPostId]: { ...prev[dutyPostId], [rotation]: "saving" },
      }));
      setPendingSaves((n) => n + 1);
      try {
        const res = await fetch("/api/admin/duty-assignments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dutyPostId, flexDayId, rotation, teacherId }),
        });
        setDutySaveStatus((prev) => ({
          ...prev,
          [dutyPostId]: {
            ...prev[dutyPostId],
            [rotation]: res.ok ? "saved" : "error",
          },
        }));
        if (res.ok) {
          // Staffing a duty post can create a clash with a club, and clashes are
          // computed on the server — so refresh rather than guess.
          router.refresh();
          setTimeout(() => {
            setDutySaveStatus((prev) => ({
              ...prev,
              [dutyPostId]: { ...prev[dutyPostId], [rotation]: "idle" },
            }));
          }, 2000);
        }
      } catch {
        setDutySaveStatus((prev) => ({
          ...prev,
          [dutyPostId]: { ...prev[dutyPostId], [rotation]: "error" },
        }));
      } finally {
        setPendingSaves((n) => n - 1);
      }
    },
    [router, flexDayId]
  );

  /**
   * Every teacher expected somewhere, in one list, with what put them there.
   *
   * Three separate places used to answer "is this teacher busy in this
   * rotation?" — the club dropdowns, the duty dropdowns, and the teacher panel —
   * and all three drifted apart. The dropdowns disagreed with each other until
   * they were merged; the panel was missed and went on counting a teacher on
   * hallway duty as having all three rotations open, on the very list an admin
   * scans to find someone free. Derived once here, every consumer agrees by
   * construction.
   *
   * Absences need no special handling: the server resolves an absent teacher out
   * of t1/t2 before this sees them.
   */
  const expectedPlacements = useMemo<ExpectedPlacement[]>(() => {
    const out: ExpectedPlacement[] = [];

    for (const club of clubs) {
      for (const rotation of club.rotations) {
        const a = assignments[club.sessionId]?.[rotation];
        if (a?.t1)
          out.push({
            teacherId: a.t1,
            rotation,
            source: { kind: "club", sessionId: club.sessionId, slot: "t1" },
          });
        if (a?.t2)
          out.push({
            teacherId: a.t2,
            rotation,
            source: { kind: "club", sessionId: club.sessionId, slot: "t2" },
          });
      }
    }

    for (const duty of duties) {
      for (const rotation of duty.rotations) {
        const teacherId = dutyAssignments[duty.dutyPostId]?.[rotation] ?? null;
        if (teacherId)
          out.push({
            teacherId,
            rotation,
            source: { kind: "duty", dutyPostId: duty.dutyPostId },
          });
      }
    }

    return out;
  }, [clubs, duties, assignments, dutyAssignments]);

  // The teacher panel, from the same list the dropdowns use. It used to walk
  // `clubs` alone, so assigning someone to a duty post removed them from every
  // dropdown while this still filed them under "All 3 open" — and a reload did
  // not help, because the omission was in the derivation, not in stale state.
  const teacherRows = useMemo(() => {
    const busy = new Map<string, Set<RotationSlot>>();
    for (const p of expectedPlacements) {
      const set = busy.get(p.teacherId) ?? new Set<RotationSlot>();
      set.add(p.rotation);
      busy.set(p.teacherId, set);
    }

    return teachers
      .map((t) => {
        const assignedRotations = busy.get(t.id) ?? new Set<RotationSlot>();
        const freeCount = ALL_ROTATIONS.filter(
          (r) => !assignedRotations.has(r)
        ).length;
        return { ...t, freeCount, assignedRotations };
      })
      .sort((a, b) => b.freeCount - a.freeCount);
  }, [teachers, expectedPlacements]);

  /**
   * Record (or lift) a teacher's absence from one rotation of one club session.
   *
   * One handler rather than a component per button: the clash banner and the
   * card's undo do the same thing, and this component already holds
   * `router.refresh()`. An absence changes what src/lib/coverage.ts resolves, so
   * the server re-renders rather than this guessing the new state.
   */
  const setAbsence = useCallback(
    async (sessionId: string, rotation: RotationSlot, teacherId: string, absent: boolean) => {
      const res = await fetch(`/api/club-sessions/${sessionId}/absence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          rotations: [rotation],
          absent,
          reason: absent
            ? "Double-booked — assigned elsewhere this rotation"
            : undefined,
        }),
      });
      return res.ok;
    },
    []
  );

  /**
   * Resolve a clash by saying where the teacher will actually be.
   *
   * The banner already names the person and every place expecting them, so it can
   * ask the real question instead of stating a fact. Choosing one placement clears
   * them from all the others in that rotation — the same interaction
   * RotationClashNotice offers the teacher on their own dashboard.
   *
   * The two kinds of placement need different endpoints, because a duty post
   * cannot carry a SessionTeacherAbsence: that row is keyed to a ClubSession. The
   * placement id says which is which — duty ids are `duty:<postId>:<rotation>`.
   */
  const resolveClash = useCallback(
    async (clash: CoverageClash, keepPlacementId: string) => {
      setClashBusy(`${clash.teacherId}:${clash.rotation}`);
      try {
        const results = await Promise.all(
          clash.placements
            .filter((p) => p.id !== keepPlacementId)
            .map((p) => {
              const duty = p.id.startsWith("duty:");
              if (duty) {
                const dutyPostId = p.id.split(":")[1];
                return fetch("/api/admin/duty-assignments", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    dutyPostId,
                    flexDayId,
                    rotation: clash.rotation,
                    teacherId: null,
                  }),
                }).then((r) => r.ok);
              }
              return setAbsence(p.id, clash.rotation, clash.teacherId, true);
            })
        );
        if (results.every(Boolean)) {
          router.refresh();
        } else {
          setClashError(`${clash.teacherId}:${clash.rotation}`);
        }
      } finally {
        setClashBusy(null);
      }
    },
    [flexDayId, router, setAbsence]
  );

  /** Lift every absence on one card's rotation, from the card's own undo. */
  const undoAbsences = useCallback(
    async (sessionId: string, rotation: RotationSlot, teacherIds: string[]) => {
      const results = await Promise.all(
        teacherIds.map((id) => setAbsence(sessionId, rotation, id, false))
      );
      if (results.every(Boolean)) router.refresh();
    },
    [router, setAbsence]
  );

  /**
   * Who can still be offered for a slot in this rotation.
   *
   * One question for clubs and duty posts alike: nobody can be in two rooms at
   * once, so anyone already expected somewhere in this rotation is not on offer
   * anywhere else in it.
   *
   * `exclude` is the slot being edited, so a card never competes with itself —
   * the teacher currently in this very slot stays on offer, while the sibling
   * slot on the same club card does not, since T1 and T2 must be two people.
   */
  function availableTeachersFor(
    rotation: RotationSlot,
    exclude:
      | { kind: "club"; sessionId: string; slot: "t1" | "t2" }
      | { kind: "duty"; dutyPostId: string }
  ): CoverageTeacher[] {
    const isExcluded = (source: ExpectedPlacement["source"]) =>
      source.kind === "club" && exclude.kind === "club"
        ? source.sessionId === exclude.sessionId && source.slot === exclude.slot
        : source.kind === "duty" && exclude.kind === "duty"
          ? source.dutyPostId === exclude.dutyPostId
          : false;

    const taken = new Set(
      expectedPlacements
        .filter((p) => p.rotation === rotation && !isExcluded(p.source))
        .map((p) => p.teacherId)
    );

    return teachers.filter((t) => !taken.has(t.id));
  }

  /** Duty slots draw from the same pool; kept as a name the call site reads well. */
  function availableDutyTeachers(
    rotation: RotationSlot,
    dutyPostId: string
  ): CoverageTeacher[] {
    return availableTeachersFor(rotation, { kind: "duty", dutyPostId });
  }

  // sessionId+rotation -> the names of teachers double-booked there, so a card
  // can badge itself without re-deriving anything.
  const clashesByCard = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const clash of clashes) {
      for (const placement of clash.placements) {
        const key = `${placement.id}:${clash.rotation}`;
        map.set(key, [...(map.get(key) ?? []), clash.teacherName]);
      }
    }
    return map;
  }, [clashes]);

  /**
   * What one cell of the grid is showing, for a row and a rotation.
   *
   * The single place that decides, so the cell's colour, the row's accent, the
   * column's uncovered count and the gaps filter can never give four different
   * answers about the same slot.
   */
  const cellState = useCallback(
    (row: GridRow, rotation: RotationSlot): CellState => {
      if (row.kind === "club") {
        const session = row.sessions[rotation];
        if (!session) return "not-scheduled";
        return urgencyOf(session, assignments[session.sessionId]?.[rotation]);
      }
      // A duty post carries only the rotations it is required for, so anything
      // outside that list is genuinely not wanted rather than unstaffed.
      if (!row.duty.rotations.includes(rotation)) return "not-scheduled";
      // Never "consider": that is a second-teacher judgement and a duty post has
      // no second teacher.
      return dutyAssignments[row.duty.dutyPostId]?.[rotation]
        ? "covered"
        : "needs";
    },
    [assignments, dutyAssignments]
  );

  // Every row of the current tab, in the alphabetical order the server sent.
  // Nothing here reorders: that is the whole point of the grid.
  const allRows = useMemo<GridRow[]>(() => {
    if (tab === "building")
      return duties.map((duty) => ({
        kind: "duty" as const,
        key: `duty:${duty.dutyPostId}`,
        name: duty.name,
        duty,
      }));

    // Sessions of one club collapse into one row.
    //
    // An unlinked club has a session per rotation, and keying rows by session
    // drew it three times — three lines each with one cell filled and two
    // hatched, for a club that is simply running all day. Grouping by club is
    // what makes the row mean "Art Club" rather than "one of Art Club's three
    // sessions".
    //
    // Two sessions of the same club *in the same rotation* cannot share a cell,
    // so they take a second row rather than one quietly winning. `clubs`
    // arrives sorted by name, and rows keep first-encounter order, so the
    // result is still alphabetical with any such pair adjacent.
    type ClubRow = Extract<GridRow, { kind: "club" }>;
    const rows: ClubRow[] = [];
    const byClub = new Map<string, ClubRow[]>();

    for (const session of clubs) {
      // A one-off belongs to no club, so it never merges with anything.
      const siblings = session.clubId ? (byClub.get(session.clubId) ?? []) : [];
      let row = siblings.find((r) =>
        session.rotations.every((rotation) => !r.sessions[rotation])
      );

      if (!row) {
        row = {
          kind: "club",
          key: session.clubId
            ? `club:${session.clubId}:${siblings.length}`
            : `session:${session.sessionId}`,
          name: session.name,
          roomName: null,
          sessions: {},
        };
        rows.push(row);
        if (session.clubId) byClub.set(session.clubId, [...siblings, row]);
      }

      for (const rotation of session.rotations) row.sessions[rotation] = session;
    }

    // The room belongs on the row only when the row agrees about it. Sessions
    // of one club normally inherit the same default room, but any of them can
    // carry an override, and a row header claiming one room for three sessions
    // held in two would be worse than saying nothing — so when they differ the
    // cells state their own (see ClubCell).
    for (const row of rows) {
      const names = new Set(
        ALL_ROTATIONS.map((r) => row.sessions[r]?.roomName).filter(
          (n): n is string => !!n
        )
      );
      row.roomName = names.size === 1 ? [...names][0] : null;
    }

    return rows;
  }, [tab, clubs, duties]);

  const hasGap = useCallback(
    (row: GridRow) =>
      ALL_ROTATIONS.some((r) => cellState(row, r) === "needs"),
    [cellState]
  );

  const rows = useMemo(
    () => (gapRows === null ? allRows : allRows.filter((r) => gapRows.has(r.key))),
    [allRows, gapRows]
  );

  // Rows still on screen under the filter that no longer have a gap — the count
  // behind "Hide N covered". Zero while the filter is off, so the control is
  // absent until there is something for it to do.
  const clearedRowCount = useMemo(
    () => (gapRows === null ? 0 : rows.filter((r) => !hasGap(r)).length),
    [gapRows, rows, hasGap]
  );

  const applyGapFilter = useCallback(() => {
    setGapRows(new Set(allRows.filter(hasGap).map((r) => r.key)));
  }, [allRows, hasGap]);

  return (
    // Fills main at xl and up, where the grid sits beside the teacher panel and
    // takes the leftover height as its own scroll region. Below that everything
    // stacks at natural height and main scrolls, which is the right behaviour
    // when the panel is under the grid rather than next to it.
    <div className="flex flex-col xl:h-full">
      <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Coverage
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {flexDayLabel}
          </p>
        </div>
        {/* Duty posts are defined elsewhere but staffed here, so the page they
            are defined on has to be reachable from the page they are used on. */}
        <a
          href="/admin/duty-posts"
          className="shrink-0 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Manage duty posts →
        </a>
      </div>

      {/* The answer to "is anything wrong today?", before any scrolling. Zero is
          never red anywhere in this app — a screen scanned for problems should
          show colour only where there is one. */}
      <div className="mb-5 grid shrink-0 grid-cols-3 gap-3">
        <StatTile
          value={summary.sessionsNeedingTeacher}
          label="need a teacher"
          hint={`of ${summary.totalSessions} ${
            summary.totalSessions === 1 ? "session" : "sessions"
          }`}
          tone={summary.sessionsNeedingTeacher > 0 ? "bad" : "neutral"}
        />
        <StatTile
          value={summary.dutySlotsUnstaffed}
          label="building slots open"
          hint={
            summary.hasDutyPosts
              ? `of ${summary.totalDutySlots} ${
                  summary.totalDutySlots === 1 ? "slot" : "slots"
                }`
              : "no duty posts set up"
          }
          tone={summary.dutySlotsUnstaffed > 0 ? "bad" : "neutral"}
        />
        <StatTile
          value={summary.doubleBookedTeachers}
          label="double-booked"
          hint={summary.doubleBookedTeachers === 1 ? "teacher" : "teachers"}
          tone={summary.doubleBookedTeachers > 0 ? "warn" : "neutral"}
        />
      </div>

      {/* Nobody can be in two rooms at once. Warn, never block — it is legitimate
          to know about a clash and sort it out later.
          This is also where the fix lives. It used to be a "Not here" button on
          every card beside every resolved teacher; the decision is only ever made
          when a clash appears, so it belongs here, where the clash is named. */}
      {clashes.length > 0 && (
        <div className="mb-5 shrink-0 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {clashes.length === 1
              ? "1 teacher is expected in two places at once"
              : `${clashes.length} teachers are expected in two places at once`}
          </p>
          {/* Capped: the grid below now lives in the height this leaves it, and
              a day with five clashes was pushing it down to two visible rows.
              Scrolls rather than truncates — every clash stays reachable. */}
          <ul className="mt-2 max-h-44 space-y-2 overflow-y-auto">
            {clashes.map((clash) => {
              const key = `${clash.teacherId}:${clash.rotation}`;
              const busy = clashBusy === key;
              return (
                <li key={key} className="text-xs text-amber-700 dark:text-amber-300">
                  <span className="font-medium">{clash.teacherName}</span> in{" "}
                  {ROTATION_LABELS[clash.rotation]} —{" "}
                  {clash.placements.map((p) => p.name).join(" and ")}
                  {/* The decision, asked where it is noticed. Picking one clears
                      this teacher from every other place expecting them this
                      rotation; those keep running and show as needing cover. */}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px]">Where will they be?</span>
                    {clash.placements.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => resolveClash(clash, p.id)}
                        disabled={busy}
                        className="rounded border border-amber-400 dark:border-amber-600 bg-white/60 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50 transition-colors"
                      >
                        {busy ? "Saving…" : p.name}
                      </button>
                    ))}
                  </span>
                  {clashError === key && (
                    <span className="mt-1 block text-[11px] text-red-600 dark:text-red-400">
                      Could not save that. Please try again.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Only the columns are tabbed. Everything above stays put, so a clash or
          an open building slot is visible whichever tab you are on. */}
      <div className="flex shrink-0 items-end justify-between gap-4 border-b border-gray-200 dark:border-gray-700 mb-4">
        <div className="flex gap-1">
          {TABS.map((t) => {
            const gaps =
              t.key === "clubs"
                ? summary.sessionsNeedingTeacher
                : summary.dutySlotsUnstaffed;
            return (
              <Link
                key={t.key}
                href={`?tab=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={
                  tab === t.key
                    ? "px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 -mb-px flex items-center gap-1.5"
                    : "px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1.5"
                }
              >
                {t.label}
                {/* Only when there is something to go and do, so the inactive
                    tab is worth a glance without being switched to. */}
                {gaps > 0 && (
                  <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                    {gaps}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Triage without reordering. The old layout floated gaps to the top of
            each column, which is why nothing lined up across rotations; asking
            "show me only the problems" as a filter answers the same need and
            leaves every remaining row where it was. */}
        <div className="mb-1.5 flex shrink-0 items-center gap-3">
          {clearedRowCount > 0 && (
            <button
              onClick={applyGapFilter}
              title="Drop the rows you have just finished covering"
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Hide {clearedRowCount} covered
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={gapRows !== null}
              onChange={(e) =>
                e.target.checked ? applyGapFilter() : setGapRows(null)
              }
              className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-1 focus:ring-indigo-500"
            />
            Only show gaps
          </label>
        </div>
      </div>

      {/* At xl this row takes whatever height main has left, and the grid inside
          it is the only thing that scrolls — so the panel's bottom edge is the
          bottom of the window rather than a guessed height with the page
          carrying on past it. It also gives both sticky axes a container to pin
          against: rotation headers stay put down a long list, the name column
          stays put scrolling sideways.
          items-start keeps the teacher panel at its own height instead of
          stretching it to match the grid. */}
      {/* min-h is the safety valve: on a short window with a lot above it, main
          scrolls a little rather than the grid shrinking to a couple of rows. */}
      <div className="flex flex-col xl:flex-row gap-5 items-start xl:flex-1 xl:min-h-[20rem]">
        {/* ── The grid: a row per club, a column per rotation ─────────── */}
        {/*
          One row per club rather than three independent columns of cards.

          The columns used to be sorted worst-first, each on its own, so a club
          running all three rotations appeared at three unrelated heights and
          its name was written three times. Admin reads this page across the day
          — "what is happening, and who is there?" — and that question needs the
          rotations to line up. They line up here because they are literally one
          grid row: the cells share a row height, so a club is a single
          horizontal band whatever its rotations do.
        */}
        <div className="w-full min-w-0 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 xl:h-full xl:w-auto xl:flex-1">
          <div className="grid min-w-[54rem] grid-cols-[minmax(11rem,15rem)_repeat(3,minmax(13rem,1fr))]">
            {/* ── Header row ────────────────────────────────────────── */}
            {/* Opaque, not the /50 the panels use elsewhere: these cells are
                sticky and would otherwise show the rows sliding under them. */}
            <div className="sticky left-0 top-0 z-30 border-b border-gray-200 dark:border-gray-700 bg-indigo-50 dark:bg-indigo-950 px-3 py-3">
              <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                {tab === "clubs" ? "Club" : "Duty post"}
              </span>
            </div>
            {ALL_ROTATIONS.map((rotation) => {
              // Live, and counted over every row rather than the filtered ones:
              // the header states a fact about the day, not about the view. It
              // drops the moment a slot is filled, which is what confirms the
              // action now that nothing moves.
              const uncovered = allRows.filter(
                (r) => cellState(r, rotation) === "needs"
              ).length;
              return (
                <div
                  key={rotation}
                  className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-l border-gray-200 dark:border-gray-700 bg-indigo-50 dark:bg-indigo-950 px-3 py-3"
                >
                  <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                    {ROTATION_LABELS[rotation]}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      uncovered === 0
                        ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                        : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                    }`}
                  >
                    {uncovered === 0 ? "All covered" : `${uncovered} uncovered`}
                  </span>
                </div>
              );
            })}

            {/* ── Rows ──────────────────────────────────────────────── */}
            {rows.map((row) => {
              const states = ALL_ROTATIONS.map((r) => cellState(row, r));
              // The row's worst cell, on the left edge, so scanning straight
              // down the name column finds the rows that need attention
              // without reading the cells.
              const rowAccent = states.includes("needs")
                ? "border-l-red-400"
                : states.includes("consider")
                  ? "border-l-amber-400"
                  : "border-l-transparent";

              const subtitle =
                row.kind === "club" ? row.roomName : row.duty.location;

              return (
                <Fragment key={row.key}>
                  <div
                    className={`sticky left-0 z-10 border-b border-l-4 border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-900 px-3 py-3 ${rowAccent}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span
                          className="block truncate text-sm font-medium text-gray-900 dark:text-white"
                          title={row.name}
                        >
                          {row.name}
                        </span>
                        {subtitle && (
                          <span
                            className="block truncate text-xs text-gray-400 dark:text-gray-500"
                            title={subtitle}
                          >
                            {subtitle}
                          </span>
                        )}
                      </span>
                      {row.kind === "duty" && (
                        // Marks this as building supervision rather than a club,
                        // in the pill vocabulary the rest of the app uses — not
                        // an emoji, which renders differently on every platform.
                        <span className="shrink-0 rounded-full border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                          Duty
                        </span>
                      )}
                    </div>
                  </div>

                  {ALL_ROTATIONS.map((rotation) => {
                    const state = cellState(row, rotation);

                    if (state === "not-scheduled")
                      return (
                        <NotScheduledCell
                          key={rotation}
                          label={`${row.name} is not ${
                            row.kind === "club" ? "scheduled for" : "required in"
                          } ${ROTATION_LABELS[rotation]}`}
                        />
                      );

                    if (row.kind === "club") {
                      // The session covering *this* rotation — its own roster,
                      // room and coverage, even though it shares a row.
                      const session = row.sessions[rotation]!;
                      return (
                        <ClubCell
                          key={rotation}
                          club={session}
                          rotation={rotation}
                          state={state}
                          // Stated per cell, not per row: an unlinked club's
                          // rotations have separate sign-up lists, so one number
                          // on the left would be three different numbers'
                          // worth of wrong — and it is this count that decides
                          // whether a rotation is nudged for a second teacher.
                          showRoom={row.roomName === null}
                          assignment={
                            assignments[session.sessionId]?.[rotation] ??
                            EMPTY_ASSIGNMENT
                          }
                          clashingTeachers={
                            clashesByCard.get(
                              `${session.sessionId}:${rotation}`
                            ) ?? []
                          }
                          onUndoAbsence={() =>
                            undoAbsences(
                              session.sessionId,
                              rotation,
                              assignments[session.sessionId]?.[rotation]
                                ?.absentTeacherIds ?? []
                            )
                          }
                          saveStatus={
                            saveStatus[session.sessionId]?.[rotation] ?? "idle"
                          }
                          teachers={teachers}
                          availableTeachers={(slot) =>
                            availableTeachersFor(rotation, {
                              kind: "club",
                              sessionId: session.sessionId,
                              slot,
                            })
                          }
                          onAssign={(slot, val) =>
                            assign(session.sessionId, rotation, slot, val)
                          }
                        />
                      );
                    }

                    return (
                      <DutyCell
                        key={rotation}
                        duty={row.duty}
                        rotation={rotation}
                        teacherId={
                          dutyAssignments[row.duty.dutyPostId]?.[rotation] ??
                          null
                        }
                        clashingTeachers={
                          clashesByCard.get(
                            `duty:${row.duty.dutyPostId}:${rotation}`
                          ) ?? []
                        }
                        saveStatus={
                          dutySaveStatus[row.duty.dutyPostId]?.[rotation] ??
                          "idle"
                        }
                        options={availableDutyTeachers(
                          rotation,
                          row.duty.dutyPostId
                        )}
                        teachers={teachers}
                        onAssign={(teacherId) =>
                          assignDuty(row.duty.dutyPostId, rotation, teacherId)
                        }
                      />
                    );
                  })}
                </Fragment>
              );
            })}

            {rows.length === 0 && (
              <div className="col-span-4 px-4 py-10 text-center">
                {gapRows !== null ? (
                  <>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Nothing is missing a teacher.
                    </p>
                    <button
                      onClick={() => setGapRows(null)}
                      className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Show everything
                    </button>
                  </>
                ) : tab === "building" && !summary.hasDutyPosts ? (
                  // Duty posts have no region of their own any more, so this is
                  // where an admin discovers the feature exists.
                  <>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No duty posts yet.
                    </p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Hallways, the cafeteria, the front doors.
                    </p>
                    <a
                      href="/admin/duty-posts"
                      className="mt-2 inline-block text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Set them up →
                    </a>
                  </>
                ) : (
                  <p className="text-sm italic text-gray-400 dark:text-gray-500">
                    {tab === "clubs"
                      ? "No clubs scheduled."
                      : "No duty posts for this flex day."}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Teacher sidebar ─────────────────────────────────────────── */}
        {/* Beside the grid where there is room for both, beneath it where there
            is not — it used to hold its 208px even at the width where the
            columns had already given up and stacked.
            max-h-full and its own scroll at xl: a long staff list is the other
            thing that can push past the bottom of the window, and the point of
            this layout is that nothing does. */}
        <div className="w-full shrink-0 xl:w-52 xl:max-h-full xl:overflow-y-auto">
          <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 bg-indigo-50 dark:bg-indigo-950/50 border-b border-gray-200 dark:border-gray-700">
              <span className="font-semibold text-sm text-indigo-700 dark:text-indigo-300">
                Teachers
              </span>
            </div>

            {[3, 2, 1, 0].map((freeCount) => {
              const label =
                freeCount === 3
                  ? "All 3 open"
                  : freeCount === 0
                    ? "Fully assigned"
                    : `${freeCount} open`;
              const group = teacherRows.filter(
                (t) => t.freeCount === freeCount
              );
              if (group.length === 0) return null;
              return (
                <div key={freeCount}>
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-y border-gray-200 dark:border-gray-700 uppercase tracking-wide">
                    {label}
                  </div>
                  {group.map((teacher) => (
                    <div
                      key={teacher.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                    >
                      <span
                        className="text-sm text-gray-700 dark:text-gray-200 truncate"
                        title={teacher.name}
                      >
                        {teacher.name}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        {ALL_ROTATIONS.map((r) => {
                          const assigned = teacher.assignedRotations.has(r);
                          return (
                            <span
                              key={r}
                              className={`text-xs px-1 py-0.5 rounded font-medium ${
                                assigned
                                  ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                                  : "border border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                              }`}
                            >
                              {SHORT_LABELS[r]}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Shared by every cell so the four states differ only where they mean to.
 *
 * `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`, so the
 * `flex-1` selects inside push the cell wider than its track and the last
 * column spills past the panel's own border.
 *
 * So is `relative`. `sr-only` is `position: absolute`, and an absolutely
 * positioned box is clipped by an ancestor's `overflow` only when that ancestor
 * is in its containing-block chain. With no positioned cell, the screen-reader
 * text in the cells below escaped the grid's scroll container from its static
 * position out at column three — giving the whole *page* an 86px sideways
 * scroll on a phone, from spans that are one pixel wide.
 */
const CELL_SHELL =
  "relative min-w-0 border-b border-l border-gray-100 dark:border-gray-700/50 px-3 py-3";

/**
 * A rotation this row does not take part in.
 *
 * Deliberately recessive — it is there to hold the row's shape so the cells
 * either side of it stay aligned with every other row, and to say the quiet
 * part the old layout could not: nothing is missing here, nothing is wanted
 * here. An empty white cell would read as an unfilled slot, which is the one
 * thing it must not be confused with.
 */
function NotScheduledCell({ label }: { label: string }) {
  return (
    <div
      // Hatched rather than merely pale. A plain empty cell was indistinguishable
      // from a slot nobody had filled in yet — the exact confusion this cell
      // exists to prevent — whereas a hatch reads as "no entry expected here" at
      // a glance and stays out of the way of the cells either side of it. The
      // dash is kept for high-contrast modes, which drop background images.
      className={`${CELL_SHELL} flex items-center justify-center bg-gray-50 dark:bg-gray-800/50 bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,rgb(0_0_0/0.05)_5px,rgb(0_0_0/0.05)_10px)] dark:bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,rgb(255_255_255/0.045)_5px,rgb(255_255_255/0.045)_10px)]`}
    >
      {/* The hatch carries no meaning to a screen reader, so the row's actual
          state is spelled out rather than left to a title tooltip. */}
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className="text-lg leading-none text-gray-400 dark:text-gray-600"
      >
        –
      </span>
    </div>
  );
}

/** Tint for a cell that is in play, by how much attention it wants. */
function cellTone(state: Urgency): string {
  return state === "needs"
    ? "bg-red-50/60 dark:bg-red-950/20"
    : state === "consider"
      ? "bg-amber-50/50 dark:bg-amber-950/20"
      : "";
}

function ClubCell({
  club,
  rotation,
  assignment,
  clashingTeachers,
  onUndoAbsence,
  saveStatus,
  teachers,
  availableTeachers,
  state,
  showRoom,
  onAssign,
}: {
  club: CoverageClub;
  rotation: RotationSlot;
  /** True when the row's sessions sit in different rooms, so the row can't say. */
  showRoom: boolean;
  assignment: Assignment;
  /** Names of teachers this cell double-books in this rotation; usually empty. */
  clashingTeachers: string[];
  /** Lifts every absence recorded on this cell's rotation. */
  onUndoAbsence: () => void;
  saveStatus: SaveStatus;
  teachers: CoverageTeacher[];
  availableTeachers: (slot: "t1" | "t2") => CoverageTeacher[];
  state: Urgency;
  onAssign: (slot: "t1" | "t2", value: string | null) => void;
}) {
  const statusIndicator =
    saveStatus === "saving" ? (
      <span className="text-gray-400 dark:text-gray-500 text-xs animate-pulse">
        Saving…
      </span>
    ) : saveStatus === "saved" ? (
      <span className="text-green-600 dark:text-green-400 text-xs font-medium">
        Saved ✓
      </span>
    ) : saveStatus === "error" ? (
      <span className="text-red-500 dark:text-red-400 text-xs font-medium">
        Error — retry
      </span>
    ) : null;

  // Anyone recorded as not attending this rotation. This is *state*, not an
  // offered action: the control that set it lives in the clash banner, where the
  // decision is actually made. It used to be a "Not here" button beside every
  // resolved teacher on every card — roughly twenty buttons on a normal day for
  // something used once or twice, which made a card look like it was asking far
  // more of the admin than it was.
  //
  // Absent teachers are resolved *out* of t1/t2 by src/lib/coverage.ts, so
  // without this line an admin would see an empty slot with no way to tell why
  // and no way back.
  const absentHere = assignment.absentTeacherIds.map(
    (id) => teachers.find((t) => t.id === id)?.name ?? "A teacher"
  );

  // The name is the row's; the roster is this rotation's. An unlinked club's
  // three sessions have three sign-up lists, so the head count belongs beside
  // the slot it describes — and it is this count that decides whether the
  // rotation gets nudged for a second teacher.
  return (
    <div className={`${CELL_SHELL} ${cellTone(state)}`}>
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {club.studentCount > 0 && (
            <span
              className={`shrink-0 text-xs ${
                club.studentCount >= HIGH_ENROLLMENT_THRESHOLD
                  ? "font-semibold text-red-600 dark:text-red-400"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              👤 {club.studentCount}
            </span>
          )}
          {showRoom && club.roomName && (
            <span
              className="truncate text-xs text-gray-400 dark:text-gray-500"
              title={club.roomName}
            >
              {club.roomName}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {clashingTeachers.length > 0 && (
            <span
              title={`${clashingTeachers.join(", ")} ${
                clashingTeachers.length === 1 ? "is" : "are"
              } also expected elsewhere this rotation`}
              className="rounded-full border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
            >
              Double-booked
            </span>
          )}
          {statusIndicator}
        </span>
      </div>
      <div className="space-y-1.5">
        <TeacherDropdown
          label="T1"
          ariaLabel={`${club.name} — ${ROTATION_LABELS[rotation]} primary teacher`}
          value={assignment.t1Cleared ? CLEARED : assignment.t1}
          options={availableTeachers("t1")}
          currentTeacher={
            assignment.t1
              ? (teachers.find((t) => t.id === assignment.t1) ?? null)
              : null
          }
          required
          // Same three states as T2, one slot over. A club with an owner needs
          // both empty states offered: "" falls back to them, CLEARED means
          // genuinely nobody and leaves the rotation flagged as needing cover.
          // Without the second option, choosing "None" wrote a null the owner
          // fallback silently undid — the bug this pair of options fixes.
          defaultLabel={club.ownerName ? `Owner (${club.ownerName})` : null}
          clearedLabel="None — needs cover"
          onChange={(v) => onAssign("t1", v)}
        />
        <TeacherDropdown
          label="T2"
          ariaLabel={`${club.name} — ${ROTATION_LABELS[rotation]} second teacher`}
          value={assignment.t2Cleared ? CLEARED : assignment.t2}
          options={availableTeachers("t2")}
          currentTeacher={
            assignment.t2
              ? (teachers.find((t) => t.id === assignment.t2) ?? null)
              : null
          }
          required={false}
          // A club with a cosponsor needs both empty states offered: "" falls back
          // to them, CLEARED means genuinely nobody. With no cosponsor the two are
          // the same thing, so only one option is shown.
          defaultLabel={
            club.cosponsorName ? `Cosponsor (${club.cosponsorName})` : null
          }
          clearedLabel="None — no second teacher"
          onChange={(v) => onAssign("t2", v)}
        />
      </div>

      {absentHere.length > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {absentHere.join(", ")} not attending{" "}
          <button
            onClick={onUndoAbsence}
            className="font-medium underline hover:no-underline"
          >
            undo
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * One duty post's slot for one rotation.
 *
 * Shares ClubCell's grammar exactly — the same cell shell, the same tint, the
 * same save micro-labels, the same select colouring including the opaque
 * `dark:bg-*-950` a translucent fill would wash out — and differs only where the
 * data does. A duty post has no second teacher, no students, and no owner to
 * fall back to, so there is one dropdown and no cleared-vs-default ambiguity:
 * empty simply means unstaffed.
 *
 * A post required in Flex 1 and Flex 3 renders two of these on its row, with a
 * NotScheduledCell between them reading "not required in Flex 2" — a thing the
 * old layout had no way to say, since a post simply had no card in the columns
 * it was not wanted in.
 */
function DutyCell({
  duty,
  rotation,
  teacherId,
  clashingTeachers,
  saveStatus,
  options,
  teachers,
  onAssign,
}: {
  duty: CoverageDuty;
  rotation: RotationSlot;
  teacherId: string | null;
  clashingTeachers: string[];
  saveStatus: SaveStatus;
  options: CoverageTeacher[];
  teachers: CoverageTeacher[];
  onAssign: (teacherId: string | null) => void;
}) {
  const assigned = teacherId !== null;

  // Always offer whoever is currently assigned, even when the availability
  // filter would exclude them — otherwise an existing assignment vanishes from
  // its own dropdown.
  const current = assigned
    ? (teachers.find((t) => t.id === teacherId) ?? null)
    : null;
  const inOptions = current !== null && options.some((t) => t.id === current.id);

  // Name, location and the Duty pill belong to the row, on the left.
  return (
    <div
      className={`${CELL_SHELL} ${cellTone(assigned ? "covered" : "needs")}`}
    >
      {(clashingTeachers.length > 0 || saveStatus !== "idle") && (
        <div className="mb-1.5 flex items-center justify-end gap-1.5">
          {clashingTeachers.length > 0 && (
            <span
              title={`${clashingTeachers.join(", ")} ${
                clashingTeachers.length === 1 ? "is" : "are"
              } also expected elsewhere this rotation`}
              className="rounded-full border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
            >
              Double-booked
            </span>
          )}
          {saveStatus === "saving" && (
            <span className="text-gray-400 dark:text-gray-500 text-xs animate-pulse">
              Saving…
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-green-600 dark:text-green-400 text-xs font-medium">
              Saved ✓
            </span>
          )}
          {saveStatus === "error" && (
            <span className="text-red-500 dark:text-red-400 text-xs font-medium">
              Error — retry
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-5 shrink-0">
          {SHORT_LABELS[rotation]}
        </span>
        <select
          aria-label={`${duty.name} — ${ROTATION_LABELS[rotation]} teacher`}
          // min-w-0 for the same reason as the club selects above.
          className={`min-w-0 flex-1 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            assigned
              ? "bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700 text-gray-900 dark:text-gray-100"
              : "bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700 text-gray-600 dark:text-gray-200"
          }`}
          value={teacherId ?? ""}
          onChange={(e) => onAssign(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">Unstaffed</option>
          {current && !inOptions && (
            <option value={current.id}>{current.name}</option>
          )}
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function TeacherDropdown({
  label,
  ariaLabel,
  value,
  options,
  currentTeacher,
  required,
  defaultLabel,
  clearedLabel,
  onChange,
}: {
  label: string;
  /**
   * What a screen reader announces. The visible "T1"/"T2" is a bare span next to
   * the control, not a <label>, and on its own it says nothing about which club
   * or rotation is being edited — on a page of thirty near-identical selects.
   */
  ariaLabel: string;
  value: string | null;
  options: CoverageTeacher[];
  currentTeacher: CoverageTeacher | null;
  required: boolean;
  /**
   * Label for "" — falling back to a club default. Null when there is no default
   * to fall back to, in which case the option is omitted entirely rather than
   * offering the admin two choices that do the same thing.
   */
  defaultLabel?: string | null;
  /** Label for the CLEARED sentinel. Omitted for slots with no cleared state. */
  clearedLabel?: string;
  onChange: (value: string | null) => void;
}) {
  const isCleared = value === CLEARED;
  const isAssigned = value !== null && !isCleared;

  // Opaque backgrounds in dark mode: a translucent fill (previously /40) sits over
  // the browser's own control surface and washes the text out, which is worst on
  // exactly these two states since they're the ones scanned most.
  const selectClass = isAssigned
    ? "bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700 text-gray-900 dark:text-gray-100"
    : required
      ? "bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700 text-gray-600 dark:text-gray-200"
      : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-200";

  // Always include the currently selected teacher even if they'd be filtered out
  const inOptions = isAssigned && options.some((t) => t.id === value);
  const extraOption = currentTeacher && !inOptions ? currentTeacher : null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-5 shrink-0">
        {label}
      </span>
      <select
        aria-label={ariaLabel}
        // min-w-0: a flex item will not shrink below its content, and a select's
        // content is its *widest option* — "Cosponsor (Nina Brooks)" — so without
        // this the control pushes its cell past the panel's right edge.
        className={`min-w-0 flex-1 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 ${selectClass}`}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value)
        }
      >
        {/* With no club default, "" and CLEARED mean the same thing, so only the
            cleared option is offered and it carries the plain "None" label. */}
        {defaultLabel !== null && defaultLabel !== undefined ? (
          <>
            <option value="">{defaultLabel}</option>
            {clearedLabel && <option value={CLEARED}>{clearedLabel}</option>}
          </>
        ) : (
          <option value="">None</option>
        )}
        {extraOption && (
          <option key={extraOption.id} value={extraOption.id}>
            {extraOption.name}
          </option>
        )}
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
