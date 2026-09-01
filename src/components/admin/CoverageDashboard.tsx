"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
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
  name: string;
  /** Labels the "fall back to the owner" option; not used to derive anything. */
  ownerName: string | null;
  /** Labels the "fall back to the cosponsor" option; not used to derive anything. */
  cosponsorName: string | null;
  /** Teachers who rotate through this club — offered first in the dropdowns. */
  poolTeacherIds: string[];
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
type SaveStatus = "idle" | "saving" | "saved" | "error";
type SaveStatuses = Record<string, Partial<Record<RotationSlot, SaveStatus>>>;

type Urgency = "needs" | "consider" | "covered";

/**
 * One thing in a rotation column. Clubs and duty posts share the column, the
 * urgency banding and the card grammar, but not their content — a duty post has
 * no second teacher, no students and no absences — so they stay separate shapes
 * rather than one type full of nullable fields.
 */
/** The urgency bands a column renders, worst first — gaps float to the top. */
const BANDS = [
  { urgency: "needs", label: "Needs teacher", color: "red" },
  { urgency: "consider", label: "Consider 2nd", color: "amber" },
  { urgency: "covered", label: "Covered", color: "gray" },
] as const satisfies readonly {
  urgency: Urgency;
  label: string;
  color: "red" | "amber" | "gray";
}[];

