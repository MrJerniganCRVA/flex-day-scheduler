"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@/types";
import DeleteSessionButton from "@/components/sessions/DeleteSessionButton";

interface ConflictDetail {
  studentName: string;
  rotation: RotationSlot;
  conflictingClub: string;
}

interface Signup {
  id: string;
  student: { id: string; name: string; email: string };
}

interface SiblingSession {
  id: string;
  rotations: RotationSlot[];
}

interface Props {
  clubId: string;
  sessionId: string;
  flexDayDate: string; // ISO string from server
  flexDayLabel: string | null;
  rotations: RotationSlot[];
  enrollmentCount: number;
  maxCapacity: number;
  signups: Signup[];
  siblingSessionOptions: SiblingSession[];
}

export default function SessionCard({
  clubId,
  sessionId,
  flexDayDate,
  flexDayLabel,
  rotations: initialRotations,
  enrollmentCount,
  maxCapacity,
  signups,
  siblingSessionOptions,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rotations, setRotations] = useState<RotationSlot[]>(initialRotations);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [selectedMergeIds, setSelectedMergeIds] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkConflicts, setLinkConflicts] = useState<ConflictDetail[]>([]);

  function cancelEdit() {
    setRotations(initialRotations);
    setSaveError(null);
    setLinkError(null);
    setLinkConflicts([]);
    setSelectedMergeIds([]);
    setEditing(false);
  }

  function toggleRotation(r: RotationSlot) {
    setRotations((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  function toggleMerge(id: string) {
    setSelectedMergeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/clubs/${clubId}/sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotations }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSaveError(data.error ?? "Failed to save");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function handleLink() {
    setLinking(true);
    setLinkError(null);
    setLinkConflicts([]);
    const res = await fetch(`/api/clubs/${clubId}/sessions/${sessionId}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mergeSessionIds: selectedMergeIds }),
    });
    setLinking(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.conflicts) setLinkConflicts(data.conflicts);
      setLinkError(data.error ?? "Failed to link sessions");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const dateLabel = new Date(flexDayDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const showLinkSection =
    rotations.length === 1 && siblingSessionOptions.length > 0;

  return (
    <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5">
      {editing ? (
        /* ── Edit mode ─────────────────────────────────────────── */
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">{dateLabel}</div>
              {flexDayLabel && (
                <div className="text-xs text-gray-400 dark:text-gray-500">{flexDayLabel}</div>
              )}
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {enrollmentCount}/{maxCapacity} enrolled
            </span>
          </div>

          {/* Rotation checkboxes */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Rotations <span className="text-red-500">*</span>
            </p>
            <div className="space-y-2">
              {ALL_ROTATIONS.map((r) => (
                <label key={r} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rotations.includes(r)}
                    onChange={() => toggleRotation(r)}
                    className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-200">
                    {ROTATION_LABELS[r]}
                  </span>
                </label>
              ))}
            </div>
            {rotations.length === 0 && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                Select at least one rotation
              </p>
            )}
          </div>

          {saveError && (
            <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || rotations.length === 0}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {/* Link section — single-rotation with siblings only */}
          {showLinkSection && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-4">
              <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300 mb-1">
                Link with other blocks
              </p>
              <p className="text-xs text-indigo-700 dark:text-indigo-400 mb-3">
                Combines sessions so students commit to all linked blocks together.
                Students from all selected sessions will be enrolled in the merged session.
              </p>
              <div className="space-y-2 mb-3">
                {siblingSessionOptions.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
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
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{linkError}</p>
              )}
              {linkConflicts.length > 0 && (
                <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2">
                  <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">
                    Resolve these conflicts before linking:
                  </p>
                  <ul className="space-y-0.5">
                    {linkConflicts.map((c, i) => (
                      <li key={i} className="text-xs text-red-600 dark:text-red-400">
                        {c.studentName} — {ROTATION_LABELS[c.rotation] ?? c.rotation} conflicts with{" "}
                        <span className="font-medium">{c.conflictingClub}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ── View mode ─────────────────────────────────────────── */
        <>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">{dateLabel}</div>
              {flexDayLabel && (
                <div className="text-xs text-gray-400 dark:text-gray-500">{flexDayLabel}</div>
              )}
              <div className="mt-1 flex gap-1">
                {initialRotations.map((r) => (
                  <span
                    key={r}
                    className="inline-block rounded-full bg-indigo-100 dark:bg-indigo-950/50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                  >
                    {ROTATION_LABELS[r]}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {enrollmentCount}/{maxCapacity} enrolled
              </span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Edit
              </button>
              <DeleteSessionButton clubId={clubId} sessionId={sessionId} />
            </div>
          </div>

          {signups.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                View roster ({signups.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {signups.map((signup) => (
                  <li
                    key={signup.id}
                    className="text-xs text-gray-600 dark:text-gray-300 flex gap-2"
                  >
                    <span>{signup.student.name}</span>
                    <span className="text-gray-400 dark:text-gray-500">{signup.student.email}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
