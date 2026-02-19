"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function DeleteClubButton({
  clubId,
  redirectTo = "/teacher/clubs",
}: {
  clubId: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    const res = await fetch(`/api/clubs/${clubId}`, { method: "DELETE" });
    if (res.ok) {
      startTransition(() => {
        router.push(redirectTo);
        router.refresh();
      });
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-600 dark:text-red-400">Delete club?</span>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/80 disabled:opacity-50"
        >
          {isPending ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/80 transition-colors"
    >
      Delete
    </button>
  );
}
