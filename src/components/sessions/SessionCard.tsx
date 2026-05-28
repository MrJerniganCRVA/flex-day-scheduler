"use client";

import { useState, useEffect } from "react";
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

interface Room {
  id: string;
  name: string;
  capacity: number;
}

interface RotationAbsence {
  rotation: RotationSlot;
  type: "ABSENT" | "REASSIGNED";
}

interface Props {
  clubId: string;
  sessionId: string;
  flexDayDate: string;
  flexDayLabel: string | null;
  rotations: RotationSlot[];
  enrollmentCount: number;
  maxCapacity: number;
  capacityOverride?: number | null;
  sessionRotationAbsences?: RotationAbsence[];
  roomOverrideId?: string | null;
  defaultRoomName?: string | null;
  signups: Signup[];
  siblingSessionOptions: SiblingSession[];
}

const selectClass =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function SessionCard({
  clubId,
  sessionId,
  flexDayDate,
  flexDayLabel,
  rotations: initialRotations,
  enrollmentCount,
  maxCapacity,
  capacityOverride: initialCapacityOverride,
  sessionRotationAbsences: initialAbsences = [],
  roomOverrideId: initialRoomOverrideId,
  defaultRoomName,
  signups,
  siblingSessionOptions,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rotations, setRotations] = useState<RotationSlot[]>(initialRotations);
  const [roomOverrideId, setRoomOverrideId] = useState(initialRoomOverrideId ?? "");
  const [capacityOverride, setCapacityOverride] = useState<number | "">(
    initialCapacityOverride ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  type TeacherStatus = "PRESENT" | "ABSENT" | "REASSIGNED";
  const [absences, setAbsences] = useState<RotationAbsence[]>(initialAbsences);
  const [markingAbsent, setMarkingAbsent] = useState(false);

  function getStatus(rotation: RotationSlot): TeacherStatus {
    return (absences.find((a) => a.rotation === rotation)?.type as TeacherStatus) ?? "PRESENT";
  }

  // Overall card status: ABSENT takes priority over REASSIGNED
  const cardStatus: TeacherStatus = absences.some((a) => a.type === "ABSENT")
    ? "ABSENT"
    : absences.some((a) => a.type === "REASSIGNED")
      ? "REASSIGNED"
      : "PRESENT";

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const [selectedMergeIds, setSelectedMergeIds] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkConflicts, setLinkConflicts] = useState<ConflictDetail[]>([]);
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || rooms.length > 0) return;
    setLoadingRooms(true);
    fetch("/api/rooms")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Room[]) => setRooms(data))
      .catch(() => {})
      .finally(() => setLoadingRooms(false));
  }, [editing]);

  function cancelEdit() {
    setRotations(initialRotations);
    setRoomOverrideId(initialRoomOverrideId ?? "");
    setCapacityOverride(initialCapacityOverride ?? "");
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
      body: JSON.stringify({
        rotations,
        roomOverrideId: roomOverrideId || null,
        capacityOverride: capacityOverride === "" ? null : Number(capacityOverride),
      }),
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

  async function handleStatusChange(rotation: RotationSlot, newStatus: TeacherStatus) {
    const newAbsences: RotationAbsence[] = [
      ...absences.filter((a) => a.rotation !== rotation),
      ...(newStatus !== "PRESENT"
        ? [{ rotation, type: newStatus as "ABSENT" | "REASSIGNED" }]
        : []),
    ];
    setMarkingAbsent(true);
    const res = await fetch(`/api/club-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ absences: newAbsences }),
    });
    setMarkingAbsent(false);
    if (res.ok) {
      setAbsences(newAbsences);
      router.refresh();
    }
  }

  async function handleSplit() {
    setSplitting(true);
    setSplitError(null);
    const res = await fetch(`/api/clubs/${clubId}/sessions/${sessionId}/split`, {
      method: "POST",
    });
    setSplitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSplitError(data.error ?? "Failed to split sessions");
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

  const displayCapacity = initialCapacityOverride ?? maxCapacity;
  const showLinkSection = rotations.length === 1 && siblingSessionOptions.length > 0;

  return (
    <div
      className={`rounded-xl bg-white dark:bg-gray-900 border p-5 ${
        cardStatus === "ABSENT"
          ? "border-amber-300 dark:border-amber-700"
          : cardStatus === "REASSIGNED"
            ? "border-teal-300 dark:border-teal-700"
            : "border-gray-200 dark:border-gray-700"
      }`}
    >
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
              {enrollmentCount}/{displayCapacity} enrolled
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

          {/* Room override */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Room</p>
            {loadingRooms ? (
              <div className="text-sm text-gray-400 dark:text-gray-500">Loading rooms…</div>
            ) : (
              <select
                value={roomOverrideId}
                onChange={(e) => setRoomOverrideId(e.target.value)}
                className={selectClass}
              >
                <option value="">
                  Use club default{defaultRoomName ? ` (${defaultRoomName})` : ""}
                </option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} (capacity: {room.capacity})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Capacity override */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Capacity for this day
            </p>
            <input
              type="number"
              value={capacityOverride}
              onChange={(e) =>
                setCapacityOverride(e.target.value === "" ? "" : Number(e.target.value))
              }
              placeholder={String(maxCapacity)}
              min={1}
              max={1000}
              className="w-28 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Leave blank to use club default ({maxCapacity})
            </p>
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

          {/* Split section — multi-rotation sessions only */}
          {initialRotations.length > 1 && (
            <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 p-4">
              <p className="text-sm font-semibold text-orange-800 dark:text-orange-300 mb-1">
                Split linked sessions
              </p>
              <p className="text-xs text-orange-700 dark:text-orange-400 mb-3">
                Separates into {initialRotations.length} individual sessions. All enrolled students
                remain signed up in each split session.
              </p>
              <button
                type="button"
                onClick={handleSplit}
                disabled={splitting}
                className="rounded-lg border border-orange-400 dark:border-orange-600 px-3 py-1.5 text-xs font-medium text-orange-800 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/40 disabled:opacity-50 transition-colors"
              >
                {splitting ? "Splitting…" : "Split into individual sessions"}
              </button>
              {splitError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{splitError}</p>
              )}
            </div>
          )}

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
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 dark:text-white">{dateLabel}</span>
                {cardStatus === "ABSENT" && (
                  <span className="rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 px-2 py-0.5 text-xs font-medium">
                    Absent
                  </span>
                )}
                {cardStatus === "REASSIGNED" && (
                  <span className="rounded-full bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700 px-2 py-0.5 text-xs font-medium">
                    Covering elsewhere
                  </span>
                )}
              </div>
              {flexDayLabel && (
                <div className="text-xs text-gray-400 dark:text-gray-500">{flexDayLabel}</div>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {initialRotations.map((r) => (
                  <span
                    key={r}
                    className="inline-block rounded-full bg-indigo-100 dark:bg-indigo-950/50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                  >
                    {ROTATION_LABELS[r]}
                  </span>
                ))}
                {initialRotations.length > 1 && (
                  <span className="inline-block rounded-full bg-violet-100 dark:bg-violet-950/50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                    Linked
                  </span>
                )}
              </div>
              {cardStatus === "ABSENT" && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  You&apos;re marked absent — the session will still run. An admin will arrange coverage.
                </p>
              )}
              {cardStatus === "REASSIGNED" && (
                <p className="mt-1 text-xs text-teal-600 dark:text-teal-400">
                  You&apos;re covering another club — an admin will arrange coverage for your session.
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {enrollmentCount}/{displayCapacity} enrolled
              </span>
              <div className="flex flex-col gap-1">
                {initialRotations.map((r) => {
                  const status = getStatus(r);
                  return (
                    <div key={r} className="flex items-center gap-1.5">
                      {initialRotations.length > 1 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 w-10 shrink-0">
                          {ROTATION_LABELS[r]}
                        </span>
                      )}
                      <select
                        value={status}
                        onChange={(e) => handleStatusChange(r, e.target.value as TeacherStatus)}
                        disabled={markingAbsent}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50 transition-colors ${
                          status === "ABSENT"
                            ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                            : status === "REASSIGNED"
                              ? "bg-teal-50 dark:bg-teal-950/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300"
                              : "bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                        }`}
                      >
                        <option value="PRESENT">Present</option>
                        <option value="ABSENT">Absent from school</option>
                        <option value="REASSIGNED">Covering another club</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Edit
              </button>
              <DeleteSessionButton clubId={clubId} sessionId={sessionId} label="Remove from Day" />
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
