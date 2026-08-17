"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ClashOption = {
  sessionId: string;
  name: string;
  /** Whether this teacher has already stepped back from this session. */
  absent: boolean;
};

/**
 * Shown on the teacher dashboard when a teacher is expected in more than one
 * session during the same rotation. Nobody can be in two rooms at once, so the
 * dashboard has to ask which one.
 *
 * Choosing a session marks the teacher absent from the others for this rotation.
 * The clubs they step back from are *not* cancelled — they keep running and show
 * as needing coverage to admins, which is the whole point: the club still happens,
 * the teacher just isn't the one in the room.
 */
export default function RotationClashNotice({
  rotationLabel,
  rotation,
  options,
}: {
  rotationLabel: string;
  rotation: string;
  options: ClashOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function chooseSession(keepSessionId: string) {
    setBusy(keepSessionId);
    setError(null);
    try {
      // Attend the chosen one, step back from the rest — for this rotation only,
      // so a linked session's other rotations are untouched.
      const updates = options.map((o) =>
        fetch(`/api/club-sessions/${o.sessionId}/absence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            absent: o.sessionId !== keepSessionId,
            rotations: [rotation],
            reason:
              o.sessionId !== keepSessionId
                ? "Double-booked — attending another session this rotation"
                : undefined,
          }),
        })
      );
      const results = await Promise.all(updates);
      if (results.some((r) => !r.ok)) {
        setError("Could not save that. Please try again.");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  const attending = options.find((o) => !o.absent);
  const resolved = options.filter((o) => !o.absent).length === 1;

  return (
    <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5">
      <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
        {resolved
          ? `${rotationLabel}: you're attending ${attending?.name}`
          : `You're expected in ${options.length} places during ${rotationLabel}`}
      </p>
      <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
        {resolved
          ? "The others still run and are flagged to admins as needing coverage."
          : "Pick where you'll be. The others keep running and are flagged to admins as needing coverage."}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => {
          const isChoice = !o.absent;
          return (
            <button
              key={o.sessionId}
              onClick={() => chooseSession(o.sessionId)}
              disabled={busy !== null || isPending}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                isChoice && resolved
                  ? "bg-green-600 text-white"
                  : "border border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              }`}
            >
              {busy === o.sessionId
                ? "Saving…"
                : isChoice && resolved
                  ? `✓ ${o.name}`
                  : `I'll be at ${o.name}`}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
