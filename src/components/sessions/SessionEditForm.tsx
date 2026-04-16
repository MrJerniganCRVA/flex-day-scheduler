"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";

interface SiblingSession {
  id: string;
  rotations: RotationSlot[];
}

interface ConflictDetail {
  studentName: string;
  rotation: RotationSlot;
  conflictingClub: string;
}

interface Props {
  clubId: string;
  sessionId: string;
  initialRotations: RotationSlot[];
  returnPath?: string;
  siblingSessionOptions?: SiblingSession[];
}

export default function SessionEditForm({
  clubId,
  sessionId,
  initialRotations,
  returnPath,
  siblingSessionOptions = [],
}: Props) {
  const router = useRouter();
  const destination = returnPath ?? `/teacher/clubs/${clubId}`;

  const [rotations, setRotations] = useState<RotationSlot[]>(initialRotations);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  const [selectedMergeIds, setSelectedMergeIds] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkConflicts, setLinkConflicts] = useState<ConflictDetail[]>([]);

  function toggleRotation(rotation: RotationSlot) {
    setRotations((prev) =>
      prev.includes(rotation)
        ? prev.filter((r) => r !== rotation)
        : [...prev, rotation]
    );
  }

  function toggleMerge(id: string) {
    setSelectedMergeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(`/api/clubs/${clubId}/sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotations }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to update session");
      return;
    }

    router.push(destination);
    router.refresh();
  }

  async function handleSplit() {
    setSplitting(true);
    setSplitError(null);

    const res = await fetch(
      `/api/clubs/${clubId}/sessions/${sessionId}/split`,
      { method: "POST" }
    );
    setSplitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSplitError(data.error ?? "Failed to split session");
      return;
    }

    router.push(destination);
    router.refresh();
  }

  async function handleLink() {
    setLinking(true);
    setLinkError(null);
    setLinkConflicts([]);

    const res = await fetch(
      `/api/clubs/${clubId}/sessions/${sessionId}/link`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mergeSessionIds: selectedMergeIds }),
      }
    );
    setLinking(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.conflicts) setLinkConflicts(data.conflicts);
      setLinkError(data.error ?? "Failed to link sessions");
      return;
    }

    router.push(destination);
    router.refresh();
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* ── Rotation checkboxes ──────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
            Rotations <span className="text-red-500">*</span>
          </label>
          <div className="space-y-2">
            {ALL_ROTATIONS.map((rotation) => (
              <label
                key={rotation}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={rotations.includes(rotation)}
                  onChange={() => toggleRotation(rotation)}
                  className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  {ROTATION_LABELS[rotation]}
                </span>
              </label>
            ))}
          </div>
          {rotations.length === 0 && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-2">
              Please select at least one rotation
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || rotations.length === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>

      {/* ── Split section (multi-rotation sessions only) ─────────── */}
      {initialRotations.length > 1 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
            Split into separate blocks
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
            Creates one independent session per rotation block. Students already
            signed up will be enrolled in all resulting sessions. This cannot be
            undone.
          </p>
          <button
            type="button"
            disabled={splitting}
            onClick={handleSplit}
            className="rounded-lg border border-amber-400 dark:border-amber-600 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 transition-colors"
          >
            {splitting
              ? "Splitting…"
              : `Split ${initialRotations.map((r) => ROTATION_LABELS[r]).join(" + ")} into separate sessions`}
          </button>
          {splitError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {splitError}
            </p>
          )}
        </div>
      )}

      {/* ── Link section (single-rotation with siblings only) ────── */}
      {initialRotations.length === 1 && siblingSessionOptions.length > 0 && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-4">
          <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300 mb-1">
            Link with other blocks
          </p>
          <p className="text-xs text-indigo-700 dark:text-indigo-400 mb-3">
            Combines sessions so students must commit to all linked blocks
            together. Students from all selected sessions will be enrolled in
            the merged session.
          </p>
          <div className="space-y-2 mb-3">
            {siblingSessionOptions.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedMergeIds.includes(s.id)}
                  onChange={() => toggleMerge(s.id)}
                  className="rounded border-indigo-300 dark:border-indigo-600 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-indigo-800 dark:text-indigo-300">
                  {s.rotations.map((r) => ROTATION_LABELS[r]).join(", ")}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={linking || selectedMergeIds.length === 0}
            onClick={handleLink}
            className="rounded-lg border border-indigo-400 dark:border-indigo-600 px-3 py-1.5 text-xs font-medium text-indigo-800 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50 transition-colors"
          >
            {linking ? "Linking…" : "Link selected sessions"}
          </button>
          {linkError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {linkError}
            </p>
          )}
          {linkConflicts.length > 0 && (
            <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2">
              <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">
                Resolve these conflicts before linking:
              </p>
              <ul className="space-y-0.5">
                {linkConflicts.map((c, i) => (
                  <li key={i} className="text-xs text-red-600 dark:text-red-400">
                    {c.studentName} —{" "}
                    {ROTATION_LABELS[c.rotation] ?? c.rotation} conflicts with{" "}
                    <span className="font-medium">{c.conflictingClub}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
