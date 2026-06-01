"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";

interface Room {
  id: string;
  name: string;
  capacity: number;
}

interface Props {
  sessionId: string;
  initialTitle: string;
  initialRotations: RotationSlot[];
  initialRoomId: string | null;
  initialCapacity: number | null;
  returnPath?: string;
}

const selectClass =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const inputClass =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function OneOffEditForm({
  sessionId,
  initialTitle,
  initialRotations,
  initialRoomId,
  initialCapacity,
  returnPath,
}: Props) {
  const router = useRouter();

  const [title, setTitle] = useState(initialTitle);
  const [rotations, setRotations] = useState<RotationSlot[]>(initialRotations);
  const [roomOverrideId, setRoomOverrideId] = useState(initialRoomId ?? "");
  const [capacity, setCapacity] = useState<number | "">(initialCapacity ?? 25);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Room[]) => {
        setRooms(data);
        if (!initialRoomId && data.length > 0) setRoomOverrideId(data[0].id);
      })
      .catch(() => {})
      .finally(() => setLoadingRooms(false));
  }, [initialRoomId]);

  useEffect(() => {
    const room = rooms.find((r) => r.id === roomOverrideId);
    if (room && Number(capacity) > room.capacity) {
      setCapacity(room.capacity);
    }
  }, [roomOverrideId, rooms]);

  function toggleRotation(r: RotationSlot) {
    setRotations((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rotations.length === 0) {
      setError("Please select at least one rotation.");
      return;
    }
    if (!roomOverrideId) {
      setError("Please select a room.");
      return;
    }
    if (!capacity || capacity < 1) {
      setError("Please enter a valid capacity.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/club-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          rotations,
          roomOverrideId,
          capacityOverride: Number(capacity),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update activity.");
        return;
      }

      router.push(returnPath ?? "/teacher");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Activity Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Study Hall, Chess Tournament…"
          required
          maxLength={100}
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          Rotations <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-3 flex-wrap">
          {ALL_ROTATIONS.map((r) => (
            <label
              key={r}
              className={`flex items-center gap-2 cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                rotations.includes(r)
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300"
                  : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
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

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Room <span className="text-red-500">*</span>
        </label>
        {loadingRooms ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-2">Loading rooms…</div>
        ) : rooms.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-2">
            No rooms available.
          </div>
        ) : (
          <select
            value={roomOverrideId}
            onChange={(e) => setRoomOverrideId(e.target.value)}
            className={selectClass}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name} (capacity: {room.capacity})
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Capacity <span className="text-red-500">*</span>
        </label>
        <input
          type="number"
          value={capacity}
          onChange={(e) =>
            setCapacity(e.target.value === "" ? "" : Number(e.target.value))
          }
          min={1}
          max={1000}
          required
          className={`${inputClass} w-32`}
        />
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
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || rotations.length === 0 || !roomOverrideId || !title.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
