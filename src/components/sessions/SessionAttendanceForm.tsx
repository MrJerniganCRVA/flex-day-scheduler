"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sortByLastName } from "@/lib/student-name";

interface Signup {
  id: string;
  attended: boolean | null;
  student: { id: string; name: string };
}

interface Props {
  sessionId: string;
  signups: Signup[];
}

/**
 * Calling the roll, on the day.
 *
 * Sized to be read rather than to be compact: this list is worked through
 * standing up, off a phone or a projected screen, against a room of up to 100
 * students. It used to be `text-xs` names beside 14px checkboxes with nothing
 * between the rows, which is fine to skim and very easy to lose your place in.
 * Hence the larger type, the full-width row as the hit target, and the striping.
 */
export default function SessionAttendanceForm({ sessionId, signups }: Props) {
  const router = useRouter();

  // Roster order, not first-name order. The query that loaded these sorts on
  // `student.name`, which is a single "First Last" string — see
  // src/lib/student-name.ts. Sorted here so the shared query stays shared.
  const roster = useMemo(
    () => sortByLastName(signups, (s) => s.student.name),
    [signups]
  );

  const [attendance, setAttendance] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(signups.map((s) => [s.id, s.attended ?? true]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A number to reconcile against the room, live as boxes are unticked.
  const presentCount = roster.filter((s) => attendance[s.id] ?? true).length;

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
    <div className="mt-2">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Attendance
        </p>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
          {presentCount}/{roster.length} present
        </p>
      </div>

      <ul className="divide-y divide-gray-100 dark:divide-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {roster.map((s) => (
          <li
            key={s.id}
            className="odd:bg-gray-50/70 dark:odd:bg-gray-800/30"
          >
            {/* The whole row is the label, so the name is as tappable as the
                box — the previous 14px checkbox was the only target. */}
            <label className="flex cursor-pointer select-none items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={attendance[s.id] ?? true}
                onChange={(e) =>
                  setAttendance((prev) => ({ ...prev, [s.id]: e.target.checked }))
                }
                className="h-5 w-5 shrink-0 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-800 dark:text-gray-200">
                {s.student.name}
              </span>
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
