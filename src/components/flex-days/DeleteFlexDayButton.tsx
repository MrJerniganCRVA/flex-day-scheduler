"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Deleting a flex day cascades away every session, signup, attendance record,
 * and coverage assignment for that day — and if invites already went out, every
 * student is holding a calendar entry for it. The old confirmation was a bare
 * "Delete? / Yes", which gave no sense of any of that. This states the actual
 * blast radius, modelled on DeleteClubButton.
 */
export default function DeleteFlexDayButton({
  flexDayId,
  sessionCount,
  studentCount,
  isFinalized,
}: {
  flexDayId: string;
  sessionCount: number;
  /** Distinct students with at least one signup that day. */
  studentCount: number;
  isFinalized: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    const res = await fetch(`/api/flex-days/${flexDayId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      startTransition(() => router.refresh());
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not delete this Flex Day.");
    }
  }

  if (confirming) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 max-w-sm text-left">
        <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
          Delete this Flex Day?
        </p>

        <p className="text-xs text-red-600 dark:text-red-400 mb-2">
          This permanently removes{" "}
          {sessionCount === 0
            ? "this day"
            : `${sessionCount} session${sessionCount === 1 ? "" : "s"}`}
          {studentCount > 0 && (
            <>
              {" "}
              along with the signups and attendance records for{" "}
              <span className="font-semibold">
                {studentCount} student{studentCount === 1 ? "" : "s"}
              </span>
            </>
          )}
          . This cannot be undone.
        </p>

        {isFinalized && (
          <p className="text-xs text-red-700 dark:text-red-300 mb-2 font-medium">
            Calendar invites for this day have already been sent. Deleting it
            will cancel those events on everyone&apos;s calendars.
          </p>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          To take the day off the schedule without losing its history, mark it
          inactive instead.
        </p>

        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Deleting…" : "Yes, delete Flex Day"}
          </button>
          <button
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs text-red-500 dark:text-red-400 hover:underline"
    >
      Delete
    </button>
  );
}
