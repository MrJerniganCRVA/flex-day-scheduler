"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  clubSessionId: string;
  signupId?: string;
  isMySignup: boolean;
  isForced?: boolean;
  isFull: boolean;
  isConflicted: boolean;
  conflictLabel?: string;
  isPastDeadline?: boolean;
  enrolledCount?: number;
  capacity?: number;
}

export default function SignupButton({
  clubSessionId,
  signupId,
  isMySignup,
  isForced = false,
  isFull,
  isConflicted,
  conflictLabel,
  isPastDeadline = false,
  enrolledCount,
  capacity,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignup() {
    setError(null);
    setLoading(true);
    const res = await fetch("/api/signups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clubSessionId }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to sign up. Please try again.");
      return;
    }
    setSignedUp(true);
    startTransition(() => router.refresh());
  }

  async function handleCancel() {
    if (!signupId) return;
    setError(null);
    const res = await fetch(`/api/signups/${signupId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to cancel. Please try again.");
      setConfirming(false);
      return;
    }
    startTransition(() => router.refresh());
  }

  // isMySignup always takes priority — show enrollment status regardless of deadline
  if (isMySignup) {
    // Required (forced) signups cannot be cancelled by the student
    if (isForced) {
      return (
        <div className="w-full rounded-md border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-400 text-center">
          Required
        </div>
      );
    }
    if (isPastDeadline) {
      return (
        <div className="space-y-1">
          <div className="w-full rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 text-center">
            Signed Up
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">Cancellations closed</p>
        </div>
      );
    }
    if (confirming) {
      return (
        <div className="space-y-1">
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">Cancel your signup?</p>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {isPending ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Keep
            </button>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <button
          onClick={() => setConfirming(true)}
          disabled={isPending}
          className="w-full rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/80 disabled:opacity-50 transition-colors"
        >
          Cancel Signup
        </button>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  if (isPastDeadline) {
    return (
      <button
        disabled
        className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 cursor-not-allowed"
      >
        Signups Closed
      </button>
    );
  }

  if (isConflicted) {
    return (
      <div className="space-y-1">
        <button
          disabled
          className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 cursor-not-allowed"
        >
          Rotation Conflict
        </button>
        {conflictLabel && (
          <p className="text-xs text-gray-400 dark:text-gray-500">{conflictLabel}</p>
        )}
      </div>
    );
  }

  if (isFull) {
    const countLabel =
      enrolledCount !== undefined && capacity !== undefined
        ? ` — ${enrolledCount}/${capacity}`
        : "";
    return (
      <button
        disabled
        className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 cursor-not-allowed"
      >
        Full{countLabel}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleSignup}
        disabled={loading || isPending}
        className={`w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-75 ${
          signedUp
            ? "bg-green-600 text-white cursor-default"
            : "bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white"
        }`}
      >
        {loading ? "Signing up…" : signedUp ? "Signed up! ✓" : "Sign Up"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
