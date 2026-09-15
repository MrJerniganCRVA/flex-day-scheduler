"use client";

/**
 * Opens the browser's print dialog, which is also where "Save as PDF" lives.
 *
 * The whole reason the roster is a page rather than a generated file: one button
 * gives a teacher paper or a PDF, and the page cannot go stale against the data
 * the way a file downloaded last night can.
 */
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
    >
      Print / Save as PDF
    </button>
  );
}
