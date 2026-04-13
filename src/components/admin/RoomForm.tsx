"use client";

import { useState } from "react";

interface Room {
  id: string;
  name: string;
  capacity: number | null;
}

interface Props {
  room?: Room; // If provided, we're editing; otherwise creating
  onSuccess: () => void;
  onCancel: () => void;
}

export default function RoomForm({ room, onSuccess, onCancel }: Props) {
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(room?.capacity?.toString() ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!room;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const capacityNum = capacity.trim() ? parseInt(capacity, 10) : null;

    // Validation
    if (!name.trim()) {
      setError("Room name is required");
      setLoading(false);
      return;
    }

    if (!capacityNum || isNaN(capacityNum) || capacityNum <= 0 || capacityNum > 1000) {
      setError("Capacity must be between 1 and 1000");
      setLoading(false);
      return;
    }

    try {
      const url = isEditing ? `/api/admin/rooms/${room.id}` : "/api/admin/rooms";
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          capacity: capacityNum,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? `Failed to ${isEditing ? "update" : "create"} room`);
        setLoading(false);
        return;
      }

      onSuccess();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Room Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Room 204, Library, Gymnasium"
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          disabled={loading}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
          Capacity <span className="text-red-500">*</span>
        </label>
        <input
          type="number"
          required
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder="e.g., 30"
          min="1"
          max="1000"
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          disabled={loading}
        />
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Maximum number of students the room can hold (1-1000)
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (isEditing ? "Updating..." : "Creating...") : isEditing ? "Update Room" : "Create Room"}
        </button>
      </div>
    </form>
  );
}
