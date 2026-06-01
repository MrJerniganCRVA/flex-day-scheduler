"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@/types";

type AbsenceStatus = "PRESENT" | "ABSENT" | "REASSIGNED";

interface AbsenceRecord {
  rotation: RotationSlot;
  type: string;
}

interface Props {
  flexDayId: string;
  initialAbsences: AbsenceRecord[];
}

export default function TeacherAbsenceSelector({ flexDayId, initialAbsences }: Props) {
  const router = useRouter();
  const [absences, setAbsences] = useState<AbsenceRecord[]>(initialAbsences);
  const [saving, setSaving] = useState<RotationSlot | null>(null);

  function getStatus(rotation: RotationSlot): AbsenceStatus {
    return (absences.find((a) => a.rotation === rotation)?.type as AbsenceStatus) ?? "PRESENT";
  }

  async function handleChange(rotation: RotationSlot, type: AbsenceStatus) {
    setSaving(rotation);
    const res = await fetch("/api/teacher/flex-day-absence", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flexDayId, rotation, type }),
    });
    setSaving(null);
    if (res.ok) {
      setAbsences((prev) => [
        ...prev.filter((a) => a.rotation !== rotation),
        ...(type !== "PRESENT" ? [{ rotation, type }] : []),
      ]);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg bg-white/60 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
      <div className="w-full flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 shrink-0">
          My attendance status:
        </span>
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs text-gray-400 dark:text-gray-500 self-center">Mark all:</span>
          {(["PRESENT", "ABSENT", "REASSIGNED"] as AbsenceStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => ALL_ROTATIONS.forEach((r) => handleChange(r, status))}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {status === "PRESENT" ? "Present" : status === "ABSENT" ? "Absent" : "Covering"}
            </button>
          ))}
        </div>
      </div>
      {ALL_ROTATIONS.map((rotation) => {
        const status = getStatus(rotation);
        const isSaving = saving === rotation;
        return (
          <div key={rotation} className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400">{ROTATION_LABELS[rotation]}:</span>
            <select
              value={status}
              onChange={(e) => handleChange(rotation, e.target.value as AbsenceStatus)}
              disabled={isSaving}
              className={`rounded-md border px-2 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50 transition-colors dark:[color-scheme:dark] ${
                status === "ABSENT"
                  ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                  : status === "REASSIGNED"
                    ? "bg-teal-50 dark:bg-teal-950/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300"
                    : "bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
              }`}
            >
              <option value="PRESENT">Present</option>
              <option value="ABSENT">Absent from school</option>
              <option value="REASSIGNED">Covering another club</option>
            </select>
          </div>
        );
      })}
    </div>
  );
}
