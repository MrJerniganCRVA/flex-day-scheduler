"use client";

import { useState } from "react";
import { ALL_ROTATIONS, ROTATION_LABELS, type RotationSlot } from "@/types";
import type {
  OverCapacitySession,
  StudentScheduleDay,
  StudentScheduleLookup,
} from "@/lib/student-schedule";

/**
 * Look a student up by email and rewrite their placement across every Flex Day
 * still ahead of them.
 *
 * The counterpart to RosterOverrideControls, which edits one signup from inside
 * a session's roster. This one starts from the student, shows their whole
 * timetable, and applies a batch — which is what "swap this student's afternoon
 * around" actually needs, and what doing it one signup at a time made tedious
 * and error-prone once invites had gone out.
 *
 * Types come from @/lib/student-schedule as `import type` only. No client
 * component in this app imports a value from @/lib — see the note in
 * ImportStudentsPanel — and this one does not need to: the diff below is a
 * comparison of two session names per rotation, and everything that needs real
 * planning (which ops, in what order, and whether a room ends up over capacity)
 * is the server's answer to give.
 */

/** The target session for each rotation of one day. null = nobody. */
type DayTarget = Record<RotationSlot, string | null>;

type ApplyResult = {
  applied: { action: string; from: string | null; to: string | null; date: string }[];
  calendarUpdates: number;
  droppedRequired: string[];
  forcedOverCapacity: OverCapacitySession[];
};

/** One line of the staged-changes list. */
type DiffLine = {
  dayKey: string;
  dateLabel: string;
  rotation: RotationSlot;
  from: string | null;
  to: string | null;
};

const CARD =
  "rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900";

