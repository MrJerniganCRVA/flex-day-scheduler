"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function DeleteUserButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    setLoading(false);
    if (res.ok) {
      startTransition(() => router.refresh());
    } else {
      setError("Failed to remove user. Please try again.");
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            disabled={loading || isPending}
            className="rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-2 py-0.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/80 disabled:opacity-50"
          >
            {loading || isPending ? "…" : "Delete"}
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={loading || isPending}
            className="rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            No
          </button>
        </div>
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs text-red-500 dark:text-red-400 hover:underline"
    >
      Remove
    </button>
  );
}
