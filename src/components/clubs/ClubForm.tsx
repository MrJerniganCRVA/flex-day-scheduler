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
    linkedRotations?: boolean;
    cosponsorId?: string | null;
  };
  /** Candidate teachers for the Cosponsor dropdown (and, for admins, ownership reassignment) */
  teachers?: Teacher[];
  /** Admin only: shows the owner-reassignment dropdown and submits ownerId */
  isAdmin?: boolean;
  /** Admin only: pre-selected owner id */
  defaultOwnerId?: string;
  /** Base path to redirect after save, e.g. "/admin/clubs" */
  returnBasePath?: string;
}

export default function ClubForm({
  clubId,
  defaultValues,
  teachers,
  isAdmin = false,
  defaultOwnerId,
  returnBasePath = "/teacher/clubs",
}: Props) {
  const router = useRouter();
  const isEdit = !!clubId;

  const [form, setForm] = useState<{
    name: string;
    description: string;
    maxCapacity: number | "";
  }>({
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
  const [linkedRotations, setLinkedRotations] = useState(
    defaultValues?.linkedRotations ?? false
  );
  const [defaultRoomId, setDefaultRoomId] = useState(defaultValues?.defaultRoomId ?? "");
  const [ownerId, setOwnerId] = useState(
    isAdmin ? (defaultOwnerId ?? teachers?.[0]?.id ?? "") : ""
  );
  const [cosponsorId, setCosponsorId] = useState(defaultValues?.cosponsorId ?? "");

  // Clear a stale cosponsor selection if admin reassigns the owner to that same person
  useEffect(() => {
    if (cosponsorId && cosponsorId === ownerId) setCosponsorId("");
  }, [ownerId, cosponsorId]);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available rooms — re-runs whenever the selected rotations change so
  // the list reflects which rooms are actually free during those periods
  useEffect(() => {
    async function fetchRooms() {
      try {
        const params = new URLSearchParams();
        if (clubId) params.set("excludeClubId", clubId);
        for (const rotation of defaultRotations) params.append("rotations", rotation);
        const res = await fetch(`/api/rooms?${params.toString()}`);
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
  }, [clubId, defaultRotations]);

  // Auto-populate capacity when room changes
  useEffect(() => {
    if (defaultRoomId && rooms.length > 0) {
      const selectedRoom = rooms.find((r) => r.id === defaultRoomId);
      if (selectedRoom) {
        // Auto-populate only if capacity is blank/default or exceeds the room
        if (
          form.maxCapacity === "" ||
          form.maxCapacity === 20 ||
          form.maxCapacity > selectedRoom.capacity
        ) {
          setForm((prev) => ({ ...prev, maxCapacity: selectedRoom.capacity }));
        }
      }
    }
  }, [defaultRoomId, rooms]);

  function toggleRotation(rotation: RotationSlot) {
    setDefaultRotations((prev) => {
      const next = prev.includes(rotation)
        ? prev.filter((r) => r !== rotation)
        : [...prev, rotation];
      // Reset to the default (independent) when dropping back to fewer than 2 rotations
      if (next.length < 2) setLinkedRotations(false);
      return next;
    });
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
        linkedRotations,
        cosponsorId: cosponsorId || null,
        ...(isAdmin && ownerId ? { ownerId } : {}),
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

  const cosponsorCandidates = (teachers ?? []).filter((t) => t.id !== ownerId);

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Club Name <span className="text-red-500">*</span>
        </label>
        <input
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
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          Default Rotations <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Which rotations does this club normally run in? This club will be
          automatically scheduled for these rotations on every flex day. This
          can be modified later for any and all flex days if needed.
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

        {/* Signup mode toggle — shown only when 2+ rotations are selected */}
        {defaultRotations.length >= 2 && (
          <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
              How should students sign up?
            </p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="linkedRotations"
                checked={!linkedRotations}
                onChange={() => setLinkedRotations(false)}
                className="mt-0.5 accent-indigo-600"
              />
              <span>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  Independent per rotation
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Creates separate sessions on every flex day. Students can sign up for just one rotation.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="linkedRotations"
                checked={linkedRotations}
                onChange={() => setLinkedRotations(true)}
                className="mt-0.5 accent-indigo-600"
              />
              <span>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  Linked block
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Students must commit to all Flex Rotations you have chosen for this club.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Default Room/Area{" "}
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
            setForm({
              ...form,
              maxCapacity: e.target.value === "" ? "" : Number(e.target.value),
            })
          }
          className={inputClass}
        />
        {defaultRoomId && rooms.find((r) => r.id === defaultRoomId) && (
          <>
            {form.maxCapacity !== "" &&
              form.maxCapacity > (rooms.find((r) => r.id === defaultRoomId)?.capacity || 0) && (
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
              Random Assignment
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              When the admin runs auto-assignment for a Flex Day, any students
              who haven&apos;t signed up anywhere may be randomly placed into
              this club to fill its open seats. Only uncheck this box if you
              have a legitimate reason to not have students be randomly
              assigned to your club (ex. Bible Study, Prism Paradise, etc).
            </div>
          </div>
        </label>
      </div>

      {teachers && teachers.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Cosponsor{" "}
            <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Another teacher who co-manages this club. A cosponsor can edit the
            club, schedule and edit sessions, and mark attendance — the same
            as the primary owner.
          </p>
          {cosponsorCandidates.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              No other teachers available.
            </p>
          ) : (
            <select
              value={cosponsorId}
              onChange={(e) => setCosponsorId(e.target.value)}
              className={inputClass}
            >
              <option value="">No Cosponsor</option>
              {cosponsorCandidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.email})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {isAdmin && teachers && teachers.length > 0 && (
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
