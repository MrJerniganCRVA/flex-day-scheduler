"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RotationSlot } from "@prisma/client";

/**
 * "I'm out" for the signed-in teacher — for one Flex, or the whole day when
 * `rotations` is omitted.
 *
 * Person-level: it empties every club slot and duty post they were expected at
 * in those blocks, and the admin Coverage page shows each as needing cover.
 * Undoing it puts them back everywhere, since nothing is reassigned.
 */
export default function OutToggle({
  flexDayId,
  rotations,
  out,
  variant = "button",
}: {
  flexDayId: string;
  rotations?: RotationSlot[];
  /** Whether they are already out for every block this control covers. */
  out: boolean;
  /** A bordered button for the day header; a small link for a column header. */
  variant?: "button" | "link";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    setSaving(true);
    setError(false);
    try {
      const res = await fetch(`/api/flex-days/${flexDayId}/absences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absent: !out, rotations }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || isPending;
  const wholeDay = rotations === undefined;
  const label = busy
    ? "Saving…"
    : out
      ? wholeDay
        ? "I'm back today"
        : "I'm back"
      : wholeDay
        ? "I'm out today"
        : "I'm out";

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={
        error
          ? "Could not save that. Please try again."
          : out
            ? "Undo — you'll be back on everything you were expected at"
            : "Your clubs and duty posts will show as needing cover"
      }
      className={
        variant === "button"
          ? `inline-flex shrink-0 items-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              error
                ? "border-red-300 dark:border-red-700 text-red-600 dark:text-red-400"
                : out
                  ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`
          : `text-xs font-medium hover:underline disabled:opacity-50 ${
              error
                ? "text-red-600 dark:text-red-400"
                : "text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            }`
      }
    >
      {label}
    </button>
  );
}
