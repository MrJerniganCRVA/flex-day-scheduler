"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";

interface ProposedAssignment {
  studentId: string;
  studentName: string | null;
  clubSessionId: string;
  sessionName: string;
  rotations: RotationSlot[];
}

interface SessionOption {
  id: string;
  name: string;
}

interface PreviewData {
  totalStudents: number;
  fullyUnassigned: number;
  partiallyAssigned: number;
  studentsNeedingSlots: number;
  excludedClubs: string[];
  sessionsEligible: number;
  totalSessions: number;
  proposedAssignments: ProposedAssignment[];
  sessionsPerRotation: Record<RotationSlot, SessionOption[]>;
  existingRotations: Record<string, RotationSlot[]>;
}

type EditableAssignments = Record<string, Record<RotationSlot, string>>;

function initEditableAssignments(proposals: ProposedAssignment[]): EditableAssignments {
  const result: EditableAssignments = {};
  for (const a of proposals) {
    if (!result[a.studentId]) {
      result[a.studentId] = { FLEX_1: "", FLEX_2: "", FLEX_3: "" };
    }
    for (const r of a.rotations) {
      result[a.studentId][r] = a.clubSessionId;
    }
  }
  return result;
}

export default function AutoAssignTab({ flexDayId }: { flexDayId: string }) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editableAssignments, setEditableAssignments] = useState<EditableAssignments>({});

  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ signupsCreated: number; studentsAffected: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setResult(null);
    setConfirming(false);
    try {
      const res = await fetch(`/api/admin/flex-days/${flexDayId}/auto-assign`);
      if (!res.ok) throw new Error("Failed to load preview");
      const data: PreviewData = await res.json();
      setPreview(data);
      setEditableAssignments(initEditableAssignments(data.proposedAssignments));
    } catch {
      setPreviewError("Could not load assignment preview. Please refresh.");
    } finally {
      setPreviewLoading(false);
    }
  }, [flexDayId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // Unique students with proposed assignments, preserving algorithm order
  const studentList = useMemo(() => {
    if (!preview) return [];
    const seen = new Set<string>();
    const students: { id: string; name: string }[] = [];
    for (const a of preview.proposedAssignments) {
      if (!seen.has(a.studentId)) {
        seen.add(a.studentId);
        students.push({ id: a.studentId, name: a.studentName ?? "Unknown" });
      }
    }
    return students;
  }, [preview]);

  const filteredStudents = searchQuery.trim()
    ? studentList.filter((s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : studentList;

  // Count unique (studentId, clubSessionId) pairs for the confirm button
  const pendingSignupCount = useMemo(() => {
    const seen = new Set<string>();
    for (const [studentId, slots] of Object.entries(editableAssignments)) {
      for (const clubSessionId of Object.values(slots)) {
        if (clubSessionId) seen.add(`${studentId}:${clubSessionId}`);
      }
    }
    return seen.size;
  }, [editableAssignments]);

  function setSlot(studentId: string, rotation: RotationSlot, sessionId: string) {
    setEditableAssignments((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] ?? { FLEX_1: "", FLEX_2: "", FLEX_3: "" }),
        [rotation]: sessionId,
      },
    }));
  }

  async function handleConfirm() {
    setRunning(true);
    setRunError(null);
    setConfirming(false);
    try {
      const seen = new Set<string>();
      const assignments: { studentId: string; clubSessionId: string }[] = [];
      for (const [studentId, slots] of Object.entries(editableAssignments)) {
        for (const clubSessionId of Object.values(slots)) {
          if (!clubSessionId) continue;
          const key = `${studentId}:${clubSessionId}`;
          if (!seen.has(key)) {
            seen.add(key);
            assignments.push({ studentId, clubSessionId });
          }
        }
      }
      const res = await fetch(`/api/admin/flex-days/${flexDayId}/auto-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Assignment failed");
      }
      const data = await res.json();
      setResult(data);
      await loadPreview();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  if (previewLoading) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
        Loading assignment preview…
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        {previewError}
      </div>
    );
  }

  if (!preview) return null;

  const nothingToDo = preview.studentsNeedingSlots === 0;
  const noEligibleSessions = !nothingToDo && studentList.length === 0;

  return (
    <div className="space-y-6">
      {/* Stats card */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
          Current assignment status
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Total students" value={preview.totalStudents} />
          <StatTile
            label="No signups at all"
            value={preview.fullyUnassigned}
            highlight={preview.fullyUnassigned > 0 ? "red" : undefined}
          />
          <StatTile
            label="Partially signed up"
            value={preview.partiallyAssigned}
            highlight={preview.partiallyAssigned > 0 ? "amber" : undefined}
          />
          <StatTile label="Sessions in pool" value={preview.sessionsEligible} />
        </div>

        {preview.excludedClubs.length > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
            <div className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
              Excluded from random assignment ({preview.excludedClubs.length}):
            </div>
            <div className="text-xs text-amber-700 dark:text-amber-400">
              {preview.excludedClubs.join(", ")}
            </div>
          </div>
        )}
      </div>

      {/* Success banner */}
      {result && (
        <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-4 py-3">
          <div className="font-medium text-sm text-green-800 dark:text-green-200">
            Auto-assignment complete
          </div>
          <div className="text-sm text-green-700 dark:text-green-300 mt-0.5">
            {result.signupsCreated} signup{result.signupsCreated !== 1 ? "s" : ""} created
            for {result.studentsAffected} student{result.studentsAffected !== 1 ? "s" : ""}.
          </div>
        </div>
      )}

      {nothingToDo ? (
        <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm text-green-700 dark:text-green-300">
          All students are fully signed up — nothing to assign.
        </div>
      ) : noEligibleSessions ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {preview.studentsNeedingSlots} student{preview.studentsNeedingSlots !== 1 ? "s" : ""} have
          unfilled slots, but no eligible sessions have available capacity.
        </div>
      ) : (
        <>
          {/* How it works */}
          <details className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
            <summary className="font-semibold text-gray-900 dark:text-white text-sm cursor-pointer select-none">
              How auto-assign works
            </summary>
            <ul className="mt-3 space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
              <li>• Only fills rotations a student has not already signed up for</li>
              <li>• Clubs with more open seats are weighted higher</li>
              <li>• Each student is guaranteed at least 2 different clubs across the day</li>
              <li>• One-off sessions (e.g. competitions) are included in the pool</li>
              <li>• Excluded clubs are never randomly assigned</li>
              <li>• If no eligible session exists for a slot, it is left unassigned</li>
            </ul>
          </details>

          {/* Proposed placements — editable per-student per-rotation dropdowns */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Proposed placements
                </span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {studentList.length} student{studentList.length !== 1 ? "s" : ""}
                  {" · "}
                  adjust dropdowns before confirming
                </span>
              </div>
              <button
                onClick={loadPreview}
                disabled={previewLoading || running}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
              >
                Regenerate
              </button>
            </div>

            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by student name…"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Column headers (desktop) */}
            <div className="hidden sm:grid sm:grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700/50">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Student</div>
              {ALL_ROTATIONS.map((slot) => (
                <div key={slot} className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {ROTATION_LABELS[slot]}
                </div>
              ))}
            </div>

            <div className="divide-y divide-gray-100 dark:divide-gray-700/50 max-h-[32rem] overflow-y-auto">
              {filteredStudents.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  No students match your search.
                </div>
              ) : (
                filteredStudents.map((student, idx) => {
                  const slots = editableAssignments[student.id] ?? { FLEX_1: "", FLEX_2: "", FLEX_3: "" };
                  const filledSlots = preview.existingRotations[student.id] ?? [];
                  return (
                    <div
                      key={student.id}
                      className={`px-4 py-3.5 sm:grid sm:grid-cols-[2fr_1fr_1fr_1fr] sm:gap-3 sm:items-center space-y-2 sm:space-y-0 ${
                        idx % 2 === 1 ? "bg-gray-50/70 dark:bg-gray-800/30" : ""
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900 dark:text-white border-l-2 border-l-indigo-400 pl-2">
                        {student.name}
                      </div>
                      {ALL_ROTATIONS.map((slot) => {
                        const isAlreadyFilled = filledSlots.includes(slot);
                        return (
                          <div key={slot}>
                            <label className="sm:hidden text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">
                              {ROTATION_LABELS[slot]}
                            </label>
                            {isAlreadyFilled ? (
                              <div className="w-full rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-2 py-1.5 text-xs text-green-700 dark:text-green-400 flex items-center gap-1 cursor-not-allowed">
                                <span>✓</span>
                                <span>Already signed up</span>
                              </div>
                            ) : (
                              <select
                                value={slots[slot] ?? ""}
                                onChange={(e) => setSlot(student.id, slot, e.target.value)}
                                disabled={running}
                                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                              >
                                <option value="">— no assignment —</option>
                                {(preview.sessionsPerRotation[slot] ?? []).map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Confirm action */}
          <div className="space-y-3">
            {runError && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {runError}
              </div>
            )}

            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                disabled={running || pendingSignupCount === 0}
                className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
              >
                Confirm {pendingSignupCount} signup{pendingSignupCount !== 1 ? "s" : ""} for {studentList.length} student{studentList.length !== 1 ? "s" : ""}
              </button>
            ) : (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
                <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                  Create {pendingSignupCount} signup{pendingSignupCount !== 1 ? "s" : ""} as shown above?
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Signups created here can only be removed individually.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirm}
                    disabled={running}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition-colors"
                  >
                    {running ? "Assigning…" : "Yes, confirm"}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={running}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "red" | "amber";
}) {
  const bg =
    highlight === "red"
      ? "bg-red-50 dark:bg-red-950/30"
      : highlight === "amber"
        ? "bg-amber-50 dark:bg-amber-950/30"
        : "bg-gray-50 dark:bg-gray-800";
  const text =
    highlight === "red"
      ? "text-red-700 dark:text-red-300"
      : highlight === "amber"
        ? "text-amber-700 dark:text-amber-300"
        : "text-gray-900 dark:text-white";

  return (
    <div className={`rounded-lg p-3 ${bg}`}>
      <div className={`text-2xl font-bold ${text}`}>{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}
