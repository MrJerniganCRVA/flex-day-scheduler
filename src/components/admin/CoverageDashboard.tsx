"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import CoverageAbsenceButton from "@/components/admin/CoverageAbsenceButton";
import type { RotationSlot } from "@prisma/client";

const HIGH_ENROLLMENT_THRESHOLD = 20;

const ROTATION_LABELS: Record<RotationSlot, string> = {
  FLEX_1: "Flex 1",
  FLEX_2: "Flex 2",
  FLEX_3: "Flex 3",
};

const SHORT_LABELS: Record<RotationSlot, string> = {
  FLEX_1: "F1",
  FLEX_2: "F2",
  FLEX_3: "F3",
};

const ALL_ROTATIONS: RotationSlot[] = ["FLEX_1", "FLEX_2", "FLEX_3"];

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

function urgencyOf(
  club: CoverageClub,
  assignment: Assignment | undefined
): "needs" | "consider" | "covered" {
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
  flexDayLabel,
}: {
  clubs: CoverageClub[];
  teachers: CoverageTeacher[];
  duties: CoverageDuty[];
  flexDayId: string;
  clashes: CoverageClash[];
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
    const available = getAvailableTeachers(club.sessionId, rotation, slot);
    if (club.poolTeacherIds.length === 0) return available;
    const pool = new Set(club.poolTeacherIds);
    return [
      ...available.filter((t) => pool.has(t.id)),
      ...available.filter((t) => !pool.has(t.id)),
    ];
  }

  // Teachers available for a given slot, filtered by rotation conflicts
  function getAvailableTeachers(
    sessionId: string,
    rotation: RotationSlot,
    slot: "t1" | "t2"
  ): CoverageTeacher[] {
    const taken = new Set<string>();
    const sessionsInRotation = clubs.filter((c) =>
      c.rotations.includes(rotation)
    );
    for (const s of sessionsInRotation) {
      const a = assignments[s.sessionId]?.[rotation];
      if (s.sessionId === sessionId) {
        // Exclude the sibling slot in the same card
        const other = slot === "t1" ? a?.t2 : a?.t1;
        if (other) taken.add(other);
      } else {
        if (a?.t1) taken.add(a.t1);
        if (a?.t2) taken.add(a.t2);
      }
    }
    return teachers.filter((t) => !taken.has(t.id));
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
   * Teachers offerable for a duty slot.
   *
   * Filtered the same way the club dropdowns are: anyone already covering a club
   * or another duty post in this rotation is left out, so the workflow an admin
   * actually uses — clear the teacher off the club, then put them on duty — reads
   * the way it behaves. Until the club slot is genuinely cleared, that teacher
   * simply is not in the list.
   *
   * The currently-assigned teacher is always kept, so an existing assignment
   * never silently disappears from its own dropdown.
   */
  function availableDutyTeachers(
    rotation: RotationSlot,
    currentTeacherId: string | null
  ): CoverageTeacher[] {
    const taken = new Set<string>();
    for (const club of clubs) {
      if (!club.rotations.includes(rotation)) continue;
      const a = assignments[club.sessionId]?.[rotation];
      if (a?.t1) taken.add(a.t1);
      if (a?.t2) taken.add(a.t2);
    }
    for (const duty of duties) {
      const assigned = dutyAssignments[duty.dutyPostId]?.[rotation] ?? null;
      if (assigned) taken.add(assigned);
    }
    if (currentTeacherId) taken.delete(currentTeacherId);
    return teachers.filter((t) => !taken.has(t.id));
  }

  // How much of the building is unstaffed — the single number that answers
  // "does the building have adequate eyes". Counts only required rotations, so a
  // post that needs no cover in Flex 2 is not counted as a gap there.
  const totalDutySlots = duties.reduce((n, d) => n + d.rotations.length, 0);
  const unstaffedDutyCount = duties.reduce(
    (n, d) =>
      n +
      d.rotations.filter(
        (r) => !(dutyAssignments[d.dutyPostId]?.[r] ?? null)
      ).length,
    0
  );

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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Coverage
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {flexDayLabel}
        </p>
      </div>

      {/* Nobody can be in two rooms at once. Warn, never block — it is legitimate
          to know about a clash and sort it out later. The fix is the "Not here"
          control on whichever card the teacher is not attending. */}
      {clashes.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {clashes.length === 1
              ? "1 teacher is expected in two places at once"
              : `${clashes.length} teachers are expected in two places at once`}
          </p>
          <ul className="mt-1.5 space-y-1">
            {clashes.map((clash) => (
              <li
                key={`${clash.teacherId}:${clash.rotation}`}
                className="text-xs text-amber-700 dark:text-amber-300"
              >
                <span className="font-medium">{clash.teacherName}</span> in{" "}
                {ROTATION_LABELS[clash.rotation]} —{" "}
                {clash.placements.map((p) => p.name).join(" and ")}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            Use <span className="font-medium">Not here</span> on the session they
            will not attend. It keeps running and shows as needing cover.
          </p>
        </div>
      )}

      <div className="flex gap-5">
        {/* ── Three rotation columns ─────────────────────────────────── */}
        <div className="flex-1 grid grid-cols-3 gap-4 min-w-0">
          {ALL_ROTATIONS.map((rotation) => {
            const sessionsInRotation = clubs.filter((c) =>
              c.rotations.includes(rotation)
            );
            const grouped = {
              needs: sessionsInRotation.filter(
                (c) =>
                  urgencyOf(c, assignments[c.sessionId]?.[rotation]) === "needs"
              ),
              consider: sessionsInRotation.filter(
                (c) =>
                  urgencyOf(c, assignments[c.sessionId]?.[rotation]) ===
                  "consider"
              ),
              covered: sessionsInRotation.filter(
                (c) =>
                  urgencyOf(c, assignments[c.sessionId]?.[rotation]) ===
                  "covered"
              ),
            };
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
                  {sessionsInRotation.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-center text-gray-400 dark:text-gray-500 italic">
                      No clubs scheduled.
                    </p>
                  ) : (
                    <>
                      {grouped.needs.length > 0 && (
                        <>
                          <SectionLabel label="Needs teacher" color="red" />
                          {grouped.needs.map((club) => (
                            <ClubCard
                              key={club.sessionId}
                              club={club}
                              rotation={rotation}
                              assignment={
                                assignments[club.sessionId]?.[rotation] ?? EMPTY_ASSIGNMENT
                              }
                              clashingTeachers={
                                clashesByCard.get(
                                  `${club.sessionId}:${rotation}`
                                ) ?? []
                              }
                              saveStatus={
                                saveStatus[club.sessionId]?.[rotation] ?? "idle"
                              }
                              teachers={teachers}
                              availableTeachers={(slot) =>
                                getAvailableTeachersForClub(
                                  club,
                                  rotation,
                                  slot
                                )
                              }
                              urgency="needs"
                              onAssign={(slot, val) =>
                                assign(club.sessionId, rotation, slot, val)
                              }
                            />
                          ))}
                        </>
                      )}
                      {grouped.consider.length > 0 && (
                        <>
                          <SectionLabel label="Consider 2nd" color="amber" />
                          {grouped.consider.map((club) => (
                            <ClubCard
                              key={club.sessionId}
                              club={club}
                              rotation={rotation}
                              assignment={
                                assignments[club.sessionId]?.[rotation] ?? EMPTY_ASSIGNMENT
                              }
                              clashingTeachers={
                                clashesByCard.get(
                                  `${club.sessionId}:${rotation}`
                                ) ?? []
                              }
                              saveStatus={
                                saveStatus[club.sessionId]?.[rotation] ?? "idle"
                              }
                              teachers={teachers}
                              availableTeachers={(slot) =>
                                getAvailableTeachersForClub(
                                  club,
                                  rotation,
                                  slot
                                )
                              }
                              urgency="consider"
                              onAssign={(slot, val) =>
                                assign(club.sessionId, rotation, slot, val)
                              }
                            />
                          ))}
                        </>
                      )}
                      {grouped.covered.length > 0 && (
                        <>
                          <SectionLabel label="Covered" color="gray" />
                          {grouped.covered.map((club) => (
                            <ClubCard
                              key={club.sessionId}
                              club={club}
                              rotation={rotation}
                              assignment={
                                assignments[club.sessionId]?.[rotation] ?? EMPTY_ASSIGNMENT
                              }
                              clashingTeachers={
                                clashesByCard.get(
                                  `${club.sessionId}:${rotation}`
                                ) ?? []
                              }
                              saveStatus={
                                saveStatus[club.sessionId]?.[rotation] ?? "idle"
                              }
                              teachers={teachers}
                              availableTeachers={(slot) =>
                                getAvailableTeachersForClub(
                                  club,
                                  rotation,
                                  slot
                                )
                              }
                              urgency="covered"
                              onAssign={(slot, val) =>
                                assign(club.sessionId, rotation, slot, val)
                              }
                            />
                          ))}
                        </>
                      )}
                    </>
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

      {/* ── Building coverage ───────────────────────────────────────────
          Supervision that isn't a club. A separate group rather than a fourth
          column: these aren't scheduled against rotations the way clubs are —
          each post declares which rotations it must be staffed for, and only
          those get a slot, so a blank always means "needs someone". */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Building coverage
          </h2>
          {duties.length > 0 && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                unstaffedDutyCount === 0
                  ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                  : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
              }`}
            >
              {unstaffedDutyCount === 0
                ? `All ${totalDutySlots} staffed`
                : `${unstaffedDutyCount} of ${totalDutySlots} unstaffed`}
            </span>
          )}
        </div>

        {duties.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No duty posts set up yet.
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Hallways, the cafeteria, the front doors — the spots that need eyes
              on them but aren&apos;t clubs.
            </p>
            <a
              href="/admin/duty-posts"
              className="mt-2 inline-block text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Set up duty posts →
            </a>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {duties.map((duty) => (
              <div
                key={duty.dutyPostId}
                className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4"
              >
                <div className="mb-2">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {duty.name}
                  </div>
                  {duty.location && (
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {duty.location}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  {duty.rotations.map((rotation) => {
                    const teacherId =
                      dutyAssignments[duty.dutyPostId]?.[rotation] ?? null;
                    const status =
                      dutySaveStatus[duty.dutyPostId]?.[rotation] ?? "idle";
                    const clashing =
                      clashesByCard.get(`duty:${duty.dutyPostId}:${rotation}`) ??
                      [];
                    return (
                      <div key={rotation}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-5 shrink-0">
                            {SHORT_LABELS[rotation]}
                          </span>
                          <select
                            aria-label={`${duty.name} — ${ROTATION_LABELS[rotation]}`}
                            className={`flex-1 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                              teacherId
                                ? "bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700 text-gray-900 dark:text-gray-100"
                                : "bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700 text-gray-600 dark:text-gray-200"
                            }`}
                            value={teacherId ?? ""}
                            onChange={(e) =>
                              assignDuty(
                                duty.dutyPostId,
                                rotation,
                                e.target.value === "" ? null : e.target.value
                              )
                            }
                          >
                            <option value="">Unstaffed</option>
                            {/* Same availability filter the club dropdowns use, so
                                a teacher already covering a club this rotation is
                                simply not offered — which is what makes the usual
                                flow (clear the club slot first, then assign the
                                duty) read the way it behaves. */}
                            {availableDutyTeachers(rotation, teacherId).map(
                              (t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              )
                            )}
                          </select>
                        </div>
                        {(status !== "idle" || clashing.length > 0) && (
                          <div className="mt-0.5 pl-7 flex items-center gap-2">
                            {status === "saving" && (
                              <span className="text-[10px] text-gray-400 dark:text-gray-500 animate-pulse">
                                Saving…
                              </span>
                            )}
                            {status === "saved" && (
                              <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                                Saved ✓
                              </span>
                            )}
                            {status === "error" && (
                              <span className="text-[10px] text-red-500 dark:text-red-400 font-medium">
                                Error — retry
                              </span>
                            )}
                            {clashing.length > 0 && (
                              <span
                                title={`${clashing.join(", ")} is also expected elsewhere this rotation`}
                                className="text-[10px] text-amber-700 dark:text-amber-300 font-medium"
                              >
                                Double-booked
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
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

  // Everyone this rotation currently has in the room, plus anyone already marked
  // absent from it. The absent are resolved *out* of t1/t2 by
  // src/lib/coverage.ts, so without adding them back here the control that set
  // the mark would vanish along with it and there would be no way to undo.
  const nameOf = (id: string) =>
    teachers.find((t) => t.id === id)?.name ?? "This teacher";
  const absenceTargets = [
    ...new Set(
      [assignment.t1, assignment.t2, ...assignment.absentTeacherIds].filter(
        (id): id is string => Boolean(id)
      )
    ),
  ].map((id) => ({ id, name: nameOf(id) }));

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

      {/* Taking a specific person out of this rotation, as distinct from emptying
          the slot. Offered for whoever actually resolved into T1/T2 — including a
          teacher who is only there by owner/cosponsor fallback, which is exactly
          the case an admin could not previously undo. Also lists anyone already
          marked absent, so the mark can be lifted after it stops applying. */}
      {absenceTargets.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {absenceTargets.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {t.name}
              </span>
              <CoverageAbsenceButton
                sessionId={club.sessionId}
                rotation={rotation}
                teacherId={t.id}
                teacherName={t.name}
                isAbsent={assignment.absentTeacherIds.includes(t.id)}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TeacherDropdown({
  label,
  value,
  options,
  currentTeacher,
  required,
  defaultLabel,
  clearedLabel,
  onChange,
}: {
  label: string;
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
