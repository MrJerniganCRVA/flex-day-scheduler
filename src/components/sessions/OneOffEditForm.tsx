"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";

interface Room {
  id: string;
  name: string;
  capacity: number;
}

interface Props {
  sessionId: string;
  flexDayId: string;
  initialRotations: RotationSlot[];
  currentRoom: Room | null;
  initialCapacity: number | null;
  returnPath?: string;
}

const selectClass =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const inputClass = selectClass;

/**
 * Rotations, room and capacity for a session with no club.
 *
 * The title is deliberately not editable here: `updateClubSessionPerDaySchema`
 * does not accept one, and a mislabeled one-off can now simply be removed from
 * the Flex Day page instead.
 */
export default function OneOffEditForm({
  sessionId,
  flexDayId,
  initialRotations,
  currentRoom,
  initialCapacity,
  returnPath,
}: Props) {
  const router = useRouter();
  const destination = returnPath ?? "/teacher";

  const [rotations, setRotations] = useState<RotationSlot[]>(initialRotations);
  const [roomOverrideId, setRoomOverrideId] = useState(currentRoom?.id ?? "");
  const [capacity, setCapacity] = useState<number | "">(initialCapacity ?? "");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-queried whenever the rotation selection changes: a room free during Flex 1
  // may be taken during Flex 2, and `excludeSessionId` keeps this session's own
  // current room in the list rather than hiding it as "occupied" by itself.
  useEffect(() => {
    setLoadingRooms(true);
    const query = new URLSearchParams({ flexDayId, excludeSessionId: sessionId });
    for (const r of rotations) query.append("rotations", r);

    let cancelled = false;
    fetch(`/api/rooms?${query.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Room[]) => {
        if (!cancelled) setRooms(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingRooms(false);
      });

    return () => {
      cancelled = true;
    };
  }, [flexDayId, sessionId, rotations]);

  function toggleRotation(rotation: RotationSlot) {
    setRotations((prev) =>
      prev.includes(rotation)
        ? prev.filter((r) => r !== rotation)
        : [...prev, rotation]
    );
  }

  // The session's own room is always offered, flagged when it is no longer
  // free, so the select's value never diverges from what is displayed.
  const currentRoomUnavailable =
    currentRoom != null &&
    !loadingRooms &&
    !rooms.some((r) => r.id === currentRoom.id);
  const roomOptions =
    currentRoom != null && currentRoomUnavailable
      ? [...rooms, currentRoom]
      : rooms;

  const selectedRoom = roomOptions.find((r) => r.id === roomOverrideId);
  const overCapacity =
    selectedRoom != null && capacity !== "" && capacity > selectedRoom.capacity;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (rotations.length === 0) {
      setError("Please select at least one rotation.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/club-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rotations,
          roomOverrideId: roomOverrideId || null,
          capacityOverride: capacity === "" ? null : Number(capacity),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update session.");
        return;
      }

      router.push(destination);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 max-w-2xl bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6"
    >
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
        {rotations.length === 0 && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-2">
            Please select at least one rotation
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Room
        </label>
        {loadingRooms ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-2">
            Loading rooms…
          </div>
        ) : (
          <select
            value={roomOverrideId}
            onChange={(e) => setRoomOverrideId(e.target.value)}
            className={selectClass}
          >
            <option value="">No room</option>
            {roomOptions.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name} (capacity: {room.capacity})
                {currentRoomUnavailable && room.id === currentRoom?.id
                  ? " — no longer available"
                  : ""}
              </option>
            ))}
          </select>
        )}
        {!loadingRooms && rooms.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            No rooms are free during the selected rotations.
          </p>
        )}
        {currentRoomUnavailable && roomOverrideId === currentRoom?.id && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            {currentRoom.name} is no longer free for the selected rotations.
            Saving will be refused until you pick another room.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Capacity
        </label>
        <input
          type="number"
          value={capacity}
          onChange={(e) =>
            setCapacity(e.target.value === "" ? "" : Number(e.target.value))
          }
          min={1}
          max={1000}
          className={`${inputClass} w-32`}
        />
        {overCapacity && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            Exceeds the room&apos;s capacity of {selectedRoom?.capacity}.
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
          onClick={() => router.push(destination)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || rotations.length === 0 || overCapacity}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
