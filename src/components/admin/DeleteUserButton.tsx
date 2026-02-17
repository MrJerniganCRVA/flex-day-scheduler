"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function DeleteUserButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      startTransition(() => router.refresh());
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
        >
          {isPending ? "…" : "Delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs text-red-500 hover:underline"
    >
      Remove
    </button>
  );
}
