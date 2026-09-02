"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface RequiredMemberRow {
  id: string;
  studentId: string;
  student: { id: string; name: string; email: string };
}

export interface StudentOption {
  id: string;
  name: string;
  email: string;
}

/** The report `enrollRequiredMembers` returns, as it crosses the network. */
interface EnrollmentReport {
  toCreate: unknown[];
  toPromote: unknown[];
  toDisplace: { sessionName: string }[];
  overCapacity: { sessionName: string; capacity: number; newCount: number }[];
  skipped: { sessionName: string; flexDayDate: string; reason: string }[];
  alreadyEnrolled: number;
}

/**
 * A club's required-member roster.
 *
 * The panel reports back rather than just succeeding, because adding a required
 * member is not a quiet operation: it can put a session over capacity and it can
 * cancel a signup some student chose for themselves. A teacher who is not told
 * that has no way to find out.
 */
export default function RequiredMembersPanel({
  clubId,
  initialMembers,
  students,
}: {
  clubId: string;
  initialMembers: RequiredMemberRow[];
  students: StudentOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [members, setMembers] = useState(initialMembers);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ name: string; r: EnrollmentReport } | null>(
    null
  );

  const memberIds = useMemo(
    () => new Set(members.map((m) => m.studentId)),
    [members]
  );

  // Filtering happens here rather than through a search endpoint: the whole
  // student list is already on the page, and a school's roster is small enough
  // that a round trip per keystroke would be slower than the filter.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    return students
      .filter((s) => !memberIds.has(s.id))
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, students, memberIds]);

  async function add(student: StudentOption) {
    setBusy(student.id);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(`/api/clubs/${clubId}/required-members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not add that student.");
        return;
      }
      setMembers((prev) =>
        [...prev, data.member].sort((a, b) =>
          a.student.name.localeCompare(b.student.name)
        )
      );
      setQuery("");
      if (data.enrollment) setReport({ name: student.name, r: data.enrollment });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: RequiredMemberRow) {
    setBusy(row.studentId);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(
        `/api/clubs/${clubId}/required-members/${row.studentId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not remove that student.");
        return;
      }
      setMembers((prev) => prev.filter((m) => m.studentId !== row.studentId));
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Required Members
      </h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Students who must attend this club — officers, Yearbook staff. They are
        signed up automatically for every upcoming session and cannot cancel
        themselves. Flex Days that are already finalized are left alone; use the
        admin roster override for those.
      </p>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {report && <EnrollmentSummary name={report.name} report={report.r} />}

      {members.length === 0 ? (
        <p className="mt-4 text-sm italic text-gray-400 dark:text-gray-500">
          No required members. Everyone signs themselves up.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-700/50">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {m.student.name}
                </span>
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                  {m.student.email}
                </span>
              </div>
              <button
                onClick={() => remove(m)}
                disabled={busy === m.studentId || isPending}
                className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                {busy === m.studentId ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative mt-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isPending}
          placeholder="Add a student by name or email…"
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
            {matches.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => add(s)}
                  disabled={busy !== null}
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-50"
                >
                  <span className="text-sm text-gray-900 dark:text-white">
                    {busy === s.id ? "Adding…" : s.name}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {s.email}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length > 0 && matches.length === 0 && (
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            No matching student who isn&apos;t already required here.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * What adding one student actually did. Kept deliberately specific — "added"
 * alone would hide a cancelled signup or an over-full room.
 */
function EnrollmentSummary({
  name,
  report,
}: {
  name: string;
  report: EnrollmentReport;
}) {
  const enrolled = report.toCreate.length + report.toPromote.length;

  return (
    <div className="mt-3 space-y-1.5 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2 text-xs text-green-800 dark:text-green-300">
      <p className="font-medium">
        {name} added
        {enrolled > 0
          ? ` and signed up for ${enrolled} upcoming session${enrolled === 1 ? "" : "s"}.`
          : "."}
      </p>

      {report.toDisplace.length > 0 && (
        <p className="text-amber-800 dark:text-amber-300">
          Cancelled their existing signup for{" "}
          {report.toDisplace.map((d) => d.sessionName).join(", ")} — that ran at the
          same time.
        </p>
      )}

      {report.overCapacity.map((o) => (
        <p key={o.sessionName} className="text-amber-800 dark:text-amber-300">
          {o.sessionName} is now over capacity ({o.newCount} of {o.capacity}).
        </p>
      ))}

      {report.skipped.filter((s) => s.reason === "flex-day-finalized").length > 0 && (
        <p className="text-amber-800 dark:text-amber-300">
          Not added to{" "}
          {report.skipped.filter((s) => s.reason === "flex-day-finalized").length}{" "}
          already-finalized Flex Day(s) — invites for those have gone out. An admin
          can add them with a roster override.
        </p>
      )}
    </div>
  );
}
