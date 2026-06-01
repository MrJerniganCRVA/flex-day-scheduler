"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";

interface Teacher {
  id: string;
  name: string;
  email: string;
}

interface Room {
  id: string;
  name: string;
  capacity: number;
}

interface Props {
  clubId?: string;
  defaultValues?: {
    name?: string;
    description?: string;
    maxCapacity?: number;
    defaultRotations?: RotationSlot[];
    defaultRoomId?: string | null;
    allowRandomAssignment?: boolean;
    defaultCoTeacherId?: string | null;
    defaultLinked?: boolean;
  };
  /** Admin only: list of assignable teachers */
  teachers?: Teacher[];
  /** Admin only: pre-selected owner id */
  defaultOwnerId?: string;
  /** Base path to redirect after save, e.g. "/admin/clubs" */
  returnBasePath?: string;
}

export default function ClubForm({
  clubId,
  defaultValues,
  teachers,
  defaultOwnerId,
  returnBasePath = "/teacher/clubs",
}: Props) {
  const router = useRouter();
  const isEdit = !!clubId;

  const [form, setForm] = useState({
    name: defaultValues?.name ?? "",
    description: defaultValues?.description ?? "",
    maxCapacity: defaultValues?.maxCapacity ?? 20,
  });
  const [allowRandomAssignment, setAllowRandomAssignment] = useState(
    defaultValues?.allowRandomAssignment ?? true
  );
  const [defaultRotations, setDefaultRotations] = useState<RotationSlot[]>(
    defaultValues?.defaultRotations ?? []
  );
  const [defaultRoomId, setDefaultRoomId] = useState(defaultValues?.defaultRoomId ?? "");
  const [ownerId, setOwnerId] = useState(defaultOwnerId ?? teachers?.[0]?.id ?? "");
  const [defaultCoTeacherId, setDefaultCoTeacherId] = useState(
    defaultValues?.defaultCoTeacherId ?? ""
  );
  const [defaultLinked, setDefaultLinked] = useState(
    defaultValues?.defaultLinked ?? true
  );
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [availableTeachers, setAvailableTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available rooms
  useEffect(() => {
    async function fetchRooms() {
      try {
        const url = clubId ? `/api/rooms?excludeClubId=${clubId}` : "/api/rooms";
        const res = await fetch(url);
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

  // Fetch available teachers for co-teacher selection
  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Teacher[]) => setAvailableTeachers(data))
      .catch(() => {});
  }, []);

  // Auto-populate capacity when room changes
  useEffect(() => {
    if (defaultRoomId && rooms.length > 0) {
      const selectedRoom = rooms.find((r) => r.id === defaultRoomId);
      if (selectedRoom) {
        // Auto-populate only if current capacity exceeds room capacity or is default
        if (form.maxCapacity === 20 || form.maxCapacity > selectedRoom.capacity) {
          setForm((prev) => ({ ...prev, maxCapacity: selectedRoom.capacity }));
        }
      }
    }
  }, [defaultRoomId, rooms]);

  function toggleRotation(rotation: RotationSlot) {
    setDefaultRotations((prev) =>
      prev.includes(rotation)
        ? prev.filter((r) => r !== rotation)
        : [...prev, rotation]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const url = isEdit ? `/api/clubs/${clubId}` : "/api/clubs";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        maxCapacity: Number(form.maxCapacity),
        description: form.description || undefined,
        defaultRotations,
        defaultRoomId: defaultRoomId || undefined,
        allowRandomAssignment,
        defaultCoTeacherId: defaultCoTeacherId || null,
        defaultLinked,
        ...(teachers && ownerId ? { ownerId } : {}),
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong.");
      return;
    }

    const club = await res.json();
    router.push(`${returnBasePath}/${club.id}`);
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">Basic Info</p>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Club Name <span className="text-red-500">*</span>
        </label>
        <input
          autoFocus
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Chess Club"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Description
        </label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Brief description of the club activity…"
          className={`${inputClass} resize-none`}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Max Capacity <span className="text-red-500">*</span>
        </label>
        <input
          type="number"
          required
          min={1}
          max={rooms.find((r) => r.id === defaultRoomId)?.capacity || 1000}
          value={form.maxCapacity}
          onChange={(e) =>
            setForm({ ...form, maxCapacity: Number(e.target.value) })
          }
          className={inputClass}
        />
        {defaultRoomId && rooms.find((r) => r.id === defaultRoomId) && (
          <>
            {form.maxCapacity > (rooms.find((r) => r.id === defaultRoomId)?.capacity || 0) && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                ⚠️ Capacity cannot exceed room limit ({rooms.find((r) => r.id === defaultRoomId)?.capacity})
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Room capacity: {rooms.find((r) => r.id === defaultRoomId)?.capacity}. You can set a lower limit if needed.
            </p>
          </>
        )}
        {!defaultRoomId && (
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Select a room to auto-populate capacity, or set manually (1-1000)
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Default Room{" "}
          <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
        </label>
        {loadingRooms ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-2">
            Loading rooms...
          </div>
        ) : rooms.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-2">
            No rooms available. Ask an admin to add rooms first.
          </div>
        ) : (
          <>
            <select
              value={defaultRoomId}
              onChange={(e) => setDefaultRoomId(e.target.value)}
              className={inputClass}
            >
              <option value="">-- No default room --</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name} (capacity: {room.capacity})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              This room will be used for all sessions unless overridden
            </p>
          </>
        )}
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-4 mb-1">Schedule</p>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          When does this club meet? <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Choose which time blocks this club runs during.{" "}
          <span className="text-gray-400 dark:text-gray-500">It will automatically appear on every Flex Day in the blocks you choose. You can adjust individual days later.</span>
        </p>
        <div className="space-y-2">
          {ALL_ROTATIONS.map((rotation) => (
            <label
              key={rotation}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={defaultRotations.includes(rotation)}
                onChange={() => toggleRotation(rotation)}
                className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-200">
                {ROTATION_LABELS[rotation]}
              </span>
            </label>
          ))}
        </div>
        {defaultRotations.length === 0 && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-2">
            Please select at least one rotation
          </p>
        )}

        {defaultRotations.length >= 2 && (
          <div className="mt-3 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={defaultLinked}
                onChange={(e) => setDefaultLinked(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <div className="text-sm font-medium text-violet-800 dark:text-violet-200">
                  Link rotations into one continuous session
                </div>
                <div className="text-xs text-violet-700 dark:text-violet-400 mt-0.5">
                  When linked, students commit to all selected rotations together as one block.
                  Uncheck to create separate independent sessions per rotation.
                </div>
              </div>
            </label>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Co-teacher{" "}
          <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
        </label>
        <select
          value={defaultCoTeacherId}
          onChange={(e) => setDefaultCoTeacherId(e.target.value)}
          className={inputClass}
        >
          <option value="">-- No co-teacher --</option>
          {availableTeachers
            .filter((t) => !ownerId || t.id !== ownerId)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          The co-teacher will default as the secondary teacher in coverage assignments.
        </p>
      </div>

      {teachers && teachers.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Assigned Teacher <span className="text-red-500">*</span>
          </label>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className={inputClass}
          >
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.email})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allowRandomAssignment}
            onChange={(e) => setAllowRandomAssignment(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Allow random assignment
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              When an admin runs auto-assign, students may be randomly placed in
              this club. Uncheck for clubs that should never receive randomly
              assigned students (e.g. religious or opt-in-only clubs).
            </div>
          </div>
        </label>
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
          disabled={loading || defaultRotations.length === 0}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading
            ? isEdit
              ? "Saving…"
              : "Creating…"
            : isEdit
              ? "Save Changes"
              : "Create Club"}
        </button>
      </div>
    </form>
  );
}
