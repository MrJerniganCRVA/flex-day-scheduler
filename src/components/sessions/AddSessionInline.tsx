"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@/types";

interface FlexDay {
  id: string;
  date: string;
  label: string | null;
}

interface Room {
  id: string;
  name: string;
  capacity: number;
}

interface Props {
  clubId: string;
  flexDays: FlexDay[];
  defaultRoomId?: string | null;
}

export default function AddSessionInline({ clubId, flexDays, defaultRoomId }: Props) {
  const router = useRouter();
  const [openFlexDayId, setOpenFlexDayId] = useState<string | null>(null);
  const [rotations, setRotations] = useState<RotationSlot[]>([]);
  const [roomOverrideId, setRoomOverrideId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.ok ? r.json() : [])
      .then(setRooms)
      .catch(() => {});
  }, []);

  function openDay(flexDayId: string) {
    setOpenFlexDayId(flexDayId);
    setRotations([]);
    setRoomOverrideId("");
    setError(null);
  }

  function cancel() {
    setOpenFlexDayId(null);
    setRotations([]);
    setRoomOverrideId("");
    setError(null);
  }

  function toggleRotation(r: RotationSlot) {
    setRotations((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  async function handleSubmit(flexDayId: string) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/clubs/${clubId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flexDayId,
        rotations,
        roomOverrideId: roomOverrideId || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to schedule session.");
      return;
    }
    setOpenFlexDayId(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {flexDays.map((fd) => {
        const isOpen = openFlexDayId === fd.id;
        const dateLabel = new Date(fd.date).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        });

        if (!isOpen) {
          return (
            <div
              key={fd.id}
              className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 px-5 py-3 flex items-center justify-between"
            >
              <div>
                <span className="text-sm text-gray-700 dark:text-gray-200">{dateLabel}</span>
                {fd.label && (
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{fd.label}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => openDay(fd.id)}
                className="rounded-lg border border-indigo-300 dark:border-indigo-700 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
              >
                + Add
              </button>
            </div>
          );
        }

        return (
          <div
            key={fd.id}
            className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-5 space-y-4"
          >
            <div className="font-semibold text-sm text-gray-900 dark:text-white">
              {dateLabel}
              {fd.label && (
                <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                  {fd.label}
                </span>
              )}
            </div>

            {/* Rotations */}
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                Rotations <span className="text-red-500">*</span>
              </p>
              <div className="flex gap-2 flex-wrap">
                {ALL_ROTATIONS.map((r) => (
                  <label
                    key={r}
                    className={`flex items-center gap-2 cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      rotations.includes(r)
                        ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300"
                        : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={rotations.includes(r)}
                      onChange={() => toggleRotation(r)}
                    />
                    {ROTATION_LABELS[r]}
                  </label>
                ))}
              </div>
            </div>

            {/* Room override */}
            {rooms.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Room{" "}
                  <span className="font-normal text-gray-400 dark:text-gray-500">(optional)</span>
                </label>
                <select
                  value={roomOverrideId}
                  onChange={(e) => setRoomOverrideId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Use club default</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name} (capacity: {room.capacity})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancel}
                className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSubmit(fd.id)}
                disabled={saving || rotations.length === 0}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Scheduling…" : "Schedule"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
