"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RotationSlot } from "@prisma/client";

export default function StopCoveringButton({
  sessionId,
  rotation,
}: {
  sessionId: string;
  rotation: RotationSlot;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStop() {
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/club-sessions/${sessionId}/volunteer?rotation=${rotation}`,
      { method: "DELETE" }
    );
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to remove coverage");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleStop}
        disabled={loading}
        className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
      >
        {loading ? "…" : "Stop covering"}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
