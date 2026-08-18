"use client";

import { useState, useMemo, useCallback } from "react";
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
 * Select value meaning "no second teacher at all", as distinct from "" which means
 * "use the club's cosponsor". A `<select>` can only hold strings, and the two empty
 * states have to be distinguishable — a cuid can never collide with this.
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
  /** True when an admin explicitly said this rotation needs no second teacher. */
  t2Cleared: boolean;
};

export type CoverageTeacher = {
  id: string;
  name: string;
};

// assignments[sessionId][rotation] — seeded from the server's resolution and then
// updated optimistically as the admin edits.
//
// t2 and t2Cleared together carry three states, because an empty T2 is ambiguous
// on a club with a cosponsor:
//   t2 set                     → that teacher
//   t2 null, t2Cleared false   → fall back to the club's cosponsor
//   t2 null, t2Cleared true    → deliberately nobody
type Assignment = ResolvedAssignment;
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
  flexDayLabel,
}: {
  clubs: CoverageClub[];
  teachers: CoverageTeacher[];
  flexDayLabel: string;
}) {
  // Seeded straight from the server's resolution — no fallback logic here. The
  // previous version rebuilt T1/T2 from owner/cosponsor in this file, which meant
  // every rule added to src/lib/coverage.ts (absences, most recently) had to be
  // remembered a second time, and wasn't.
  const [assignments, setAssignments] = useState<Assignments>(() =>
    Object.fromEntries(clubs.map((c) => [c.sessionId, { ...c.assignments }]))
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatuses>(() =>
    Object.fromEntries(
      clubs.map((c) => [
        c.sessionId,
        Object.fromEntries(c.rotations.map((r) => [r, "idle" as SaveStatus])),
      ])
    )
  );

  /**
   * `value` for T2 is a teacher id, `null` to fall back to the club's cosponsor,
   * or the CLEARED sentinel for "no second teacher at all". T1 has no equivalent
   * third state — an empty T1 means the rotation needs cover, which is a real
   * problem worth flagging rather than a decision to record.
   */
  const assign = useCallback(
    async (
      sessionId: string,
      rotation: RotationSlot,
      slot: "t1" | "t2",
      value: string | null
    ) => {
      const cleared = slot === "t2" && value === CLEARED;
      const teacherId = value === CLEARED ? null : value;

      setAssignments((prev) => ({
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          [rotation]: {
            ...(prev[sessionId]?.[rotation] ?? {
              t1: null,
              t2: null,
              t2Cleared: false,
            }),
            [slot]: teacherId,
            ...(slot === "t2" ? { t2Cleared: cleared } : {}),
          },
        },
      }));
      setSaveStatus((prev) => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], [rotation]: "saving" },
      }));
      try {
        const body =
          slot === "t1"
            ? { rotation, primary: teacherId }
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
      }
    },
    []
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
                                assignments[club.sessionId]?.[rotation] ?? {
                                  t1: null,
                                  t2: null,
                                  t2Cleared: false,
                                }
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
                                assignments[club.sessionId]?.[rotation] ?? {
                                  t1: null,
                                  t2: null,
                                  t2Cleared: false,
                                }
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
                                assignments[club.sessionId]?.[rotation] ?? {
                                  t1: null,
                                  t2: null,
                                  t2Cleared: false,
                                }
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

        {/* ── Teacher sidebar ───────────────────────────────────────── */}
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
  saveStatus,
  teachers,
  availableTeachers,
  urgency,
  onAssign,
}: {
  club: CoverageClub;
  rotation: RotationSlot;
  assignment: Assignment;
  saveStatus: SaveStatus;
  teachers: CoverageTeacher[];
  availableTeachers: (slot: "t1" | "t2") => CoverageTeacher[];
  urgency: "needs" | "consider" | "covered";
  onAssign: (slot: "t1" | "t2", value: string | null) => void;
}) {
  // rotation is used by the parent to route onAssign correctly; kept in signature for clarity
  void rotation;

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
          value={assignment.t1}
          options={availableTeachers("t1")}
          currentTeacher={
            assignment.t1
              ? (teachers.find((t) => t.id === assignment.t1) ?? null)
              : null
          }
          required
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
