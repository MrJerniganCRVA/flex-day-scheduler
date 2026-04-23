"use client";

import { useState, useEffect, useCallback } from "react";

interface PreviewData {
  totalStudents: number;
  fullyUnassigned: number;
  partiallyAssigned: number;
  studentsNeedingSlots: number;
  excludedClubs: string[];
  sessionsEligible: number;
}

interface ResultData {
  created: number;
  studentsAffected: number;
}

export default function AutoAssignTab({ flexDayId }: { flexDayId: string }) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ResultData | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/admin/flex-days/${flexDayId}/auto-assign`);
      if (!res.ok) throw new Error("Failed to load preview");
      const data = await res.json();
      setPreview(data);
    } catch {
      setPreviewError("Could not load assignment preview. Please refresh.");
    } finally {
      setPreviewLoading(false);
    }
  }, [flexDayId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  async function handleRunAssignment() {
    setRunning(true);
    setRunError(null);
    setConfirming(false);
    try {
      const res = await fetch(`/api/admin/flex-days/${flexDayId}/auto-assign`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Assignment failed");
      }
      const data: ResultData = await res.json();
      setResult(data);
      // Reload preview to show updated numbers
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

  return (
    <div className="space-y-6 max-w-xl">
      {/* Result banner */}
      {result && (
        <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-4 py-3">
          <div className="font-medium text-sm text-green-800 dark:text-green-200">
            Auto-assignment complete
          </div>
          <div className="text-sm text-green-700 dark:text-green-300 mt-0.5">
            {result.created} signup{result.created !== 1 ? "s" : ""} created for{" "}
            {result.studentsAffected} student{result.studentsAffected !== 1 ? "s" : ""}.
          </div>
        </div>
      )}

      {/* Stats card */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
          Current assignment status
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {preview.totalStudents}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Total students
            </div>
          </div>
          <div className={`rounded-lg p-3 ${preview.fullyUnassigned > 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-gray-50 dark:bg-gray-800"}`}>
            <div className={`text-2xl font-bold ${preview.fullyUnassigned > 0 ? "text-red-700 dark:text-red-300" : "text-gray-900 dark:text-white"}`}>
              {preview.fullyUnassigned}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              No signups at all
            </div>
          </div>
          <div className={`rounded-lg p-3 ${preview.partiallyAssigned > 0 ? "bg-amber-50 dark:bg-amber-950/30" : "bg-gray-50 dark:bg-gray-800"}`}>
            <div className={`text-2xl font-bold ${preview.partiallyAssigned > 0 ? "text-amber-700 dark:text-amber-300" : "text-gray-900 dark:text-white"}`}>
              {preview.partiallyAssigned}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Partially signed up
            </div>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {preview.sessionsEligible}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Sessions in pool
            </div>
          </div>
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

      {/* How it works */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-2">
          How auto-assign works
        </h3>
        <ul className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
          <li>• Only fills rotations a student has not already signed up for</li>
          <li>• Clubs with more open seats are weighted higher (more likely to be picked)</li>
          <li>• Each student is guaranteed at least 2 different clubs across the day</li>
          <li>• Excluded clubs (e.g. opt-in or religious clubs) are never randomly assigned</li>
          <li>• If no eligible session exists for a slot, it is left unassigned</li>
        </ul>
      </div>

      {/* Action */}
      {nothingToDo ? (
        <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm text-green-700 dark:text-green-300">
          All students are fully signed up — nothing to assign.
        </div>
      ) : (
        <div className="space-y-3">
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={running}
              className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
            >
              Auto-assign {preview.studentsNeedingSlots} student{preview.studentsNeedingSlots !== 1 ? "s" : ""}
            </button>
          ) : (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
              <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                Assign clubs to {preview.studentsNeedingSlots} student{preview.studentsNeedingSlots !== 1 ? "s" : ""}?
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This will fill all unassigned rotation slots using weighted random
                selection. It cannot be undone automatically — you can remove
                individual signups from the session roster if needed.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRunAssignment}
                  disabled={running}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition-colors"
                >
                  {running ? "Assigning…" : "Confirm auto-assign"}
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

          {runError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {runError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
