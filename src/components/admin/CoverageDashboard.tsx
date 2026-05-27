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

export type CoverageClub = {
  sessionId: string;
  clubId: string | null;
  name: string;
  ownerId: string;
  ownerName: string;
  rotations: RotationSlot[];
  studentCount: number;
  teacherAbsent?: boolean;
  teacherReassigned?: boolean;
  defaultCoTeacherId?: string | null;
  coverage: Partial<
    Record<
      RotationSlot,
      { primaryTeacherId: string | null; secondaryTeacherId: string | null }
    >
  >;
};

export type CoverageTeacher = {
  id: string;
  name: string;
};

// assignments[sessionId][rotation] = { t1, t2 }
type Assignment = { t1: string | null; t2: string | null };
type Assignments = Record<string, Partial<Record<RotationSlot, Assignment>>>;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type SaveStatuses = Record<string, Partial<Record<RotationSlot, SaveStatus>>>;

function urgencyOf(
  club: CoverageClub,
  assignment: Assignment | undefined
): "needs" | "consider" | "covered" {
  if (!assignment?.t1) return "needs";
  if (club.studentCount >= HIGH_ENROLLMENT_THRESHOLD && !assignment.t2)
    return "consider";
  return "covered";
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CoverageDashboard({
  clubs,
  teachers,
  flexDayLabel,
  absentTeacherIds = [],
}: {
  clubs: CoverageClub[];
  teachers: CoverageTeacher[];
  flexDayLabel: string;
  absentTeacherIds?: string[];
}) {
  const [assignments, setAssignments] = useState<Assignments>(() =>
    Object.fromEntries(
      clubs.map((c) => [
        c.sessionId,
        Object.fromEntries(
          c.rotations.map((r) => [
            r,
            {
              t1: c.coverage[r] !== undefined
                ? c.coverage[r].primaryTeacherId
                : (c.teacherAbsent || c.teacherReassigned ? null : c.ownerId),
              t2: c.coverage[r] !== undefined
                ? c.coverage[r].secondaryTeacherId
                : (c.defaultCoTeacherId ?? null),
            },
          ])
        ),
      ])
    )
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatuses>(() =>
    Object.fromEntries(
      clubs.map((c) => [
        c.sessionId,
        Object.fromEntries(c.rotations.map((r) => [r, "idle" as SaveStatus])),
      ])
    )
  );

  const assign = useCallback(
    async (
      sessionId: string,
      rotation: RotationSlot,
      slot: "t1" | "t2",
      value: string | null
    ) => {
      const prevValue = assignments[sessionId]?.[rotation]?.[slot] ?? null;

      setAssignments((prev) => ({
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          [rotation]: {
            ...(prev[sessionId]?.[rotation] ?? { t1: null, t2: null }),
            [slot]: value,
          },
        },
      }));
      setSaveStatus((prev) => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], [rotation]: "saving" },
      }));

      const revert = () =>
        setAssignments((prev) => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            [rotation]: {
              ...(prev[sessionId]?.[rotation] ?? { t1: null, t2: null }),
              [slot]: prevValue,
            },
          },
        }));

      try {
        const body =
          slot === "t1"
            ? { rotation, primary: value }
            : { rotation, secondary: value };
        const res = await fetch(`/api/club-sessions/${sessionId}/coverage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setSaveStatus((prev) => ({
            ...prev,
            [sessionId]: { ...prev[sessionId], [rotation]: "saved" },
          }));
          setTimeout(() => {
            setSaveStatus((prev) => ({
              ...prev,
              [sessionId]: { ...prev[sessionId], [rotation]: "idle" },
            }));
          }, 2000);
        } else {
          revert();
          setSaveStatus((prev) => ({
            ...prev,
            [sessionId]: { ...prev[sessionId], [rotation]: "error" },
          }));
        }
      } catch {
        revert();
        setSaveStatus((prev) => ({
          ...prev,
          [sessionId]: { ...prev[sessionId], [rotation]: "error" },
        }));
      }
    },
    [assignments]
  );

  // Teachers available for a given slot, filtered by rotation conflicts and absences
  function getAvailableTeachers(
    sessionId: string,
    rotation: RotationSlot,
    slot: "t1" | "t2"
  ): CoverageTeacher[] {
    const taken = new Set<string>(absentTeacherIds);
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
                                }
                              }
                              saveStatus={
                                saveStatus[club.sessionId]?.[rotation] ?? "idle"
                              }
                              teachers={teachers}
                              availableTeachers={(slot) =>
                                getAvailableTeachers(
                                  club.sessionId,
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
                                }
                              }
                              saveStatus={
                                saveStatus[club.sessionId]?.[rotation] ?? "idle"
                              }
                              teachers={teachers}
                              availableTeachers={(slot) =>
                                getAvailableTeachers(
                                  club.sessionId,
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
                                }
                              }
                              saveStatus={
                                saveStatus[club.sessionId]?.[rotation] ?? "idle"
                              }
                              teachers={teachers}
                              availableTeachers={(slot) =>
                                getAvailableTeachers(
                                  club.sessionId,
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
                (t) => !absentTeacherIds.includes(t.id) && t.freeCount === freeCount
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

            {/* Absent teachers — separate section at the bottom */}
            {teacherRows.some((t) => absentTeacherIds.includes(t.id)) && (
              <div>
                <div className="px-3 py-1.5 text-xs font-semibold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-y border-gray-200 dark:border-gray-700 uppercase tracking-wide">
                  Absent
                </div>
                {teacherRows
                  .filter((t) => absentTeacherIds.includes(t.id))
                  .map((teacher) => (
                    <div
                      key={teacher.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                    >
                      <span
                        className="text-sm text-gray-400 dark:text-gray-500 truncate line-through"
                        title={teacher.name}
                      >
                        {teacher.name}
                      </span>
                    </div>
                  ))}
              </div>
            )}
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
          value={assignment.t2}
          options={availableTeachers("t2")}
          currentTeacher={
            assignment.t2
              ? (teachers.find((t) => t.id === assignment.t2) ?? null)
              : null
          }
          required={false}
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
  onChange,
}: {
  label: string;
  value: string | null;
  options: CoverageTeacher[];
  currentTeacher: CoverageTeacher | null;
  required: boolean;
  onChange: (value: string | null) => void;
}) {
  const isAssigned = value !== null;
  const selectClass = isAssigned
    ? "bg-green-50 dark:bg-green-950/40 border-green-300 dark:border-green-700 text-gray-900 dark:text-gray-100"
    : required
      ? "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700 text-gray-600 dark:text-gray-200"
      : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-200";

  // Always include the currently selected teacher even if they'd be filtered out
  const inOptions = value && options.some((t) => t.id === value);
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
        <option value="">None</option>
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
