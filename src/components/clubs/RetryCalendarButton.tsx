"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown only for clubs with no Google Calendar. Such a club looks entirely
 * normal everywhere else in the app but is silently skipped by finalize, so
 * nobody on its roster ever receives an invite — this is the visible marker
 * and the fix.
 */
export default function RetryCalendarButton({ clubId }: { clubId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clubs/${clubId}/calendar`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not set up the calendar.");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <span
          title="This club has no Google Calendar, so its sessions cannot send invites."
          className="rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
        >
          No calendar
        </span>
        <button
          onClick={handleRetry}
          disabled={busy || isPending}
          className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
        >
          {busy || isPending ? "Setting up…" : "Retry calendar setup"}
        </button>
      </span>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </span>
  );
}