type ColumnItem =
  | { kind: "club"; key: string; club: CoverageClub; urgency: Urgency }
  | { kind: "duty"; key: string; duty: CoverageDuty; urgency: Urgency };

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
}: {
  clubs: CoverageClub[];
  teachers: CoverageTeacher[];
  duties: CoverageDuty[];
  flexDayId: string;
  clashes: CoverageClash[];
  summary: CoverageSummary;
  flexDayLabel: string;
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
  const [dutyAssignments, setDutyAssignments] = useState(() =>
    Object.fromEntries(duties.map((d) => [d.dutyPostId, { ...d.assignments }]))
  );
  const [dutySaveStatus, setDutySaveStatus] = useState<SaveStatuses>({});

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
   * Teachers available for a slot, with the club's own pool first.
   *
   * For a club run by a rotation of teachers, the pool is almost always the right
   * answer, and scanning the whole staff list to find one of four names is
   * needless work.
   */
  function getAvailableTeachersForClub(
    club: CoverageClub,
    rotation: RotationSlot,
    slot: "t1" | "t2"
  ): CoverageTeacher[] {
    const available = availableTeachersFor(rotation, {
      kind: "club",
      sessionId: club.sessionId,
      slot,
    });
    if (club.poolTeacherIds.length === 0) return available;
    const pool = new Set(club.poolTeacherIds);
    return [
      ...available.filter((t) => pool.has(t.id)),
      ...available.filter((t) => !pool.has(t.id)),
    ];
  }

  // Derive teacher sidebar data from current assignments
  const teacherRows = useMemo(() => {
    return teachers
      .map((t) => {
        const assignedRotations = new Set<RotationSlot>();
        for (const club of clubs) {
          for (const [r, a] of Object.entries(
            assignments[club.sessionId] ?? {}
          ) as [RotationSlot, Assignment][]) {
            if (a.t1 === t.id || a.t2 === t.id) {
              assignedRotations.add(r);
            }
          }
        }
        const freeCount = ALL_ROTATIONS.filter(
          (r) => !assignedRotations.has(r)
        ).length;
        return { ...t, freeCount, assignedRotations };
      })
      .sort((a, b) => b.freeCount - a.freeCount);
  }, [teachers, clubs, assignments]);

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
   * One function for clubs and duty posts, because they are one question:
   * nobody can be in two rooms at once, so anyone already expected somewhere in
   * this rotation is not on offer anywhere else in it.
   *
   * It was two functions, and they drifted — the duty one excluded teachers busy
   * on clubs *and* duty, the club one only looked at clubs. So a teacher on
   * cafeteria duty in Flex 1 was still offered as a club's T1 in Flex 1. That was
   * invisible while duty lived in its own region at the bottom of the page and
   * indefensible once the two sit in the same column. Written once, it cannot
   * drift again.
   *
   * `exclude` is the slot being edited, so a card never competes with itself: the
   * teacher currently in this very slot stays on offer, while the sibling slot on
   * the same club card does not (T1 and T2 must be two different people).
   */
  function availableTeachersFor(
    rotation: RotationSlot,
    exclude:
      | { kind: "club"; sessionId: string; slot: "t1" | "t2" }
      | { kind: "duty"; dutyPostId: string }
  ): CoverageTeacher[] {
    const taken = new Set<string>();

    for (const club of clubs) {
      if (!club.rotations.includes(rotation)) continue;
      const a = assignments[club.sessionId]?.[rotation];
      if (exclude.kind === "club" && club.sessionId === exclude.sessionId) {
        // Only the sibling slot on this card blocks; this slot's own occupant
        // must stay selectable or it vanishes from its own dropdown.
        const sibling = exclude.slot === "t1" ? a?.t2 : a?.t1;
        if (sibling) taken.add(sibling);
        continue;
      }
      if (a?.t1) taken.add(a.t1);
      if (a?.t2) taken.add(a.t2);
    }

    for (const duty of duties) {
      if (exclude.kind === "duty" && duty.dutyPostId === exclude.dutyPostId) {
        continue;
      }
      const assigned = dutyAssignments[duty.dutyPostId]?.[rotation] ?? null;
      if (assigned) taken.add(assigned);
    }

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

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
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
      <div className="mb-5 grid grid-cols-3 gap-3">
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

      {/* Without duty posts in their own region any more, this is the only thing
          that tells an admin the feature exists. */}
      {!summary.hasDutyPosts && (
        <p className="-mt-3 mb-5 text-xs text-gray-400 dark:text-gray-500">
          No duty posts yet — hallways, the cafeteria, the front doors.{" "}
          <a
            href="/admin/duty-posts"
            className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Set them up →
          </a>
        </p>
      )}

      {/* Nobody can be in two rooms at once. Warn, never block — it is legitimate
          to know about a clash and sort it out later.
          This is also where the fix lives. It used to be a "Not here" button on
          every card beside every resolved teacher; the decision is only ever made
          when a clash appears, so it belongs here, where the clash is named. */}
      {clashes.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {clashes.length === 1
              ? "1 teacher is expected in two places at once"
              : `${clashes.length} teachers are expected in two places at once`}
          </p>
          <ul className="mt-2 space-y-2">
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

      <div className="flex gap-5">
        {/* ── Three rotation columns ─────────────────────────────────── */}
        {/* lg:, matching the other three rotation grids in the app. Below that
            the columns stack rather than becoming three ~90px lanes of selects. */}
        <div className="flex-1 grid gap-4 lg:grid-cols-3 min-w-0">
          {ALL_ROTATIONS.map((rotation) => {
            // Clubs and duty posts on one axis.
            //
            // Duty used to be a separate region below the columns, laid out
            // post-major (a card per post, rotations nested inside) — the
            // transpose of the columns above it, so the page read as two
            // unrelated screens stacked. A duty slot *is* "someone must be here
            // during Flex 1", the same shape as a club session, so it belongs in
            // that rotation's column and in the same urgency banding. An
            // unstaffed cafeteria now surfaces under "Needs teacher" at the top
            // of its column instead of below the fold.
            const items: ColumnItem[] = [
              ...clubs
                .filter((c) => c.rotations.includes(rotation))
                .map((club) => ({
                  kind: "club" as const,
                  key: club.sessionId,
                  club,
                  urgency: urgencyOf(club, assignments[club.sessionId]?.[rotation]),
                })),
              // Duty after clubs within each band, so the building posts stay
              // clustered and scannable while still sorting by urgency.
              ...duties
                .filter((d) => d.rotations.includes(rotation))
                .map((duty) => ({
                  kind: "duty" as const,
                  key: `duty:${duty.dutyPostId}`,
                  duty,
                  // Never "consider": that is a second-teacher judgement and a
                  // duty post has no second teacher.
                  urgency: (dutyAssignments[duty.dutyPostId]?.[rotation]
                    ? "covered"
                    : "needs") as Urgency,
                })),
            ];

            const grouped = {
              needs: items.filter((i) => i.urgency === "needs"),
              consider: items.filter((i) => i.urgency === "consider"),
              covered: items.filter((i) => i.urgency === "covered"),
            };
            // Counts duty too, or the header would contradict the cards under it.
            const uncoveredCount = grouped.needs.length;

            return (
              <div
                key={rotation}
                className="flex flex-col rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 dark:bg-indigo-950/50 border-b border-gray-200 dark:border-gray-700">
                  <span className="font-semibold text-sm text-indigo-700 dark:text-indigo-300">
                    {ROTATION_LABELS[rotation]}
                  </span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      uncoveredCount === 0
                        ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                        : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                    }`}
                  >
                    {uncoveredCount === 0
                      ? "All covered"
                      : `${uncoveredCount} uncovered`}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto">
                  {items.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-center text-gray-400 dark:text-gray-500 italic">
                      Nothing scheduled.
                    </p>
                  ) : (
                    // One loop over the three urgency bands rather than three
                    // near-identical copies of the same forty lines — which is
                    // what made adding a second card type worth doing properly.
                    BANDS.map(({ urgency, label, color }) =>
                      grouped[urgency].length === 0 ? null : (
                        <div key={urgency}>
                          <SectionLabel label={label} color={color} />
                          {grouped[urgency].map((item) =>
                            item.kind === "club" ? (
                              <ClubCard
                                key={item.key}
                                club={item.club}
                                rotation={rotation}
                                assignment={
                                  assignments[item.club.sessionId]?.[rotation] ??
                                  EMPTY_ASSIGNMENT
                                }
                                clashingTeachers={
                                  clashesByCard.get(
                                    `${item.club.sessionId}:${rotation}`
                                  ) ?? []
                                }
                                onUndoAbsence={() =>
                                  undoAbsences(
                                    item.club.sessionId,
                                    rotation,
                                    assignments[item.club.sessionId]?.[rotation]
                                      ?.absentTeacherIds ?? []
                                  )
                                }
                                saveStatus={
                                  saveStatus[item.club.sessionId]?.[rotation] ??
                                  "idle"
                                }
                                teachers={teachers}
                                availableTeachers={(slot) =>
                                  getAvailableTeachersForClub(
                                    item.club,
                                    rotation,
                                    slot
                                  )
                                }
                                urgency={item.urgency}
                                onAssign={(slot, val) =>
                                  assign(item.club.sessionId, rotation, slot, val)
                                }
                              />
                            ) : (
                              <DutyCard
                                key={item.key}
                                duty={item.duty}
                                rotation={rotation}
                                teacherId={
                                  dutyAssignments[item.duty.dutyPostId]?.[
                                    rotation
                                  ] ?? null
                                }
                                clashingTeachers={
                                  clashesByCard.get(
                                    `duty:${item.duty.dutyPostId}:${rotation}`
                                  ) ?? []
                                }
                                saveStatus={
                                  dutySaveStatus[item.duty.dutyPostId]?.[
                                    rotation
                                  ] ?? "idle"
                                }
                                options={availableDutyTeachers(
                                  rotation,
                                  item.duty.dutyPostId
                                )}
                                teachers={teachers}
                                onAssign={(teacherId) =>
                                  assignDuty(
                                    item.duty.dutyPostId,
                                    rotation,
                                    teacherId
                                  )
                                }
                              />
                            )
                          )}
                        </div>
                      )
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Teacher sidebar ─────────────────────────────────────────── */}
        <div className="w-52 shrink-0">
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

function SectionLabel({
  label,
  color,
}: {
  label: string;
  color: "red" | "amber" | "gray";
}) {
  const styles = {
    red: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30",
    amber:
      "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30",
    gray: "text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50",
  };
  return (
    <div
      className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide border-y border-gray-100 dark:border-gray-700/50 ${styles[color]}`}
    >
      {label}
    </div>
  );
}

function ClubCard({
  club,
  rotation,
  assignment,
  clashingTeachers,
  onUndoAbsence,
  saveStatus,
  teachers,
  availableTeachers,
  urgency,
  onAssign,
}: {
  club: CoverageClub;
  rotation: RotationSlot;
  assignment: Assignment;
  /** Names of teachers this card double-books in this rotation; usually empty. */
  clashingTeachers: string[];
  /** Lifts every absence recorded on this card's rotation. */
  onUndoAbsence: () => void;
  saveStatus: SaveStatus;
  teachers: CoverageTeacher[];
  availableTeachers: (slot: "t1" | "t2") => CoverageTeacher[];
  urgency: "needs" | "consider" | "covered";
  onAssign: (slot: "t1" | "t2", value: string | null) => void;
}) {
  const borderColor =
    urgency === "needs"
      ? "border-l-red-400"
      : urgency === "consider"
        ? "border-l-amber-400"
        : "border-l-transparent";

  const isHighEnrollment = club.studentCount >= HIGH_ENROLLMENT_THRESHOLD;

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

  return (
    <div
      className={`px-4 py-3 border-l-4 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 ${borderColor}`}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <span
          className="text-sm font-medium text-gray-900 dark:text-white truncate"
          title={club.name}
        >
          {club.name}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
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
          {club.studentCount > 0 && (
            <span
              className={`text-xs ${
                isHighEnrollment
                  ? "text-red-600 dark:text-red-400 font-semibold"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              👤 {club.studentCount}
            </span>
          )}
        </div>
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
 * Shares ClubCard's grammar exactly — the same row shell, the same left-border
 * urgency accent, the same save micro-labels, the same select colouring including
 * the opaque `dark:bg-*-950` a translucent fill would wash out — and differs only
 * where the data does. A duty post has no second teacher, no students, and no
 * owner to fall back to, so there is one dropdown and no cleared-vs-default
 * ambiguity: empty simply means unstaffed.
 *
 * A post required in Flex 1 and Flex 3 renders two of these, one per column.
 * That is the point: a slot is a thing that lives in its rotation, not a row
 * nested inside a post.
 */
function DutyCard({
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

  return (
    <div
      className={`px-4 py-3 border-l-4 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 ${
        assigned ? "border-l-transparent" : "border-l-red-400"
      }`}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="min-w-0">
          <span
            className="block text-sm font-medium text-gray-900 dark:text-white truncate"
            title={duty.name}
          >
            {duty.name}
          </span>
          {duty.location && (
            <span className="block text-xs text-gray-400 dark:text-gray-500 truncate">
              {duty.location}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
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
          {/* Marks this as building supervision rather than a club, in the pill
              vocabulary the rest of the app uses — not an emoji, which renders
              differently on every platform. */}
          <span className="rounded-full border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
            Duty
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-5 shrink-0">
          {SHORT_LABELS[rotation]}
        </span>
        <select
          aria-label={`${duty.name} — ${ROTATION_LABELS[rotation]} teacher`}
          className={`flex-1 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
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
        className={`flex-1 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 ${selectClass}`}
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
