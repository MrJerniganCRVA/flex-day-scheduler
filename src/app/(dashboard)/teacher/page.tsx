import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import SessionAttendanceForm from "@/components/sessions/SessionAttendanceForm";
import VolunteerButton from "@/components/sessions/VolunteerButton";
import StopCoveringButton from "@/components/sessions/StopCoveringButton";
import TeacherAbsenceSelector from "@/components/teacher/TeacherAbsenceSelector";
import DutyStationVolunteerButton from "@/components/duty-stations/DutyStationVolunteerButton";
import DutyStationUnvolunteerButton from "@/components/duty-stations/DutyStationUnvolunteerButton";

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
      teacherAbsences: { select: { userId: true, rotation: true, type: true } },
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
            select: {
              rotation: true,
              primaryTeacherId: true,
              secondaryTeacherId: true,
              primaryTeacher: { select: { name: true } },
            },
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

  // Duty station assignments for this teacher on the next flex day
  const myDutyAssignments = nextFlexDay
    ? await prisma.dutyStationAssignment.findMany({
        where: { flexDayId: nextFlexDay.id, teacherId: userId },
        include: { dutyStation: { select: { id: true, name: true } } },
      })
    : [];

  // All duty stations and assignments for the next flex day (to find open slots)
  const [allDutyStations, allDutyAssignmentsForDay] = nextFlexDay
    ? await Promise.all([
        prisma.dutyStation.findMany({ where: { maxTeachers: { gt: 0 } }, orderBy: { name: "asc" } }),
        prisma.dutyStationAssignment.findMany({ where: { flexDayId: nextFlexDay.id } }),
      ])
    : [[], []];

  // Fetch ALL sessions for the next flex day (to find open coverage spots)
  const allSessionsForNextDay = nextFlexDay
    ? await prisma.clubSession.findMany({
        where: { flexDayId: nextFlexDay.id },
        select: {
          id: true,
          rotations: true,
          title: true,
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
        nextFlexDay!.teacherAbsences.some((a) => a.userId === cs.club?.ownerId && a.rotation === r) &&
        cov?.primaryTeacherId === cs.club?.ownerId;
      if (!cov || cov.primaryTeacherId === null || ownerIsAbsentPrimary) {
        openSlots.push({ rotation: r, needsPrimary: true });
      } else if (cov.secondaryTeacherId === null) {
        openSlots.push({ rotation: r, needsPrimary: false });
      }
    }
    if (openSlots.length === 0) return [];
    return [{ id: cs.id, name: cs.club?.name ?? cs.title ?? "Activity", openSlots }];
  });

  // Open duty station slots this teacher can volunteer for
  type OpenDutySlot = { stationId: string; stationName: string; rotation: RotationSlot };
  const openDutySlots: OpenDutySlot[] = nextFlexDay
    ? allDutyStations.flatMap((ds) =>
        ALL_ROTATIONS.flatMap((r) => {
          const alreadyAssigned = myDutyAssignments.some(
            (a) => a.dutyStationId === ds.id && a.rotation === r
          );
          if (alreadyAssigned) return [];
          const countForSlot = allDutyAssignmentsForDay.filter(
            (a) => a.dutyStationId === ds.id && a.rotation === r
          ).length;
          if (countForSlot >= ds.maxTeachers) return [];
          // Check teacher isn't absent for this rotation
          const isAbsent = nextFlexDay.teacherAbsences.some(
            (a) => a.userId === userId && a.rotation === r && a.type === "ABSENT"
          );
          if (isAbsent) return [];
          return [{ stationId: ds.id, stationName: ds.name, rotation: r }];
        })
      )
    : [];

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
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                {nextFlexDay.label}
              </p>
            )}

            {isToday && (
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-700 px-4 py-3 mb-3 text-sm text-green-800 dark:text-green-200">
                <span className="font-semibold">Today is a Flex Day.</span>
                {" "}Go to your room, take attendance in the session below, and save when done.
              </div>
            )}

            {session.user.role !== "STUDENT" && (
              <TeacherAbsenceSelector
                flexDayId={nextFlexDay.id}
                initialAbsences={nextFlexDay.teacherAbsences.filter((a) => a.userId === userId)}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-3 mt-3">
              {ALL_ROTATIONS.map((slot: RotationSlot) => {
                const sessions = nextFlexDay.clubSessions.filter((cs) => {
                  const owned = cs.club?.ownerId === userId || cs.oneOffOwnerId === userId;
                  if (owned) return cs.rotations.includes(slot);
                  return cs.rotationCoverage.some(
                    (rc) =>
                      rc.rotation === slot &&
                      (rc.primaryTeacherId === userId || rc.secondaryTeacherId === userId)
                  );
                });
                const dutyForSlot = myDutyAssignments.filter((a) => a.rotation === slot);
                const hasContent = sessions.length > 0 || dutyForSlot.length > 0;

                return (
                  <div
                    key={slot}
                    className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    <div
                      className={`px-4 py-2.5 font-semibold text-sm ${
                        hasContent
                          ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {ROTATION_LABELS[slot]}
                    </div>

                    <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {dutyForSlot.map((da) => (
                        <div key={da.id} className="px-4 py-4 border-l-4 border-l-amber-400 dark:border-l-amber-500">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                              {da.dutyStation.name}
                            </div>
                            <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                              Floor duty
                            </span>
                          </div>
                          {da.adminLocked ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Assigned by admin</p>
                          ) : (
                            <div className="mt-2">
                              <DutyStationUnvolunteerButton
                                stationId={da.dutyStationId}
                                flexDayId={nextFlexDay.id}
                                rotation={slot}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {sessions.length === 0 && dutyForSlot.length === 0 ? (
                        <div className="px-4 py-4 space-y-1">
                          <p className="text-sm text-gray-400 dark:text-gray-500 italic">No activity this rotation.</p>
                          <Link
                            href={`/teacher/sessions/new?flexDayId=${nextFlexDay.id}`}
                            className="text-xs text-indigo-500 dark:text-indigo-400 hover:underline"
                          >
                            Schedule something →
                          </Link>
                        </div>
                      ) : sessions.length === 0 ? null : (
                        sessions.map((cs) => {
                          const roomName = cs.roomOverride?.name ?? cs.club?.defaultRoom?.name ?? null;
                          const owned = cs.club?.ownerId === userId || cs.oneOffOwnerId === userId;
                          const coverageForSlot = cs.rotationCoverage.find((rc) => rc.rotation === slot);
                          const coveredByOther =
                            owned &&
                            coverageForSlot?.primaryTeacherId != null &&
                            coverageForSlot.primaryTeacherId !== userId;
                          const ownerIdForSession = cs.club?.ownerId ?? cs.oneOffOwnerId;
                          const isAbsent = nextFlexDay.teacherAbsences.some(
                            (a) => a.userId === ownerIdForSession && a.rotation === slot && a.type === "ABSENT"
                          );
                          const isReassigned = nextFlexDay.teacherAbsences.some(
                            (a) => a.userId === ownerIdForSession && a.rotation === slot && a.type === "REASSIGNED"
                          );
                          return (
                            <div key={cs.id} className="px-4 py-4">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                                    {cs.club?.name ?? cs.title ?? "Session"}
                                  </div>
                                  {!owned && (
                                    <>
                                      <span className="shrink-0 rounded-full bg-teal-100 dark:bg-teal-950/50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300">
                                        Covering
                                      </span>
                                      <StopCoveringButton sessionId={cs.id} rotation={slot} />
                                    </>
                                  )}
                                  {owned && coveredByOther && (
                                    <span className="shrink-0 rounded-full bg-green-100 dark:bg-green-950/50 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                                      Covered
                                    </span>
                                  )}
                                  {owned && !coveredByOther && isAbsent && (
                                    <span className="shrink-0 rounded-full bg-red-100 dark:bg-red-950/50 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                                      Absent — needs coverage
                                    </span>
                                  )}
                                  {owned && !coveredByOther && isReassigned && cs.clubId && (
                                    <span className="shrink-0 rounded-full bg-teal-100 dark:bg-teal-950/50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300">
                                      Running other activity
                                    </span>
                                  )}
                                </div>
                                {!(owned && (isAbsent || isReassigned || coveredByOther) && cs.clubId) && (
                                  <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                                    {cs._count.signups}/{cs.capacityOverride ?? cs.club?.maxCapacity ?? 0}
                                  </span>
                                )}
                              </div>

                              {owned && (isAbsent || isReassigned || coveredByOther) && cs.clubId ? (
                                <p className="text-xs mt-1">
                                  {coveredByOther ? (
                                    <span className="text-green-600 dark:text-green-400">
                                      Covered by {coverageForSlot!.primaryTeacher?.name ?? "another teacher"} — you&apos;re all set.
                                    </span>
                                  ) : isAbsent ? (
                                    <span className="text-red-500 dark:text-red-400">
                                      No coverage assigned yet — contact an admin.
                                    </span>
                                  ) : (
                                    <span className="text-teal-600 dark:text-teal-400">
                                      Your club needs coverage for this rotation.
                                    </span>
                                  )}
                                </p>
                              ) : (
                                <>
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
                                </>
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
              const committedRotations = new Set<RotationSlot>();
              for (const cs of nextFlexDay.clubSessions) {
                const owned = cs.club?.ownerId === userId || cs.oneOffOwnerId === userId;
                if (owned) {
                  for (const r of cs.rotations) {
                    const cov = cs.rotationCoverage.find((rc) => rc.rotation === r);
                    const isCoveredByOther =
                      cov?.primaryTeacherId != null && cov.primaryTeacherId !== userId;
                    if (!isCoveredByOther) committedRotations.add(r);
                  }
                } else {
                  cs.rotationCoverage
                    .filter(
                      (rc) =>
                        rc.primaryTeacherId === userId || rc.secondaryTeacherId === userId
                    )
                    .forEach((rc) => committedRotations.add(rc.rotation));
                }
              }
              const fullyBooked = ALL_ROTATIONS.every((r) => committedRotations.has(r));
              return fullyBooked ? null : (
                <div className="mt-4 pt-3 border-t border-indigo-200 dark:border-indigo-800">
                  <Link
                    href={`/teacher/sessions/new?flexDayId=${nextFlexDay.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                  >
                    + Schedule an Activity
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
      {(openSessionsForCoverage.length > 0 || openDutySlots.length > 0) && (() => {
        const coverageByRotation = Object.fromEntries(
          ALL_ROTATIONS.map((r) => [
            r,
            openSessionsForCoverage.flatMap((cs) =>
              cs.openSlots
                .filter((slot) => slot.rotation === r)
                .map((slot) => ({ id: cs.id, name: cs.name, needsPrimary: slot.needsPrimary }))
            ),
          ])
        ) as Record<RotationSlot, Array<{ id: string; name: string; needsPrimary: boolean }>>;

        const dutyByRotation = Object.fromEntries(
          ALL_ROTATIONS.map((r) => [r, openDutySlots.filter((s) => s.rotation === r)])
        ) as Record<RotationSlot, OpenDutySlot[]>;

        return (
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-400 mb-1">
              Sessions seeking coverage
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              These sessions need a substitute teacher. Volunteer for any rotation you are free during. Note: If you don&apos;t volunteer for a club, one may be assigned to you.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {ALL_ROTATIONS.map((slot) => (
                <div
                  key={slot}
                  className="rounded-xl bg-white dark:bg-gray-900 border border-teal-200 dark:border-teal-800 overflow-hidden"
                >
                  <div className="px-4 py-2.5 font-semibold text-sm bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300">
                    {ROTATION_LABELS[slot]}
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                    {coverageByRotation[slot].length === 0 && dutyByRotation[slot].length === 0 ? (
                      <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500 italic">
                        No coverage needed
                      </p>
                    ) : (
                      <>
                        {coverageByRotation[slot].map((cs) => (
                          <div key={cs.id} className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                              {cs.name}
                            </p>
                            <VolunteerButton
                              sessionId={cs.id}
                              rotation={slot}
                              label={cs.needsPrimary ? "primary" : "secondary"}
                            />
                          </div>
                        ))}
                        {dutyByRotation[slot].map((ds) => (
                          <div key={ds.stationId} className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                              {ds.stationName}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Floor duty</p>
                            <DutyStationVolunteerButton
                              stationId={ds.stationId}
                              flexDayId={nextFlexDay!.id}
                              rotation={slot}
                            />
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
    </div>
  );
}
