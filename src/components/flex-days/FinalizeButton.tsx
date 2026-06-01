"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface FinalizeButtonProps {
  flexDayId: string;
  isFinalized: boolean;
  uncoveredCount?: number;
}

export default function FinalizeButton({
  flexDayId,
  isFinalized,
  uncoveredCount = 0,
}: FinalizeButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unfinalizeConfirming, setUnfinalizeConfirming] = useState(false);

  async function handleFinalize() {
    setError(null);
    const res = await fetch(`/api/flex-days/${flexDayId}/finalize`, {
      method: "POST",
    });
    if (res.ok) {
      startTransition(() => router.refresh());
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
    }
  }

  async function handleUnfinalize() {
    setError(null);
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

  if (isFinalized) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <button
          disabled
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 cursor-default"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Invites Sent
        </button>

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
            <span className="text-gray-600 dark:text-gray-300">Mark as unfinalized? Calendar invites already sent will not be recalled.</span>
            <button
              onClick={handleUnfinalize}
              disabled={isPending}
              className="font-medium text-gray-700 dark:text-gray-200 hover:underline disabled:opacity-50"
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
    <div className="flex flex-col items-end gap-2">
      {uncoveredCount > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 max-w-xs text-right">
          ⚠ {uncoveredCount} session{uncoveredCount !== 1 ? "s" : ""} have absent teachers.{" "}
          <a href="/admin/coverage" className="underline font-medium">Check Coverage</a> before finalizing.
        </div>
      )}
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
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
