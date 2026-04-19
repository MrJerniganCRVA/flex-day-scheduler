"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";

interface Club {
  id: string;
  name: string;
  defaultRoom?: { id: string; name: string } | null;
}

interface FlexDay {
  id: string;
  date: Date | string;
  label: string | null;
}

interface Room {
  id: string;
  name: string;
  capacity: number;
}

interface Props {
  clubs: Club[];
  flexDays: FlexDay[];
  preselectedClubId?: string;
  takenFlexDaysByClub?: Record<string, string[]>;
}

export default function SessionForm({
  clubs,
  flexDays,
  preselectedClubId,
  takenFlexDaysByClub = {},
}: Props) {
  const router = useRouter();

  const initialClubId = preselectedClubId ?? clubs[0]?.id ?? "";
  const initialAvailable = flexDays.filter(
    (fd) => !takenFlexDaysByClub[initialClubId]?.includes(fd.id)
  );

  const [clubId, setClubId] = useState(initialClubId);
  const [flexDayId, setFlexDayId] = useState(initialAvailable[0]?.id ?? "");
  const [rotations, setRotations] = useState<RotationSlot[]>([]);
  const [signupMode, setSignupMode] = useState<"linked" | "separate">("linked");
  const [roomOverrideId, setRoomOverrideId] = useState<string>("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available rooms
  useEffect(() => {
    async function fetchRooms() {
      try {
        const res = await fetch("/api/admin/rooms");
        if (res.ok) {
          const data = await res.json();
          setRooms(data);
        }
      } catch {
        // Silent fail - form will show empty dropdown
      } finally {
        setLoadingRooms(false);
      }
    }
    fetchRooms();
  }, []);

  // When club changes, reset flex day to first available for that club
  useEffect(() => {
    const available = flexDays.filter(
      (fd) => !takenFlexDaysByClub[clubId]?.includes(fd.id)
    );
    setFlexDayId(available[0]?.id ?? "");
  }, [clubId]);

  const availableFlexDays = flexDays.filter(
    (fd) => !takenFlexDaysByClub[clubId]?.includes(fd.id)
  );

  const selectedClub = clubs.find((c) => c.id === clubId);

  function toggleRotation(r: RotationSlot) {
    setRotations((prev) => {
      const next = prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r];
      // Reset to linked when dropping back to 1 rotation
      if (next.length < 2) setSignupMode("linked");
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rotations.length === 0) {
      setError("Please select at least one rotation.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      if (signupMode === "separate" && rotations.length > 1) {
        // Create one independent session per rotation
        for (const r of rotations) {
          const res = await fetch(`/api/clubs/${clubId}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              flexDayId,
              rotations: [r],
              roomOverrideId: roomOverrideId || undefined,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error ?? "Failed to schedule session.");
            setLoading(false);
            return;
          }
        }
      } else {
        // Create one linked session covering all selected rotations
        const res = await fetch(`/api/clubs/${clubId}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flexDayId,
            rotations,
            roomOverrideId: roomOverrideId || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Failed to schedule session.");
          setLoading(false);
          return;
        }
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    router.push(`/teacher/clubs/${clubId}`);
    router.refresh();
  }

  const selectClass =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  if (clubs.length === 0) {
    return (
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-6 text-gray-500 dark:text-gray-400">
        You don&apos;t have any clubs yet. Create a club first.
      </div>
    );
  }

  if (flexDays.length === 0) {
    return (
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-6 text-gray-500 dark:text-gray-400">
        No Flex Days have been scheduled. Ask an administrator to create one.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Club <span className="text-red-500">*</span>
        </label>
        <select
          value={clubId}
          onChange={(e) => setClubId(e.target.value)}
          className={selectClass}
        >
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Flex Day <span className="text-red-500">*</span>
        </label>
        {availableFlexDays.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-2">
            This club already has a session on every upcoming Flex Day.
          </p>
        ) : (
          <select
            value={flexDayId}
            onChange={(e) => setFlexDayId(e.target.value)}
            className={selectClass}
          >
            {availableFlexDays.map((fd) => (
              <option key={fd.id} value={fd.id}>
                {new Date(fd.date).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
                {fd.label ? ` — ${fd.label}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Room Override{" "}
          <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
        </label>
        {loadingRooms ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-2">
            Loading rooms...
          </div>
        ) : (
          <>
            <select
              value={roomOverrideId}
              onChange={(e) => setRoomOverrideId(e.target.value)}
              className={selectClass}
            >
              <option value="">
                Use club default
                {selectedClub?.defaultRoom && ` (${selectedClub.defaultRoom.name})`}
              </option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name} (capacity: {room.capacity})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Override the club&apos;s default room for this session only
            </p>
          </>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          Rotations <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-3 flex-wrap mb-3">
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

        {/* Signup mode toggle — shown only when 2+ rotations are selected */}
        {rotations.length >= 2 && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
              How should students sign up?
            </p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="signupMode"
                value="linked"
                checked={signupMode === "linked"}
                onChange={() => setSignupMode("linked")}
                className="mt-0.5 accent-indigo-600"
              />
              <span>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  Linked block
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  One signup covers all selected rotations. Students commit to the full block.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="signupMode"
                value="separate"
                checked={signupMode === "separate"}
                onChange={() => setSignupMode("separate")}
                className="mt-0.5 accent-indigo-600"
              />
              <span>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  Independent per rotation
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Creates separate sessions. Students can sign up for just one rotation.
                </span>
              </span>
            </label>
          </div>
        )}

        {rotations.length < 2 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Select all rotations this club will occupy. All selected rotations
            become a single session block — students sign up once and attend all.
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
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || rotations.length === 0 || availableFlexDays.length === 0}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading
            ? "Scheduling…"
            : signupMode === "separate" && rotations.length > 1
              ? `Schedule ${rotations.length} Sessions`
              : "Schedule Session"}
        </button>
      </div>
    </form>
  );
}
