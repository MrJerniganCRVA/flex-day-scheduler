import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import SessionAttendanceForm from "@/components/sessions/SessionAttendanceForm";
import VolunteerButton from "@/components/sessions/VolunteerButton";

export default async function TeacherDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const userId = session.user.id!;

  // Next upcoming flex day (includes today), filtered to sessions this teacher owns or covers
  const nextFlexDay = await prisma.flexDay.findFirst({
    where: { date: { gte: today }, isActive: true },
    orderBy: { date: "asc" },
    include: {
      clubSessions: {
        where: {
          OR: [
            { club: { ownerId: userId } },
            { oneOffOwnerId: userId },
            {
              rotationCoverage: {
                some: {
                  OR: [
                    { primaryTeacherId: userId },
                    { secondaryTeacherId: userId },
                  ],
                },
              },
            },
          ],
        },
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
          rotationCoverage: {
            where: {
              OR: [
                { primaryTeacherId: userId },
                { secondaryTeacherId: userId },
              ],
            },
            select: { rotation: true },
          },
          signups: {
            select: {
              id: true,
              attended: true,
              student: { select: { id: true, name: true } },
            },
            orderBy: { student: { name: "asc" } },
          },
          _count: { select: { signups: true } },
        },
      },
    },
  });

  const isToday = nextFlexDay
    ? nextFlexDay.date.getTime() === today.getTime()
    : false;

  // Fetch ALL sessions for the next flex day (to find open coverage spots)
  const allSessionsForNextDay = nextFlexDay
    ? await prisma.clubSession.findMany({
        where: { flexDayId: nextFlexDay.id },
        select: {
          id: true,
          rotations: true,
          title: true,
          teacherAbsent: true,   // scalar: must be listed explicitly in `select`
          club: { select: { name: true, ownerId: true } },
          roomOverride: { select: { name: true } },
          rotationCoverage: {
            select: {
              rotation: true,
              primaryTeacherId: true,
              secondaryTeacherId: true,
            },
          },
        },
      })
    : [];

  // Sessions with at least one rotation having an open primary or secondary slot,
  // where the teacher isn't already volunteered for that rotation
  type OpenSlot = { rotation: RotationSlot; needsPrimary: boolean };
  const openSessionsForCoverage: Array<{
    id: string;
    name: string;
    openSlots: OpenSlot[];
  }> = allSessionsForNextDay.flatMap((cs) => {
    // Exclude sessions this teacher already owns/covers (those show in main grid)
    const ownedOrCovered = nextFlexDay!.clubSessions.some((s) => s.id === cs.id);
    if (ownedOrCovered) return [];

    const openSlots: OpenSlot[] = [];
    for (const r of cs.rotations) {
      const cov = cs.rotationCoverage.find((rc) => rc.rotation === r);
      const alreadyVolunteered =
        cov?.primaryTeacherId === userId || cov?.secondaryTeacherId === userId;
      if (alreadyVolunteered) continue;
      const ownerIsAbsentPrimary =
        cs.teacherAbsent && cov?.primaryTeacherId === cs.club?.ownerId;
      if (!cov || cov.primaryTeacherId === null || ownerIsAbsentPrimary) {
        openSlots.push({ rotation: r, needsPrimary: true });
      } else if (cov.secondaryTeacherId === null) {
        openSlots.push({ rotation: r, needsPrimary: false });
      }
    }
    if (openSlots.length === 0) return [];
    return [{ id: cs.id, name: cs.club?.name ?? cs.title ?? "Activity", openSlots }];
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Teacher Dashboard
        </h1>
      </div>

      {/* ── Next / Today's Flex Day ──────────────────────────────────── */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-2">
          {isToday ? "Today's Flex Day" : "Next Flex Day"}
        </p>

        {nextFlexDay ? (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 p-5">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              {new Date(nextFlexDay.date).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
            </h2>
            {nextFlexDay.label && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {nextFlexDay.label}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-3 mt-3">
              {ALL_ROTATIONS.map((slot: RotationSlot) => {
                const sessions = nextFlexDay.clubSessions.filter((cs) => {
                  const owned = cs.club?.ownerId === userId || cs.oneOffOwnerId === userId;
                  if (owned) return cs.rotations.includes(slot);
                  return cs.rotationCoverage.some((rc) => rc.rotation === slot);
                });

                return (
                  <div
                    key={slot}
                    className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    <div
                      className={`px-4 py-2.5 font-semibold text-sm ${
                        sessions.length > 0
                          ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {ROTATION_LABELS[slot]}
                    </div>

                    <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {sessions.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500 italic">
                          Not scheduled
                        </p>
                      ) : (
                        sessions.map((cs) => {
                          const roomName = cs.roomOverride?.name ?? cs.club?.defaultRoom?.name ?? null;
                          const owned = cs.club?.ownerId === userId || cs.oneOffOwnerId === userId;
                          return (
                            <div key={cs.id} className="px-4 py-4">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                                    {cs.club?.name ?? cs.title ?? "Session"}
                                  </div>
                                  {!owned && (
                                    <span className="shrink-0 rounded-full bg-teal-100 dark:bg-teal-950/50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300">
                                      Covering
                                    </span>
                                  )}
                                  {owned && cs.teacherAbsent && (
                                    <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                                      Absent
                                    </span>
                                  )}
                                </div>
                                <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                                  {cs._count.signups}/{cs.capacityOverride ?? cs.club?.maxCapacity ?? 0}
                                </span>
                              </div>

                              {roomName && (
                                <div className="mb-2 text-xs">
                                  {isToday
                                    ? <span className="font-medium text-indigo-600 dark:text-indigo-400">📍 {roomName}</span>
                                    : <span className="text-gray-500 dark:text-gray-400">{roomName}</span>
                                  }
                                </div>
                              )}

                              {/* capacity bar */}
                              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mb-3">
                                <div
                                  className="h-full rounded-full bg-indigo-400 dark:bg-indigo-500 transition-all"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      Math.round(
                                        (cs._count.signups /
                                          (cs.capacityOverride ?? cs.club?.maxCapacity ?? 1)) *
                                          100
                                      )
                                    )}%`,
                                  }}
                                />
                              </div>

                              {owned && cs.teacherAbsent && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                                  You&apos;re marked absent — coverage is being arranged.
                                </p>
                              )}

                              {cs.signups.length > 0 ? (
                                isToday ? (
                                  <SessionAttendanceForm
                                    sessionId={cs.id}
                                    signups={cs.signups}
                                  />
                                ) : (
                                  <details>
                                    <summary className="cursor-pointer text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                                      Roster ({cs.signups.length})
                                    </summary>
                                    <ul className="mt-2 space-y-0.5">
                                      {cs.signups.map((s) => (
                                        <li
                                          key={s.id}
                                          className="text-xs text-gray-600 dark:text-gray-300"
                                        >
                                          {s.student.name}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                )
                              ) : (
                                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                                  No signups yet
                                </p>
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

            {(() => {
              const ownedSessions = nextFlexDay.clubSessions.filter(
                (cs) => cs.club?.ownerId === userId || cs.oneOffOwnerId === userId
              );
              if (ownedSessions.length === 0) return null;
              const coveredRotations = new Set(ownedSessions.flatMap((cs) => cs.rotations));
              const fullyBooked = ALL_ROTATIONS.every((r) => coveredRotations.has(r));
              return fullyBooked ? null : (
                <div className="mt-4 pt-3 border-t border-indigo-200 dark:border-indigo-800">
                  <Link
                    href={`/teacher/sessions/new`}
                    className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    + Schedule a session for this day →
                  </Link>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
            No upcoming Flex Days scheduled yet.
          </div>
        )}
      </section>

      {/* ── Sessions seeking coverage ─────────────────────────────── */}
      {openSessionsForCoverage.length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-400 mb-2">
            Sessions seeking coverage
          </p>
          <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 p-4 space-y-3">
            <p className="text-xs text-teal-700 dark:text-teal-400">
              These sessions have open coverage slots for the next flex day. Click to volunteer.
            </p>
            {openSessionsForCoverage.map((cs) => (
              <div
                key={cs.id}
                className="rounded-lg bg-white dark:bg-gray-900 border border-teal-200 dark:border-teal-800 px-4 py-3"
              >
                <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                  {cs.name}
                </p>
                <div className="flex flex-wrap gap-2">
                  {cs.openSlots.map((slot) => (
                    <VolunteerButton
                      key={`${cs.id}-${slot.rotation}`}
                      sessionId={cs.id}
                      rotation={slot.rotation}
                      label={`${ROTATION_LABELS[slot.rotation]} (${slot.needsPrimary ? "primary" : "secondary"})`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
