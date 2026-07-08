"use client";

import { useState } from "react";

interface DutyStation {
  id: string;
  name: string;
  maxTeachers: number;
}

interface Props {
  initialStations: DutyStation[];
}

const MAX_TEACHERS_OPTIONS = [
  { value: 1, label: "1 teacher" },
  { value: 2, label: "2 teachers" },
];

export default function DutyStationManager({ initialStations }: Props) {
  const [stations, setStations] = useState(initialStations);
  const [editing, setEditing] = useState<DutyStation | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshStations() {
    const res = await fetch("/api/duty-stations");
    if (res.ok) setStations(await res.json());
  }

  async function handleSave(data: Omit<DutyStation, "id">, id?: string) {
    setError(null);
    const res = await fetch(id ? `/api/duty-stations/${id}` : "/api/duty-stations", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to save duty station");
      return;
    }
    setShowAdd(false);
    setEditing(null);
    await refreshStations();
  }

  async function handleDelete(station: DutyStation) {
    if (!confirm(`Delete "${station.name}"? All assignments for this station will also be removed.`)) return;
    setError(null);
    const res = await fetch(`/api/duty-stations/${station.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to delete duty station");
      return;
    }
    await refreshStations();
  }

  return (
    <div className="mt-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Duty Stations</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Floor spots where teachers are assigned during flex periods
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setEditing(null); }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + Add Station
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-800 dark:text-red-200 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {(showAdd || editing) && (
        <StationForm
          station={editing ?? undefined}
          onSave={(data) => handleSave(data, editing?.id)}
          onCancel={() => { setShowAdd(false); setEditing(null); }}
        />
      )}

      {stations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
          No duty stations yet. Add one to get started.
        </div>
      ) : (
        <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Max Teachers</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {stations.map((station) => (
                <tr key={station.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-white">{station.name}</td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                      {station.maxTeachers}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-right space-x-2">
                    <button
                      onClick={() => { setEditing(station); setShowAdd(false); }}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(station)}
                      className="text-red-600 dark:text-red-400 hover:underline font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StationForm({
  station,
  onSave,
  onCancel,
}: {
  station?: DutyStation;
  onSave: (data: Omit<DutyStation, "id">) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(station?.name ?? "");
  const [maxTeachers, setMaxTeachers] = useState<1 | 2>(
    (station?.maxTeachers ?? 1) as 1 | 2
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({ name, maxTeachers });
    setSaving(false);
  }

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-4">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Main Hallway"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Max Teachers</label>
          <select
            value={maxTeachers}
            onChange={(e) => setMaxTeachers(Number(e.target.value) as 1 | 2)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {MAX_TEACHERS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : station ? "Save" : "Add"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
