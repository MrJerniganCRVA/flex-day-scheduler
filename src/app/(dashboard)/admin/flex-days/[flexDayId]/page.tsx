import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import FinalizeButton from "@/components/flex-days/FinalizeButton";
import AutoAssignTab from "@/components/admin/AutoAssignTab";
import RosterOverrideControls from "@/components/admin/RosterOverrideControls";
import { schoolTimeZone } from "@/lib/flex-day-utils";
import {
  SESSION_ABSENCE_SELECT,
  SESSION_COVERAGE_SELECT,
  resolveSessionCoverage,
  sessionRef,
} from "@/lib/coverage";

export default async function AdminFlexDayDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ flexDayId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const { flexDayId } = await params;
  const { tab = "sessions" } = await searchParams;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    include: {
      clubSessions: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              maxCapacity: true,
              ownerId: true,
              cosponsorId: true,
            },
          },
          rotationCoverage: { select: SESSION_COVERAGE_SELECT },
          teacherAbsences: { select: SESSION_ABSENCE_SELECT },
          oneOffOwner: { select: { name: true } },
          signups: {
            select: {
              id: true,
              attended: true,
              forced: true,
              student: { select: { id: true, name: true, email: true } },
            },
            orderBy: { student: { name: "asc" } },
          },
          _count: { select: { signups: true } },
        },
      },
    },
  });

  if (!flexDay) notFound();

  const totalSignups = flexDay.clubSessions.reduce(
    (acc, cs) => acc + cs._count.signups,
    0
  );

  const sessionLabel = (cs: (typeof flexDay.clubSessions)[number]) =>
    cs.title ?? cs.club?.name ?? "Session";

  /**
   * Rotations of a session with nobody in the room. Derived rather than read from
   * a flag: the old per-session `teacherAbsent` boolean couldn't say which teacher
   * was out, and said nothing at all about a club with no owner. A rotation needs
   * coverage when no teacher resolves for it — whether because none was ever
   * assigned or because the one who would have defaulted in is marked absent.
   */
  const rotationsNeedingCoverage = (cs: (typeof flexDay.clubSessions)[number]) =>
    cs.rotations.filter(
      (rotation) =>
        resolveSessionCoverage(
          sessionRef(cs),
          cs.rotationCoverage,
          rotation,
          cs.teacherAbsences
        ).primaryTeacherId === null
    );

  // Candidate destinations for a roster move: any other session on this day,
  // labelled with its rotations so the admin can see what they're choosing.
  // Capacity and rotation conflicts are enforced server-side; listing a session
  // here doesn't promise the move will succeed.
  const moveTargets = flexDay.clubSessions.map((cs) => ({
    sessionId: cs.id,
    label: `${sessionLabel(cs)} — ${cs.rotations
      .map((r) => ROTATION_LABELS[r])
      .join(", ")} (${cs._count.signups}/${
      cs.capacityOverride ?? cs.club?.maxCapacity ?? "?"
    })`,
  }));

  // Roster overrides made after invites went out, newest first.
  //
  // Loaded regardless of isFinalized: this was previously gated on the day still
  // being finalized, so unfinalizing a day hid the record of who moved whom and
  // why — the one question the audit trail exists to answer, asked precisely when
  // someone is re-examining the day.
  const auditEntries = await prisma.signupAudit.findMany({
    where: { flexDayId: flexDay.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const tabs = [
    { key: "sessions", label: "Sessions" },
    { key: "auto-assign", label: "Auto-assign" },
    ...(auditEntries.length > 0
      ? [{ key: "changes", label: `Changes (${auditEntries.length})` }]
      : []),
  ];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {flexDay.label ??
              new Date(flexDay.date).toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
          </h1>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {flexDay.clubSessions.length} sessions · {totalSignups} total signups
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* The offline fallback: whatever happens to the app on the day, this
              file says which student is in which club for each rotation. */}
          <a
            href={`/api/admin/flex-days/${flexDay.id}/export`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            title="Download every signup for this Flex Day as a CSV — the backup if the app is unavailable"
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
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Export CSV
          </a>
          <FinalizeButton
            flexDayId={flexDay.id}
            isFinalized={flexDay.isFinalized}
          />
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            className={
              tab === t.key
                ? "px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 -mb-px"
                : "px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Sessions tab */}
      {tab === "sessions" && (
        <div className="grid gap-6 lg:grid-cols-3">
          {ALL_ROTATIONS.map((slot: RotationSlot) => {
            const sessions = flexDay.clubSessions.filter((cs) =>
              cs.rotations.includes(slot)
            );

            return (
              <div
                key={slot}
                className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                <div className="px-5 py-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold text-sm">
                  {ROTATION_LABELS[slot]}
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {sessions.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-gray-400 dark:text-gray-500 italic">
                      No clubs scheduled.
                    </p>
                  ) : (
                    sessions.map((cs) => {
                      const present = cs.signups.filter(
                        (s) => s.attended === true
                      ).length;
                      const recorded = cs.signups.filter(
                        (s) => s.attended !== null
                      ).length;
                      const uncovered = rotationsNeedingCoverage(cs);
                      return (
                        <div key={cs.id} className="px-5 py-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-white text-sm">
                                {cs.title ?? cs.club?.name ?? "Session"}
                              </span>
                              {uncovered.length > 0 && (
                                <span
                                  title={`No teacher for ${uncovered
                                    .map((r) => ROTATION_LABELS[r])
                                    .join(", ")}`}
                                  className="rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 px-2 py-0.5 text-xs font-medium"
                                >
                                  Coverage Needed
                                  {uncovered.length < cs.rotations.length &&
                                    ` (${uncovered
                                      .map((r) => ROTATION_LABELS[r])
                                      .join(", ")})`}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {cs.club && (
                                <a
                                  href={`/teacher/clubs/${cs.club.id}/sessions/${cs.id}/edit?return=/admin/flex-days/${flexDayId}`}
                                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                  Edit
                                </a>
                              )}
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {cs._count.signups}/{cs.capacityOverride ?? cs.club?.maxCapacity ?? "?"}
                                {recorded > 0 && (
                                  <span className="ml-1 text-green-600 dark:text-green-400">
                                    · {present}/{cs._count.signups} present
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                          {cs.signups.length > 0 && (
                            <details>
                              <summary className="cursor-pointer text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                                Roster ({cs.signups.length})
                              </summary>
                              <ul className="mt-2 space-y-1">
                                {cs.signups.map((s) => (
                                  <li
                                    key={s.id}
                                    className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"
                                  >
                                    <span
                                      className={
                                        s.attended === true
                                          ? "font-medium text-green-600 dark:text-green-400"
                                          : s.attended === false
                                            ? "font-medium text-red-500 dark:text-red-400"
                                            : "text-gray-400 dark:text-gray-500"
                                      }
                                    >
                                      {s.attended === true
                                        ? "P"
                                        : s.attended === false
                                          ? "A"
                                          : "–"}
                                    </span>
                                    {s.student.name}
                                    {/* An admin moving or removing this student
                                        should know the club requires them —
                                        the membership outlives the override and
                                        will re-enroll them on the next session
                                        the club is given. */}
                                    {s.forced && (
                                      <span
                                        title="Required member of this club — removing this signup does not end the membership"
                                        className="rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-1.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400"
                                      >
                                        Required
                                      </span>
                                    )}
                                    {/* Overrides are only offered once invites
                                        have gone out — before that, students
                                        manage their own signups. */}
                                    {flexDay.isFinalized && (
                                      <RosterOverrideControls
                                        signupId={s.id}
                                        studentName={s.student.name}
                                        currentSessionLabel={sessionLabel(cs)}
                                        otherSessions={moveTargets.filter(
                                          (t) => t.sessionId !== cs.id
                                        )}
                                      />
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Auto-assign tab */}
      {tab === "auto-assign" && <AutoAssignTab flexDayId={flexDayId} />}

      {/* Changes tab — roster overrides made after invites were sent. */}
      {tab === "changes" && (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Roster changes after invites
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Every override recorded for this Flex Day, newest first.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Student</th>
                <th className="px-4 py-2 text-left">Change</th>
                <th className="px-4 py-2 text-left">Reason</th>
                <th className="px-4 py-2 text-left">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {auditEntries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                    {entry.createdAt.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: schoolTimeZone(),
                    })}
                  </td>
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                    {entry.studentName}
                  </td>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                    {entry.action === "MOVE" ? (
                      <>
                        {entry.fromSessionName} <span aria-hidden>→</span>{" "}
                        {entry.toSessionName}
                      </>
                    ) : entry.action === "REMOVE" ? (
                      <>Removed from {entry.fromSessionName}</>
                    ) : (
                      <>Added to {entry.toSessionName}</>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                    {entry.reason}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                    {entry.actorEmail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
