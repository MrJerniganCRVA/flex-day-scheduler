"use client";

import { useEffect } from "react";

/**
 * Catches a crash inside the dashboard rather than letting it take the tab.
 *
 * Without a boundary anywhere in the app, one throw in one effect unmounted the
 * whole tree and Next.js replaced the page with its bare fallback — "A client
 * side exception has occurred" over a blank screen. That is what students saw
 * for the signup countdown crash (src/lib/signup-countdown.ts), and it gave
 * neither them nor the logs anything to go on: no page, no message, and a
 * minified variable name in the console.
 *
 * Scoped to the (dashboard) segment so the nav and the session survive, and a
 * student can reach another page instead of assuming they have been signed out.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Next.js strips the message from a *server* error before it reaches the
    // browser, leaving only `digest` to match against the server log. A client
    // error keeps everything, which is the case this boundary was added for.
    console.error("Dashboard error boundary caught:", error, {
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
        Something went wrong on this page
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        You are still signed in. Try again, and if it keeps happening let an
        admin know{error.digest ? ` and give them this code: ${error.digest}` : ""}.
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
