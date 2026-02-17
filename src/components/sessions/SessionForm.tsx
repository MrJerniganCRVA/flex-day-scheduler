"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";

interface Club {
  id: string;
  name: string;
}

interface FlexDay {
  id: string;
  date: Date | string;
  label: string | null;
}

interface Props {
  clubs: Club[];
  flexDays: FlexDay[];
  preselectedClubId?: string;
}

export default function SessionForm({
  clubs,
  flexDays,
  preselectedClubId,
}: Props) {
  const router = useRouter();
  const [clubId, setClubId] = useState(preselectedClubId ?? clubs[0]?.id ?? "");
  const [flexDayId, setFlexDayId] = useState(flexDays[0]?.id ?? "");
  const [rotations, setRotations] = useState<RotationSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/clubs/${clubId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flexDayId, rotations }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to schedule session.");
      return;
    }

    router.push(`/teacher/clubs/${clubId}`);
    router.refresh();
  }

  if (clubs.length === 0) {
    return (
      <div className="rounded-xl bg-white border border-gray-200 p-6 text-gray-500">
        You don&apos;t have any clubs yet. Create a club first.
      </div>
    );
  }

  if (flexDays.length === 0) {
    return (
      <div className="rounded-xl bg-white border border-gray-200 p-6 text-gray-500">
        No Flex Days have been scheduled. Ask an administrator to create one.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 bg-white rounded-xl border border-gray-200 p-6"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Club <span className="text-red-500">*</span>
        </label>
        <select
          value={clubId}
          onChange={(e) => setClubId(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Flex Day <span className="text-red-500">*</span>
        </label>
        <select
          value={flexDayId}
          onChange={(e) => setFlexDayId(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {flexDays.map((fd) => (
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
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Rotations <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Select all rotations this club will occupy. All selected rotations
          become a single session block — students sign up once and attend all.
        </p>
        <div className="flex gap-3">
          {ALL_ROTATIONS.map((r) => (
            <label
              key={r}
              className={`flex items-center gap-2 cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                rotations.includes(r)
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
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

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || rotations.length === 0}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Scheduling…" : "Schedule Session"}
        </button>
      </div>
    </form>
  );
}
