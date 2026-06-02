"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Room {
  id: string;
  name: string;
  capacity: number;
}

interface Props {
  sessionId: string;
  currentRoomName: string | null;
  adminRoomLocked: boolean;
}

export default function AdminRoomSelector({
  sessionId,
  currentRoomName,
  adminRoomLocked,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!editing) return;
    fetch("/api/rooms?all=true")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Room[]) => setRooms(data))
      .catch(() => {});
  }, [editing]);

  useEffect(() => {
    if (editing && selectRef.current) selectRef.current.focus();
  }, [editing, rooms]);

  async function save() {
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = { adminRoomLocked: true };
    if (selectedId) {
      body.roomOverrideId = selectedId;
    } else {
      body.roomOverrideId = null;
      body.adminRoomLocked = false;
    }
    const res = await fetch(`/api/club-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to update room.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {currentRoomName ?? "Default room"}
        </span>
        {adminRoomLocked && (
          <span className="rounded-full bg-indigo-100 dark:bg-indigo-950/50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
            Admin set
          </span>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <select
        ref={selectRef}
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={saving}
        className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">Use default room</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} (cap. {r.capacity})
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => { setEditing(false); setError(null); }}
          disabled={saving}
          className="rounded border border-gray-300 dark:border-gray-600 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
