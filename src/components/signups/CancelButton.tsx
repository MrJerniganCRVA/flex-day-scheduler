"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function CancelButton({
  signupId,
  disabled: isPastDeadline = false,
}: {
  signupId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isPastDeadline) {
    return (
      <span className="text-xs text-gray-400 dark:text-gray-500">
        Deadline passed
      </span>
    );
  }

  async function handleCancel() {
    setError(null);
    const res = await fetch(`/api/signups/${signupId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to cancel.");
      setConfirming(false);
      return;
    }
    startTransition(() => router.refresh());
  }

  if (confirming) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-red-600 dark:text-red-400 font-medium">Cancel signup?</p>
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Cancelling…" : "Yes, cancel"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Keep
          </button>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-red-600 dark:text-red-400 hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}
