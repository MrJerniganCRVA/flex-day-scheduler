"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface FinalizeButtonProps {
  flexDayId: string;
  isFinalized: boolean;
}

export default function FinalizeButton({
  flexDayId,
  isFinalized,
}: FinalizeButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  if (isFinalized) {
    return (
      <button
        disabled
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 cursor-default"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
        Invites Sent
      </button>
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
            <svg
              className="w-4 h-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
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
