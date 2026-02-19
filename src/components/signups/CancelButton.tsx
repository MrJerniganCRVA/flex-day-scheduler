"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function CancelButton({ signupId }: { signupId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setError(null);
    const res = await fetch(`/api/signups/${signupId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to cancel.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <button
        onClick={handleCancel}
        disabled={isPending}
        className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
      >
        {isPending ? "Cancelling…" : "Cancel"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{error}</p>}
    </div>
  );
}
