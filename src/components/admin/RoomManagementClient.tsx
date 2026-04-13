"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import RoomForm from "./RoomForm";

interface Room {
  id: string;
  name: string;
  capacity: number;
  isActive: boolean;
  _count: {
    clubsWithDefault: number;
    sessionOverrides: number;
  };
}

interface Props {
  initialRooms: Room[];
}

export default function RoomManagementClient({ initialRooms }: Props) {
  const router = useRouter();
  const [rooms, setRooms] = useState(initialRooms);
  const [searchQuery, setSearchQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Filter rooms by search query
  const filteredRooms = rooms.filter((room) => {
    const matchesSearch = room.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = showInactive || room.isActive;
    return matchesSearch && matchesStatus;
  });

  async function refreshRooms() {
    try {
      const res = await fetch("/api/admin/rooms");
      if (res.ok) {
        const updatedRooms = await res.json();
        setRooms(updatedRooms);
      }
    } catch {
      // Fallback to router.refresh if fetch fails
      router.refresh();
    }
  }

  async function handleDelete(roomId: string) {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;

    const totalUsage = room._count.clubsWithDefault + room._count.sessionOverrides;
    if (totalUsage > 0) {
      setDeleteError(
        `Cannot delete "${room.name}" - currently used by ${room._count.clubsWithDefault} club(s) and ${room._count.sessionOverrides} session(s)`
      );
      return;
    }

    if (!confirm(`Are you sure you want to deactivate "${room.name}"?`)) return;

    try {
      const res = await fetch(`/api/admin/rooms/${roomId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error ?? "Failed to delete room");
        return;
      }

      await refreshRooms();
    } catch {
      setDeleteError("Something went wrong");
    }
  }

  async function handleAddSuccess() {
    setShowAddModal(false);
    await refreshRooms();
  }

  async function handleEditSuccess() {
    setEditingRoom(null);
    await refreshRooms();
  }

  return (
    <>
      {/* Search and filter bar */}
      <div className="mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 accent-indigo-600"
          />
          Show inactive
        </label>

        <div className="text-sm text-gray-500 dark:text-gray-400">
          {filteredRooms.length} room{filteredRooms.length !== 1 ? "s" : ""}
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + Add Room
        </button>
      </div>

      {/* Error message */}
      {deleteError && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {deleteError}
          <button
            onClick={() => setDeleteError(null)}
            className="ml-2 text-red-800 dark:text-red-200 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Rooms table */}
      {filteredRooms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
          {searchQuery ? "No rooms match your search" : "No rooms yet. Add one to get started."}
        </div>
      ) : (
        <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  Room Name
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  Capacity
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  Usage
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredRooms.map((room) => {
                const totalUsage = room._count.clubsWithDefault + room._count.sessionOverrides;

                return (
                  <tr key={room.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-white">
                      {room.name}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {room.capacity}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {totalUsage > 0 ? (
                        <span className="text-indigo-600 dark:text-indigo-400">
                          {room._count.clubsWithDefault} club{room._count.clubsWithDefault !== 1 ? "s" : ""}
                          {room._count.sessionOverrides > 0 &&
                            `, ${room._count.sessionOverrides} session${room._count.sessionOverrides !== 1 ? "s" : ""}`}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">Not in use</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm">
                      {room.isActive ? (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                          <span className="text-lg">✓</span> Active
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">Inactive</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-right space-x-2">
                      <button
                        onClick={() => setEditingRoom(room)}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                      >
                        Edit
                      </button>
                      {room.isActive && (
                        <button
                          onClick={() => handleDelete(room.id)}
                          className="text-red-600 dark:text-red-400 hover:underline font-medium"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add room modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Add New Room
            </h2>
            <RoomForm
              onSuccess={handleAddSuccess}
              onCancel={() => setShowAddModal(false)}
            />
          </div>
        </div>
      )}

      {/* Edit room modal */}
      {editingRoom && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Edit Room
            </h2>
            <RoomForm
              room={editingRoom}
              onSuccess={handleEditSuccess}
              onCancel={() => setEditingRoom(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}
