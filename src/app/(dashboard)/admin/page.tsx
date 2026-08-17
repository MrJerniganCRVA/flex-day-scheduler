import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import { dayCoverage, rotationStats } from "@/lib/participation";

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass = {
    good: "text-green-700 dark:text-green-400",
    warn: "text-amber-700 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
    neutral: "text-gray-700 dark:text-gray-200",
  }[tone];

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
      <div className={`text-xl font-bold ${toneClass}`}>{value}</div>
      <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
        {label}
      </div>
      <div className="text-[11px] text-gray-400 dark:text-gray-500">{hint}</div>
    </div>
  );
}

export default async function AdminDashboard() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [nextFlexDay, totalStudents] = await Promise.all([
    prisma.flexDay.findFirst({
      where: { date: { gte: today }, isActive: true },
      orderBy: { date: "asc" },
      include: {
        clubSessions: {
          include: {
            club: { select: { name: true, maxCapacity: true } },
            signups: { select: { studentId: true } },
            _count: { select: { signups: true } },
          },
        },
      },
    }),
    prisma.user.count({ where: { role: "STUDENT" } }),
  ]);

  const sessions = nextFlexDay?.clubSessions ?? [];

  // Placement is measured in students, not signups, and never by summing the
  // per-rotation buckets — see the note in src/lib/participation.ts for why both
  // of those produced numbers several times larger than the student body.
  const perRotation = rotationStats(sessions);
  const coverage = dayCoverage(sessions, totalStudents);
  const overallPct =
    totalStudents > 0
      ? Math.round((coverage.studentsWithAnySignup / totalStudents) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
        <Link
          href="/admin/flex-days/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + New Flex Day
        </Link>
      </div>

      {nextFlexDay ? (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-1">
                Next Flex Day
              </p>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {new Date(nextFlexDay.date).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </h2>
              {nextFlexDay.label && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{nextFlexDay.label}</p>
              )}
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                {coverage.studentsWithAnySignup}/{totalStudents}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                students signed up ({overallPct}%)
              </div>
            </div>
          </div>

          {/* What an admin actually needs before the day: who still has nowhere
              to be. Same definition auto-assign uses to decide who to place. */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <StatTile
              label="Fully placed"
              value={coverage.fullyPlaced}
              hint="in all 3 rotations"
              tone="good"
            />
            <StatTile
              label="Partly placed"
              value={coverage.partiallyPlaced}
              hint="missing a rotation"
              tone={coverage.partiallyPlaced > 0 ? "warn" : "neutral"}
            />
            <StatTile
              label="Not signed up"
              value={coverage.unplaced}
              hint="no signups at all"
              tone={coverage.unplaced > 0 ? "bad" : "neutral"}
            />
          </div>

          {coverage.needingSlots > 0 && (
            <div className="mb-4 text-xs text-gray-600 dark:text-gray-300">
              <span className="font-semibold">{coverage.needingSlots}</span>{" "}
              student{coverage.needingSlots === 1 ? "" : "s"} still need a
              placement.{" "}
              <Link
                href={`/admin/flex-days/${nextFlexDay.id}?tab=auto-assign`}
                className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Run auto-assign →
              </Link>
            </div>
          )}

          <div className="space-y-3">
            {perRotation.map(({ slot, sessionCount, studentsPlaced, capacity }) => {
              // Placement bar is against the student body, not capacity: the
              // question is how many students have somewhere to be.
              const placedPct =
                totalStudents > 0
                  ? Math.round((studentsPlaced / totalStudents) * 100)
                  : 0;
              return (
                <div key={slot}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {ROTATION_LABELS[slot as RotationSlot]}
                      <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                        {sessionCount} session{sessionCount !== 1 ? "s" : ""} ·{" "}
                        {capacity} seat{capacity !== 1 ? "s" : ""}
                      </span>
                    </span>
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {studentsPlaced}/{totalStudents}
                      <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                        {placedPct}%
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-indigo-100 dark:bg-indigo-900/40 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400 transition-all"
                      style={{ width: `${Math.min(100, placedPct)}%` }}
                    />
                  </div>
                  {capacity < totalStudents && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Only {capacity} seat{capacity === 1 ? "" : "s"} for{" "}
                      {totalStudents} students — not everyone can be placed in
                      this rotation.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-indigo-200 dark:border-indigo-800">
            <Link
              href={`/admin/flex-days/${nextFlexDay.id}`}
              className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              View full details →
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
          No upcoming Flex Days scheduled.{" "}
          <Link href="/admin/flex-days/new" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Add one
          </Link>
        </div>
      )}
    </div>
  );
}
