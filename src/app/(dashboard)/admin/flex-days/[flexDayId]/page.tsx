import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import FinalizeButton from "@/components/flex-days/FinalizeButton";
import AutoAssignTab from "@/components/admin/AutoAssignTab";
import AdminRoomSelector from "@/components/admin/AdminRoomSelector";

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
      teacherAbsences: { select: { userId: true, rotation: true, type: true } },
      clubSessions: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              maxCapacity: true,
              ownerId: true,
              defaultRoom: { select: { name: true } },
            },
          },
          roomOverride: { select: { name: true } },
          oneOffOwner: { select: { id: true, name: true } },
          signups: {
            select: {
              id: true,
              attended: true,
              student: { select: { id: true, name: true, email: true } },
            },
          },
          _count: { select: { signups: true } },
          rotationCoverage: { select: { rotation: true, primaryTeacherId: true } },
        },
      },
    },
  });

  if (!flexDay) notFound();

  const sessionsNeedingCoverage = flexDay.clubSessions.filter((cs) => {
    if (!cs.clubId) return false;
    const ownerId = cs.club?.ownerId;
    if (!ownerId) return false;
    return cs.rotations.some((r) => {
      const ownerIsAbsent = flexDay.teacherAbsences.some(
        (a) => a.userId === ownerId && a.rotation === r && a.type === "ABSENT"
      );
      if (!ownerIsAbsent) return false;
      const covered = cs.rotationCoverage.some(
        (rc) => rc.rotation === r && rc.primaryTeacherId !== null
      );
      return !covered;
    });
  }).length;

  const totalSignups = flexDay.clubSessions.reduce(
    (acc, cs) => acc + cs._count.signups,
    0
  );

  const tabs = [
    { key: "sessions", label: "Sessions" },
    { key: "auto-assign", label: "Auto-assign" },
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
        <FinalizeButton
          flexDayId={flexDay.id}
          isFinalized={flexDay.isFinalized}
          uncoveredCount={sessionsNeedingCoverage}
        />
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
                      return (
                        <div key={cs.id} className="px-5 py-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div>
                              <span className="font-medium text-gray-900 dark:text-white text-sm">
                                {cs.title ?? cs.club?.name ?? "Session"}
                              </span>
                              <AdminRoomSelector
                                sessionId={cs.id}
                                currentRoomName={cs.roomOverride?.name ?? cs.club?.defaultRoom?.name ?? null}
                                adminRoomLocked={cs.adminRoomLocked}
                              />
                              </div>
                              {(() => {
                                const ownerId = cs.club?.ownerId ?? cs.oneOffOwner?.id;
                                const absentRotations = cs.rotations.filter((r) =>
                                  flexDay.teacherAbsences.some(
                                    (a) => a.userId === ownerId && a.rotation === r
                                  )
                                );
                                if (absentRotations.length === 0) return null;
                                const allCovered = absentRotations.every((r) =>
                                  cs.rotationCoverage.some(
                                    (rc) => rc.rotation === r && rc.primaryTeacherId !== null
                                  )
                                );
                                return allCovered ? (
                                  <span className="rounded-full bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700 px-2 py-0.5 text-xs font-medium">
                                    Covered
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 px-2 py-0.5 text-xs font-medium">
                                    Coverage Needed
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="flex items-center gap-3">
                              {cs.club ? (
                                <Link
                                  href={`/teacher/clubs/${cs.club.id}/sessions/${cs.id}/edit?return=/admin/flex-days/${flexDayId}`}
                                  className="rounded border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                                >
                                  Edit
                                </Link>
                              ) : cs.oneOffOwner ? (
                                <Link
                                  href={`/teacher/sessions/${cs.id}/edit?return=/admin/flex-days/${flexDayId}`}
                                  className="rounded border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                                >
                                  Edit
                                </Link>
                              ) : null}
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
                                    className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"
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
    </div>
  );
}
