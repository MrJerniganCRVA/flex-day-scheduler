import { auth } from "@/auth";
import TabNav from "@/components/admin/TabNav";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import FinalizeButton from "@/components/flex-days/FinalizeButton";
import AutoAssignTab from "@/components/admin/AutoAssignTab";
import RosterOverrideControls from "@/components/admin/RosterOverrideControls";
import DeleteSessionButton from "@/components/sessions/DeleteSessionButton";
import { schoolTimeZone } from "@/lib/flex-day-utils";
import { resolveRoomName } from "@/lib/session-event";
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
  const { tab: rawTab } = await searchParams;

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
              defaultRoom: { select: { name: true } },
            },
          },
          roomOverride: { select: { name: true } },
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

  // Validated rather than trusted: an unknown ?tab= used to render the header
  // and the tab strip over an empty page. Checked against `tabs` so that a
  // ?tab=changes link to a day with nothing logged also falls back.
  const tab =
    rawTab && tabs.some((t) => t.key === rawTab) ? rawTab : "sessions";

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
            {" · "}
            {/* The rosters below edit one signup at a time, from the session's
                side. Rearranging a whole student is the other screen's job, and
                it is not findable from here without saying so. */}
            <Link
              href="/admin/people?tab=signups"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Edit one student&apos;s signups
            </Link>
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

      <TabNav tabs={tabs} active={tab} className="mb-6" />

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
                              {/* A one-off belongs to no club, so it appears on
                                  no Club page — but students still see it and can
                                  sign up. Without this badge a one-off named after
                                  a club is indistinguishable from the real thing,
                                  and this page is the only place it can be found. */}
                              {cs.clubId === null && (
                                <span
                                  title={
                                    cs.oneOffOwner
                                      ? `One-off session created by ${cs.oneOffOwner.name}. It belongs to no club, so it does not appear on any Club page.`
                                      : "One-off session. It belongs to no club, so it does not appear on any Club page."
                                  }
                                  className="rounded-full bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700 px-2 py-0.5 text-xs font-medium"
                                >
                                  One-off
                                  {cs.oneOffOwner && ` · ${cs.oneOffOwner.name}`}
                                </span>
                              )}
                              {/* The room goes in the calendar invite's title,
                                  so a session without one ships "Art Club
                                  (Flex 1)" to everybody. Flagged here because
                                  this is the page Finalize is on — the last
                                  place it can be caught before invites go. */}
                              {resolveRoomName(cs) === null && (
                                <span
                                  title="No room set for this session, and its club has no default room. The calendar invite will name the rotation instead of a room."
                                  className="rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 px-2 py-0.5 text-xs font-medium"
                                >
                                  No room
                                </span>
                              )}
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
                              {/* Unconditional: a one-off has no club and so no
                                  club-scoped edit URL, which previously left it
                                  with no edit route at all. */}
                              <a
                                href={
                                  cs.club
                                    ? `/teacher/clubs/${cs.club.id}/sessions/${cs.id}/edit?return=/admin/flex-days/${flexDayId}`
                                    : `/teacher/sessions/${cs.id}/edit?return=/admin/flex-days/${flexDayId}`
                                }
                                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                Edit
                              </a>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {resolveRoomName(cs) && (
                                  <span className="mr-1">{resolveRoomName(cs)} ·</span>
                                )}
                                {cs._count.signups}/{cs.capacityOverride ?? cs.club?.maxCapacity ?? "?"}
                                {recorded > 0 && (
                                  <span className="ml-1 text-green-600 dark:text-green-400">
                                    · {present}/{cs._count.signups} present
                                  </span>
                                )}
                              </span>
                              {/* The only place a one-off can be removed: every
                                  other delete control lives on a Club page, which
                                  a club-less session never reaches. */}
                              <DeleteSessionButton sessionId={cs.id} />
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
