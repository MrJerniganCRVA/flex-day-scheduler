"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RotationSlot } from "@prisma/client";

export default function DutyStationUnvolunteerButton({
  stationId,
  flexDayId,
  rotation,
}: {
  stationId: string;
  flexDayId: string;
  rotation: RotationSlot;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleUnvolunteer() {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/duty-stations/${stationId}/volunteer?flexDayId=${flexDayId}&rotation=${rotation}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? "Failed to remove");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Something went wrong");
      setStatus("error");
    }
  }

  return (
    <div>
      <button
        onClick={handleUnvolunteer}
        disabled={status === "loading"}
        className="rounded-lg border border-red-300 dark:border-red-700 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
      >
        {status === "loading" ? "Removing…" : "Remove"}
      </button>
      {errorMsg && (
        <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errorMsg}</p>
      )}
    </div>
  );
}