function formatDate(iso: string): string {
  // The date arrives as a plain YYYY-MM-DD with no zone. Parsing it with
  // new Date() would read it as UTC midnight and render the day before in any
  // western timezone, so it is split by hand.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Which session the student currently holds in each rotation of a day. */
function currentTarget(day: StudentScheduleDay): DayTarget {
  const target: DayTarget = { FLEX_1: null, FLEX_2: null, FLEX_3: null };
  for (const signup of day.signups) {
    for (const rotation of signup.rotations) {
      target[rotation] = signup.clubSessionId;
    }
  }
  return target;
}

export default function StudentSignupEditor() {
  const [email, setEmail] = useState("");
  const [lookup, setLookup] = useState<StudentScheduleLookup | null>(null);
  const [targets, setTargets] = useState<Record<string, DayTarget>>({});
  const [reason, setReason] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [pendingForce, setPendingForce] = useState<OverCapacitySession[] | null>(
    null
  );

  function resetEdits(data: StudentScheduleLookup) {
    const next: Record<string, DayTarget> = {};
    for (const day of data.days) {
      if (day.editable) next[day.flexDayId] = currentTarget(day);
    }
    setTargets(next);
    setReason("");
    setPendingForce(null);
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.trim()) return;

    setSearching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/student-signups?email=${encodeURIComponent(email.trim())}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLookup(null);
        setError(data.error ?? "Could not look that student up.");
        return;
      }
      setLookup(data as StudentScheduleLookup);
      resetEdits(data as StudentScheduleLookup);
    } finally {
      setSearching(false);
    }
  }

  /**
   * Put `sessionId` in `rotation`, clearing whatever it displaces.
   *
   * A session covering several rotations claims all of them, and anything
   * already sitting in one of those is given up — including the rest of a
   * linked session it was part of. Doing that here rather than refusing the
   * choice keeps the server's contradiction check unreachable from the UI, and
   * every displacement shows up as its own line in the staged-changes list, so
   * nothing happens silently.
   */
  function choose(day: StudentScheduleDay, rotation: RotationSlot, sessionId: string | null) {
    setResult(null);
    setPendingForce(null);
    setTargets((prev) => {
      const target = { ...(prev[day.flexDayId] ?? currentTarget(day)) };

      const clear = (occupant: string | null) => {
        if (!occupant) return;
        for (const r of ALL_ROTATIONS) {
          if (target[r] === occupant) target[r] = null;
        }
      };

      clear(target[rotation]);

      if (sessionId) {
        const session = day.sessions.find((s) => s.id === sessionId);
        if (session) {
          for (const r of session.rotations) clear(target[r]);
          for (const r of session.rotations) target[r] = sessionId;
        }
      }

      return { ...prev, [day.flexDayId]: target };
    });
  }

  const nameOf = (day: StudentScheduleDay, sessionId: string | null) =>
    sessionId ? (day.sessions.find((s) => s.id === sessionId)?.sessionName ?? null) : null;

  // ── Staged changes, one line per rotation that ends up somewhere new ──────
  const diff: DiffLine[] = [];
  const changedDays: { flexDayId: string; slots: DayTarget }[] = [];
  if (lookup) {
    for (const day of lookup.days) {
      if (!day.editable) continue;
      const target = targets[day.flexDayId];
      if (!target) continue;
      const current = currentTarget(day);

      let dayChanged = false;
      for (const rotation of ALL_ROTATIONS) {
        if (current[rotation] === target[rotation]) continue;
        dayChanged = true;
        diff.push({
          dayKey: day.flexDayId,
          dateLabel: formatDate(day.date),
          rotation,
          from: nameOf(day, current[rotation]),
          to: nameOf(day, target[rotation]),
        });
      }
      if (dayChanged) changedDays.push({ flexDayId: day.flexDayId, slots: target });
    }
  }

  const canApply =
    changedDays.length > 0 && reason.trim().length >= 3 && !busy;

  async function apply(force: boolean) {
    if (!lookup) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/student-signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: lookup.student.id,
          reason: reason.trim(),
          days: changedDays,
          ...(force ? { force: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.needsForce) {
          setPendingForce(data.overCapacity ?? []);
          return;
        }
        setError(data.error ?? "Could not apply the change.");
        return;
      }

      setResult(data as ApplyResult);
      setPendingForce(null);
      // Re-read rather than patching local state: the fill counts on every
      // other session just moved, and they are what the next edit is judged
      // against.
      await search();
    } finally {
      setBusy(false);
    }
  }

  const editableDays = lookup?.days.filter((d) => d.editable) ?? [];
  const pastDays = lookup?.days.filter((d) => !d.editable && d.signups.length > 0) ?? [];

  return (
    <div className="space-y-5">
      <form onSubmit={search} className={`${CARD} p-5`}>
        <label
          htmlFor="student-email"
          className="block text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          Student email
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="student-email"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={searching}
            autoComplete="off"
            placeholder="jdoe27@students.school.org"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={searching || !email.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {searching ? "Looking up…" : "Look up"}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          The whole address, or just the bit before the @.
        </p>
      </form>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {result && <ResultBanner result={result} />}

      {lookup && (
        <>
          <div className={`${CARD} p-5`}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {lookup.student.name}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {lookup.student.email}
            </p>
          </div>

          {editableDays.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
              No upcoming Flex Days to edit.
            </div>
          ) : (
            editableDays.map((day) => (
              <DayCard
                key={day.flexDayId}
                day={day}
                target={targets[day.flexDayId] ?? currentTarget(day)}
                onChoose={choose}
                disabled={busy}
              />
            ))
          )}

          {pastDays.length > 0 && <PastDays days={pastDays} />}

          <div className={`${CARD} p-5`}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Staged changes
            </h3>

            {diff.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Nothing changed yet. Pick a different club above.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {diff.map((line) => (
                  <li
                    key={`${line.dayKey}-${line.rotation}`}
                    className="text-sm text-gray-700 dark:text-gray-200"
                  >
                    <span className="text-gray-500 dark:text-gray-400">
                      {line.dateLabel} · {ROTATION_LABELS[line.rotation]}
                    </span>{" "}
                    <span className="line-through text-gray-400 dark:text-gray-500">
                      {line.from ?? "nobody"}
                    </span>{" "}
                    → <span className="font-medium">{line.to ?? "nobody"}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <label
                htmlFor="override-reason"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                Reason
              </label>
              <input
                id="override-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy || diff.length === 0}
                maxLength={500}
                placeholder="Recorded against every change in this batch"
                className="mt-1.5 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
            </div>

            {pendingForce ? (
              <OverCapacityConfirm
                sessions={pendingForce}
                busy={busy}
                onConfirm={() => apply(true)}
                onCancel={() => setPendingForce(null)}
              />
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => apply(false)}
                  disabled={!canApply}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {busy ? "Applying…" : "Apply changes & update invites"}
                </button>
                {diff.length > 0 && reason.trim().length < 3 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    A reason is required — it goes in the audit log.
                  </span>
                )}
              </div>
            )}

            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Invites are updated for this student only. Sessions on a day whose
              invites have not been sent yet simply have no calendar event to
              change — the signup still moves.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function DayCard({
  day,
  target,
  onChoose,
  disabled,
}: {
  day: StudentScheduleDay;
  target: DayTarget;
  onChoose: (day: StudentScheduleDay, rotation: RotationSlot, sessionId: string | null) => void;
  disabled: boolean;
}) {
  const forcedSessionIds = new Set(
    day.signups.filter((s) => s.forced).map((s) => s.clubSessionId)
  );

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {formatDate(day.date)}
        </h3>
        {day.label && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {day.label}
          </span>
        )}
        <span
          className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            day.isFinalized
              ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
              : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
          }`}
        >
          {day.isFinalized ? "Invites sent" : "Not finalized"}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {ALL_ROTATIONS.map((rotation) => {
          const options = day.sessions.filter((s) => s.rotations.includes(rotation));
          const selectedId = target[rotation];
          const selected = day.sessions.find((s) => s.id === selectedId);
          const spans = selected && selected.rotations.length > 1;

          return (
            <div key={rotation} className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-sm font-medium text-gray-600 dark:text-gray-300">
                {ROTATION_LABELS[rotation]}
              </span>

              <select
                value={selectedId ?? ""}
                onChange={(e) => onChoose(day, rotation, e.target.value || null)}
                disabled={disabled || options.length === 0}
                aria-label={`${ROTATION_LABELS[rotation]} on ${formatDate(day.date)}`}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">
                  {options.length === 0 ? "— nothing runs this rotation —" : "— none —"}
                </option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sessionName} ({s.enrolledCount}/{s.capacity})
                    {s.rotations.length > 1
                      ? ` — ${s.rotations.map((r) => ROTATION_LABELS[r]).join(" + ")}`
                      : ""}
                  </option>
                ))}
              </select>

              {selectedId && forcedSessionIds.has(selectedId) && (
                <span
                  title="Required member of this club — removing this signup does not end the membership"
                  className="rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-1.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400"
                >
                  Required
                </span>
              )}
              {spans && (
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                  spans {selected!.rotations.map((r) => ROTATION_LABELS[r]).join(" + ")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverCapacityConfirm({
  sessions,
  busy,
  onConfirm,
  onCancel,
}: {
  sessions: OverCapacitySession[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
        This puts a room over its stated capacity.
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {sessions.map((s) => (
          <li
            key={s.clubSessionId}
            className="text-xs text-amber-700 dark:text-amber-300"
          >
            {s.sessionName} would hold {s.newCount}, capacity {s.capacity}.
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="rounded px-2.5 py-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? "Applying…" : "Add them anyway"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-xs text-gray-600 dark:text-gray-300 hover:underline disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ResultBanner({ result }: { result: ApplyResult }) {
  return (
    <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-800 dark:text-green-300">
      <p className="font-medium">
        {result.applied.length} change{result.applied.length === 1 ? "" : "s"}{" "}
        applied
        {result.calendarUpdates > 0
          ? `, ${result.calendarUpdates} calendar update${
              result.calendarUpdates === 1 ? "" : "s"
            } sent.`
          : ". No invites had been sent for these sessions, so no calendar updates were needed."}
      </p>
      {result.forcedOverCapacity.length > 0 && (
        <p className="mt-1 text-xs">
          Over capacity, as confirmed:{" "}
          {result.forcedOverCapacity
            .map((s) => `${s.sessionName} (${s.newCount}/${s.capacity})`)
            .join(", ")}
          .
        </p>
      )}
      {result.droppedRequired.length > 0 && (
        <p className="mt-1 text-xs">
          {result.droppedRequired.join(", ")} required this student. That
          membership still stands — they will be signed up again for the club&apos;s
          next session unless you remove them from its Required Members panel.
        </p>
      )}
    </div>
  );
}

function PastDays({ days }: { days: StudentScheduleDay[] }) {
  return (
    <details className={`${CARD} p-5`}>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">
        Past Flex Days ({days.length})
      </summary>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Read-only. These are attendance history.
      </p>
      <ul className="mt-3 space-y-1.5">
        {days.map((day) => (
          <li key={day.flexDayId} className="text-sm text-gray-600 dark:text-gray-300">
            <span className="text-gray-500 dark:text-gray-400">
              {formatDate(day.date)}
            </span>{" "}
            — {day.signups.map((s) => s.sessionName).join(", ") || "no signups"}
          </li>
        ))}
      </ul>
    </details>
  );
}
