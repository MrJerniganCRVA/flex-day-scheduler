"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RotationSlot } from "@prisma/client";

export default function VolunteerButton({
  sessionId,
  rotation,
  label,
}: {
  sessionId: string;
  rotation: RotationSlot;
  label: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVolunteer() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/club-sessions/${sessionId}/volunteer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotation }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to volunteer");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleVolunteer}
        disabled={loading}
        className="rounded-lg border border-teal-400 dark:border-teal-600 px-2.5 py-1 text-xs font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 disabled:opacity-50 transition-colors"
      >
        {loading ? "…" : `Cover ${label}`}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
