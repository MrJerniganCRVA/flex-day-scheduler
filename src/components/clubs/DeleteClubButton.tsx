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
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 max-w-sm">
        <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
          Delete this club?
        </p>
        <p className="text-xs text-red-600 dark:text-red-400 mb-2">
          This permanently removes the club and all of its sessions. You will
          need to recreate it from scratch if you change your mind.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          If you only want to skip a specific flex day, remove the session for
          that day instead — the club itself will remain intact.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Deleting…" : "Yes, delete club"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/80 transition-colors"
    >
      Delete Club
    </button>
  );
}
