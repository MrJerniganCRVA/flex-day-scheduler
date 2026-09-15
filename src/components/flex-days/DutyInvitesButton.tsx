"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Send this Flex Day's duty invites on their own, without going near its
 * students.
 *
 * Separate from Finalize because of what it is for: a day that already sent its
 * student invites still needs its hallway, cafeteria and front-door events, and
 * the obvious route to that — unfinalize, re-finalize — puts every session block
 * back through a path that can cancel and re-issue a student's invite whenever a
 * teacher's Google grant has lapsed since the first send. This button cannot
 * reach a session event at all.
 *
 * Shown whether or not the day is finalized, and safe to press repeatedly: each
 * assignment either patches the event it has or creates the one it is missing.
 */
export default function DutyInvitesButton({ flexDayId }: { flexDayId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [sent, setSent] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setError(null);
    setProblems([]);
    setSent(null);
    setSending(true);
    try {
      const res = await fetch(`/api/flex-days/${flexDayId}/duty-invites`, {
        method: "POST",
      });
      const data: {
        error?: string;
        sessionsSent?: number;
        problems?: string[];
      } = await res.json().catch(() => ({}));

      if (res.ok) {
        setSent(data.sessionsSent ?? 0);
        setProblems(data.problems ?? []);
        startTransition(() => router.refresh());
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
        setProblems(data.problems ?? []);
      }
    } finally {
      setSending(false);
    }
  }

  const busy = sending || isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSend}
        disabled={busy}
        title="Create or update the calendar event for every staffed duty post on this day. Students are never involved — this cannot change a session's invite."
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
      >
        {busy ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Sending…
          </>
        ) : (
          "Send Duty Invites"
        )}
      </button>

      {sent !== null && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {sent === 0
            ? "No staffed duty posts on this day."
            : `${sent} duty ${sent === 1 ? "block" : "blocks"} up to date.`}
        </p>
      )}

      {error && (
        <p className="max-w-sm text-xs text-red-600 dark:text-red-400 text-left">
          {error}
        </p>
      )}

      {problems.length > 0 && (
        <div className="max-w-sm rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-left">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            {problems.length}{" "}
            {problems.length === 1 ? "block needs" : "blocks need"} your attention
          </p>
          <ul className="mt-1 space-y-1">
            {problems.map((p, i) => (
              <li key={i} className="text-xs text-amber-700 dark:text-amber-300">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
