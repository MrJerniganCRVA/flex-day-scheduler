"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Teacher {
  id: string;
  name: string;
  email: string;
}

interface Props {
  clubId?: string;
  defaultValues?: {
    name?: string;
    description?: string;
    maxCapacity?: number;
    location?: string;
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
    location: defaultValues?.location ?? "",
  });
  const [ownerId, setOwnerId] = useState(defaultOwnerId ?? teachers?.[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        location: form.location || undefined,
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Max Capacity <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            required
            min={1}
            max={500}
            value={form.maxCapacity}
            onChange={(e) =>
              setForm({ ...form, maxCapacity: Number(e.target.value) })
            }
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Default Room / Location
          </label>
          <input
            type="text"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="e.g. Room 204"
            className={inputClass}
          />
        </div>
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
          disabled={loading}
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
