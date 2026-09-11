"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowProblem } from "@/lib/student-import";

/**
 * Upload a CSV of students, review what it will do, then commit.
 *
 * Sits directly above the students table on the admin Users page, under the
 * "Export students" download it pairs with — the two are one workflow: export
 * the roster, diff it against the school's master list, add whoever is missing
 * to the same file, upload it back.
 *
 * The preview step is not ceremony. This writes accounts for the whole student
 * body from a file an admin edited by hand, and "412 new, 1,380 already here, 3
 * rejected" is the difference between confidence and a guess. It follows the
 * same dry-run-then-confirm shape as AutoAssignTab for the same reason.
 */

/**
 * Why a row was skipped, in words an admin can act on.
 *
 * Kept here rather than beside the `RowProblem` union in src/lib/student-import.ts
 * so that no client component pulls a runtime value out of a lib module — the
 * type import above is erased at compile time, but a value import would drag
 * that module, and the environment read behind it, into the browser bundle.
 * Every other client component in this app keeps to the same line.
 */
const PROBLEM_LABELS: Record<RowProblem, string> = {
  "no-email": "No email address in this row",
  "invalid-email": "Not a valid email address",
  "wrong-domain": "Not a school address — this account could never sign in",
  "teacher-email": "Staff address — add teachers by letting them sign in",
  "duplicate-in-file": "This address appears earlier in the file",
};

interface NewStudent {
  email: string;
  name: string;
}

interface ExistingStudent {
  email: string;
  name: string;
  role: string;
}

interface RejectedRow {
  line: number;
  raw: string;
  reason: RowProblem;
}

interface ImportSummary {
  toCreate: NewStudent[];
  alreadyPresent: ExistingStudent[];
  rejected: RejectedRow[];
  counts: { toCreate: number; alreadyPresent: number; rejected: number };
  created: number;
  dryRun: boolean;
}

export default function ImportStudentsPanel() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCsv(null);
    setFilename(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function send(text: string, dryRun: boolean): Promise<ImportSummary> {
    const res = await fetch("/api/admin/students/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: text, dryRun }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error ?? "The import failed.");
    }
    return data as ImportSummary;
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const text = await file.text();
      setCsv(text);
      setFilename(file.name);
      setPreview(await send(text, true));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
      setCsv(null);
      setFilename(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      const data = await send(csv, false);
      setResult(data);
      setPreview(null);
      setCsv(null);
      if (fileInput.current) fileInput.current.value = "";
      // The students table on this page is server-rendered, so it only picks up
      // the new rows on a refresh.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        title="Add students from a CSV so they can be auto-assigned and receive calendar invites without having signed in"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 7.5 12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>
        Import students
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
            Import students from a CSV
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-prose">
            Add students who have never signed in. Download{" "}
            <strong className="font-medium">Export students</strong>, add the missing
            rows to the bottom of that file, and upload it back — the extra columns
            are ignored. Imported students are included in Auto-assign straight
            away, and receive their calendar invite when you finalize the Flex Day.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="shrink-0 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Close import panel"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="block w-full text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 dark:file:bg-indigo-950/50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 dark:file:text-indigo-300 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-900/50 file:cursor-pointer disabled:opacity-50"
        />
      </div>

      {busy && (
        <div className="text-sm text-gray-400 dark:text-gray-500">Working…</div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-4 py-3">
          <div className="font-medium text-sm text-green-800 dark:text-green-200">
            Imported {result.created} student{result.created !== 1 ? "s" : ""}
          </div>
          <div className="text-sm text-green-700 dark:text-green-300 mt-0.5">
            {result.counts.alreadyPresent} already in the app
            {result.counts.rejected > 0 &&
              `, ${result.counts.rejected} row${
                result.counts.rejected !== 1 ? "s" : ""
              } skipped`}
            . They are now included in Auto-assign — invites go out when you
            finalize the Flex Day.
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Tile
              label="New students"
              value={preview.counts.toCreate}
              tone={preview.counts.toCreate > 0 ? "green" : undefined}
            />
            <Tile label="Already in the app" value={preview.counts.alreadyPresent} />
            <Tile
              label="Rows skipped"
              value={preview.counts.rejected}
              tone={preview.counts.rejected > 0 ? "amber" : undefined}
            />
          </div>

          {preview.counts.toCreate > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Will be created
              </div>
              <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50">
                {preview.toCreate.map((s) => (
                  <li
                    key={s.email}
                    className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-gray-900 dark:text-white">
                      {s.name}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 truncate">
                      {s.email}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.rejected.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
              <div className="bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                Skipped rows
              </div>
              <ul className="max-h-48 overflow-y-auto divide-y divide-amber-100 dark:divide-amber-900/40">
                {preview.rejected.map((row) => (
                  <li key={row.line} className="px-3 py-2 text-sm">
                    <span className="text-gray-400 dark:text-gray-500 tabular-nums">
                      Line {row.line}
                    </span>
                    <span className="mx-2 text-gray-300 dark:text-gray-600">·</span>
                    <span className="text-amber-800 dark:text-amber-300">
                      {PROBLEM_LABELS[row.reason]}
                    </span>
                    {row.raw.trim() && (
                      <div className="mt-0.5 font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                        {row.raw}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleImport}
              disabled={busy || preview.counts.toCreate === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {preview.counts.toCreate === 0
                ? "Nothing to import"
                : `Import ${preview.counts.toCreate} student${
                    preview.counts.toCreate !== 1 ? "s" : ""
                  }`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              Choose a different file
            </button>
            {filename && (
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {filename}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"
      : tone === "amber"
        ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300"
        : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200";

  return (
    <div className={`rounded-lg px-3 py-2 ${toneClass}`}>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}
