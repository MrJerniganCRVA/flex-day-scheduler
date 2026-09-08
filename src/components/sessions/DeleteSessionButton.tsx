"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Removes one session from its Flex Day.
 *
 * Targets `/api/club-sessions/[sessionId]` rather than the club-scoped
 * `/api/clubs/[clubId]/sessions/[sessionId]`: that endpoint resolves the club
 * from the session itself, so it handles a one-off session (`clubId = null`,
 * which belongs to no club and therefore has no club-scoped URL) through the
 * same path as an ordinary club session, and picks the right Google Calendar
 * for each. Without it a one-off could be created but never deleted.
 */
export default function DeleteSessionButton({
  sessionId,
  signupCount = 0,
  label = "Remove",
}: {
  sessionId: string;
  /**
   * Students currently signed up. Deleting cascades their Signup rows away
   * (schema.prisma: Signup.clubSession is onDelete: Cascade), so the count is
   * named before the click rather than discovered afterwards on the user list.
   */
  signupCount?: number;
  label?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/club-sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Silence here used to mean an admin clicked "Yes" and watched nothing
        // happen, with no way to tell a refused delete from a broken one.
        setError(data.error ?? "Failed to remove session.");
        return;
      }
      startTransition(() => router.refresh());
      setConfirming(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-red-600 dark:text-red-400">
          Remove session?
          {signupCount > 0 && (
            <>
              {" "}
              <span className="font-semibold">
                {signupCount} student{signupCount === 1 ? "" : "s"}
              </span>{" "}
              {signupCount === 1 ? "is" : "are"} signed up and will lose this
              placement.
            </>
          )}
        </span>
        <button
          onClick={handleDelete}
          disabled={deleting || isPending}
          className="rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/80 disabled:opacity-50"
        >
          {deleting || isPending ? "Removing…" : "Yes"}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          No
        </button>
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs text-red-500 dark:text-red-400 hover:underline"
    >
      {label}
    </button>
  );
}
