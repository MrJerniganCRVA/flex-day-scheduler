"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Takes one named teacher out of one rotation of one session, from the admin
 * Coverage page.
 *
 * This is the counterpart to clearing T1, and the distinction matters:
 *
 *   "None — needs cover" on the T1 dropdown says *the slot* is empty. It is a
 *   property of the session, and it survives a change of club owner — the new
 *   owner is not defaulted in either.
 *
 *   This button says *this person* is not attending. That is the right record for
 *   a double-booking, which is about the teacher, not the slot: it names who and
 *   why, it shows up on that teacher's own dashboard so they can see and undo it,
 *   and if the club later changes hands the new owner is defaulted in normally.
 *
 * Writes a SessionTeacherAbsence through the existing absence route, which already
 * lets an ADMIN act on another teacher's behalf and already scopes to specific
 * rotations. `src/components/sessions/RotationClashNotice.tsx` does the same thing
 * from the teacher's own side.
 */
export default function CoverageAbsenceButton({
  sessionId,
  rotation,
  teacherId,
  teacherName,
  isAbsent,
}: {
  sessionId: string;
  rotation: string;
  teacherId: string;
  teacherName: string;
  isAbsent: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/club-sessions/${sessionId}/absence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          rotations: [rotation],
          absent: !isAbsent,
          reason: isAbsent
            ? undefined
            : "Marked not attending by an admin from the Coverage page",
        }),
      });
      if (!res.ok) {
        setError("Could not save that. Please try again.");
        return;
      }
      // The absence changes what src/lib/coverage.ts resolves, so let the server
      // re-render rather than guessing the new state here.
      startTransition(() => router.refresh());
    } catch {
      setError("Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={toggle}
        disabled={disabled}
        title={
          isAbsent
            ? `${teacherName} is marked as not attending this rotation — undo`
            : `Record that ${teacherName} will not be here this rotation`
        }
        className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
          isAbsent
            ? "border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200"
            : "border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        }`}
      >
        {disabled ? "…" : isAbsent ? "Not here ✓" : "Not here"}
      </button>
      {error && (
        <span className="text-[10px] text-red-600 dark:text-red-400">{error}</span>
      )}
    </span>
  );
}
