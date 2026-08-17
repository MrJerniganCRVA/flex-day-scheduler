"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface FinalizeButtonProps {
  flexDayId: string;
  isFinalized: boolean;
}

/** Shape of the finalize endpoint's response, success or failure. */
type FinalizeResult = {
  error?: string;
  sessionsSent?: number;
  sessionsFailed?: number;
  sessionsSkipped?: number;
  problems?: string[];
};

export default function FinalizeButton({
  flexDayId,
  isFinalized,
}: FinalizeButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Sessions that got no invite even though the day itself finalized. Without
  // this the button just went green and the admin had no way to know.
  const [problems, setProblems] = useState<string[]>([]);
  const [unfinalizeConfirming, setUnfinalizeConfirming] = useState(false);

  async function handleFinalize() {
    setError(null);
    setProblems([]);
    const res = await fetch(`/api/flex-days/${flexDayId}/finalize`, {
      method: "POST",
    });
    const data: FinalizeResult = await res.json().catch(() => ({}));
    if (res.ok) {
      setProblems(data.problems ?? []);
      startTransition(() => router.refresh());
    } else {
      setError(data.error ?? "Something went wrong. Please try again.");
      setProblems(data.problems ?? []);
    }
  }

  async function handleUnfinalize() {
    setError(null);
    setProblems([]);
    setUnfinalizeConfirming(false);
    const res = await fetch(`/api/flex-days/${flexDayId}/unfinalize`, {
      method: "POST",
    });
    if (res.ok) {
      startTransition(() => router.refresh());
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
    }
  }

  const problemList = problems.length > 0 && (
    <div className="max-w-sm rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-left">
      <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
        {problems.length} session{problems.length === 1 ? "" : "s"} did not
        receive invites
      </p>
      <ul className="mt-1 space-y-1">
        {problems.map((p, i) => (
          <li key={i} className="text-xs text-amber-700 dark:text-amber-300">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );

  if (isFinalized) {
    const hasProblems = problems.length > 0;
    return (
      <div className="flex flex-col items-end gap-1.5">
        <button
          disabled
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-default ${
            hasProblems
              ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
              : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
          }`}
        >
          {hasProblems ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {hasProblems ? "Invites Partially Sent" : "Invites Sent"}
        </button>

        {problemList}

        {!unfinalizeConfirming ? (
          <button
            onClick={() => setUnfinalizeConfirming(true)}
            disabled={isPending}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:underline disabled:opacity-50"
          >
            Unfinalize
          </button>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-600 dark:text-gray-300">Revert to unfinalized?</span>
            <button
              onClick={handleUnfinalize}
              disabled={isPending}
              className="font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
            >
              Yes
            </button>
            <button
              onClick={() => setUnfinalizeConfirming(false)}
              className="text-gray-500 dark:text-gray-400 hover:underline"
            >
              No
            </button>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleFinalize}
        disabled={isPending}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white transition-colors"
      >
        {isPending ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Sending Invites…
          </>
        ) : (
          "Send Calendar Invites"
        )}
      </button>
      {error && (
        <p className="max-w-sm text-xs text-red-600 dark:text-red-400 text-left">
          {error}
        </p>
      )}
      {problemList}
    </div>
  );
}
