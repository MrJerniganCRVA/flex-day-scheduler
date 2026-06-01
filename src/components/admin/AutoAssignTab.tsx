"use client";

import { useState, useEffect, useCallback } from "react";
import { ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";

interface ProposedAssignment {
  studentId: string;
  studentName: string | null;
  clubSessionId: string;
  sessionName: string;
  rotations: RotationSlot[];
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
}

export default function AutoAssignTab({ flexDayId }: { flexDayId: string }) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
      setPreview(await res.json());
    } catch {
      setPreviewError("Could not load assignment preview. Please refresh.");
    } finally {
      setPreviewLoading(false);
    }
  }, [flexDayId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  async function handleConfirm() {
    if (!preview) return;
    setRunning(true);
    setRunError(null);
    setConfirming(false);
    try {
      const assignments = preview.proposedAssignments.map((a) => ({
        studentId: a.studentId,
        clubSessionId: a.clubSessionId,
      }));
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

  // Group proposed assignments by student for display
  const studentBreakdown = preview
    ? Array.from(
        preview.proposedAssignments
          .reduce(
            (map, a) => {
              if (!map.has(a.studentId)) {
                map.set(a.studentId, {
                  studentId: a.studentId,
                  studentName: a.studentName ?? "Unknown",
                  sessions: [] as { sessionName: string; rotations: RotationSlot[] }[],
                });
              }
              map.get(a.studentId)!.sessions.push({
                sessionName: a.sessionName,
                rotations: a.rotations,
              });
              return map;
            },
            new Map<
              string,
              {
                studentId: string;
                studentName: string;
                sessions: { sessionName: string; rotations: RotationSlot[] }[];
              }
            >()
          )
          .values()
      )
    : [];

  const filteredBreakdown = searchQuery.trim()
    ? studentBreakdown.filter((s) =>
        s.studentName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : studentBreakdown;

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
  const noEligibleSessions = !nothingToDo && studentBreakdown.length === 0;

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

          {/* Proposed placements — admin reviews before confirming */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Proposed placements
                </span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {studentBreakdown.length} student{studentBreakdown.length !== 1 ? "s" : ""}
                  {" · "}
                  {preview.proposedAssignments.length} signup{preview.proposedAssignments.length !== 1 ? "s" : ""}
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

            <div className="divide-y divide-gray-100 dark:divide-gray-700/50 max-h-96 overflow-y-auto">
              {filteredBreakdown.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  No students match your search.
                </div>
              ) : (
                filteredBreakdown.map((entry) => (
                  <div key={entry.studentId} className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                      {entry.studentName}
                    </div>
                    <ul className="space-y-0.5">
                      {entry.sessions.map((s, j) => (
                        <li key={j} className="text-xs text-gray-500 dark:text-gray-400">
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {s.sessionName}
                          </span>
                          {" — "}
                          {s.rotations.map((r) => ROTATION_LABELS[r]).join(", ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
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
                disabled={running || studentBreakdown.length === 0}
                className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
              >
                Confirm auto-assign for {studentBreakdown.length} student{studentBreakdown.length !== 1 ? "s" : ""}
              </button>
            ) : (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
                <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                  Create {preview.proposedAssignments.length} signup{preview.proposedAssignments.length !== 1 ? "s" : ""} exactly as shown above?
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Signups created here can only be removed individually. Use &ldquo;Regenerate&rdquo; first if you want different placements.
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
