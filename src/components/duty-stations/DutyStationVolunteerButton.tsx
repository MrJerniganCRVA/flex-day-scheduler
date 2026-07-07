"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RotationSlot } from "@prisma/client";

export default function DutyStationVolunteerButton({
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

  async function handleVolunteer() {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/duty-stations/${stationId}/volunteer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flexDayId, rotation }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? "Failed to volunteer");
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
        onClick={handleVolunteer}
        disabled={status === "loading"}
        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
      >
        {status === "loading" ? "Volunteering…" : "Volunteer"}
      </button>
      {errorMsg && (
        <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errorMsg}</p>
      )}
    </div>
  );
}
