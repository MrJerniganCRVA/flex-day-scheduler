"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  clubSessionId: string;
  signupId?: string;
  isMySignup: boolean;
  isFull: boolean;
  isConflicted: boolean;
}

export default function SignupButton({
  clubSessionId,
  signupId,
  isMySignup,
  isFull,
  isConflicted,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSignup() {
    setError(null);
    const res = await fetch("/api/signups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clubSessionId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to sign up. Please try again.");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleCancel() {
    if (!signupId) return;
    setError(null);
    const res = await fetch(`/api/signups/${signupId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to cancel. Please try again.");
      return;
    }
    startTransition(() => router.refresh());
  }

  if (isMySignup) {
    return (
      <div className="space-y-1">
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Cancelling…" : "Cancel Signup"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (isConflicted) {
    return (
      <button
        disabled
        className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400 cursor-not-allowed"
      >
        Rotation Conflict
      </button>
    );
  }

  if (isFull) {
    return (
      <button
        disabled
        className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400 cursor-not-allowed"
      >
        Full
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleSignup}
        disabled={isPending}
        className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Signing up…" : "Sign Up"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
