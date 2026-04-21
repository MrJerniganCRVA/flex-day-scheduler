"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Signup {
  id: string;
  attended: boolean | null;
  student: { id: string; name: string };
}

interface Props {
  sessionId: string;
  signups: Signup[];
}

export default function SessionAttendanceForm({ sessionId, signups }: Props) {
  const router = useRouter();

  const [attendance, setAttendance] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(signups.map((s) => [s.id, s.attended ?? true]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const records = Object.entries(attendance).map(([signupId, attended]) => ({
      signupId,
      attended,
    }));

    const res = await fetch(`/api/club-sessions/${sessionId}/attendance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save attendance");
      return;
    }

    setSaved(true);
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
        Attendance
      </p>
      <ul className="space-y-1">
        {signups.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`attend-${s.id}`}
              checked={attendance[s.id] ?? true}
              onChange={(e) =>
                setAttendance((prev) => ({ ...prev, [s.id]: e.target.checked }))
              }
              className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label
              htmlFor={`attend-${s.id}`}
              className="text-xs text-gray-700 dark:text-gray-300 cursor-pointer select-none"
            >
              {s.student.name}
            </label>
          </li>
        ))}
      </ul>

      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save Attendance"}
      </button>
    </div>
  );
}
