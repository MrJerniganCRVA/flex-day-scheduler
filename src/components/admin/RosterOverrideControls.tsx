"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type OverrideTarget = {
  sessionId: string;
  /** Display name, plus its rotations so the admin can see what they're picking. */
  label: string;
};

/**
 * Per-student Move / Remove controls on an admin roster.
 *
 * Only rendered once a Flex Day is finalized — before that, students manage
 * their own signups and an admin has no reason to reach in. Styled as an
 * override rather than an ordinary action, because it is one: it bypasses the
 * signup deadline, and the affected student gets a calendar update immediately.
 */
export default function RosterOverrideControls({
  signupId,
  studentName,
  currentSessionLabel,
  otherSessions,
}: {
  signupId: string;
  studentName: string;
  currentSessionLabel: string;
  otherSessions: OverrideTarget[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "move" | "remove">("idle");
  const [toSessionId, setToSessionId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("idle");
    setToSessionId("");
    setReason("");
    setError(null);
  }

  async function submit() {
    setError(null);

    // Mirrors the server's requirement rather than trusting it to be reached —
    // the reason is the whole point of the audit row.
    if (reason.trim().length < 3) {
      setError("Please enter a reason — it's recorded in the audit log.");
      return;
    }
    if (mode === "move" && !toSessionId) {
      setError("Choose the session to move this student into.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "move"
            ? {
                action: "move",
                signupId,
                toClubSessionId: toSessionId,
                reason: reason.trim(),
              }
            : { action: "remove", signupId, reason: reason.trim() }
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not apply the change.");
        return;
      }
      reset();
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  if (mode === "idle") {
    return (
      <span className="ml-auto inline-flex items-center gap-2">
        {otherSessions.length > 0 && (
          <button
            onClick={() => setMode("move")}
            className="text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:underline"
          >
            Move
          </button>
        )}
        <button
          onClick={() => setMode("remove")}
          className="text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline"
        >
          Remove
        </button>
      </span>
    );
  }

  return (
    <div className="mt-1 w-full rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-2.5">
      <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
        {mode === "move" ? "Move" : "Remove"} {studentName}
        {mode === "move" && (
          <span className="font-normal"> out of {currentSessionLabel}</span>
        )}
      </p>
      <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
        Invites have already been sent.{" "}
        {mode === "move"
          ? "This student will be removed from the old event and invited to the new one."
          : "This student's calendar invite will be withdrawn."}{" "}
        Other students are not affected.
      </p>

      {mode === "move" && (
        <select
          value={toSessionId}
          onChange={(e) => setToSessionId(e.target.value)}
          disabled={busy || isPending}
          className="mt-2 w-full rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-100 disabled:opacity-50"
        >
          <option value="">Move to…</option>
          {otherSessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.label}
            </option>
          ))}
        </select>
      )}

      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy || isPending}
        maxLength={500}
        placeholder="Reason (recorded in the audit log)"
        className="mt-2 w-full rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-100 disabled:opacity-50"
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || isPending}
          className={`rounded px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50 ${
            mode === "move"
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {busy || isPending
            ? "Applying…"
            : mode === "move"
              ? "Confirm move"
              : "Confirm removal"}
        </button>
        <button
          onClick={reset}
          disabled={busy || isPending}
          className="text-[11px] text-gray-600 dark:text-gray-300 hover:underline disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
