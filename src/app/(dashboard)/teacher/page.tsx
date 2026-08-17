import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import SessionAttendanceForm from "@/components/sessions/SessionAttendanceForm";
import RotationClashNotice from "@/components/sessions/RotationClashNotice";
import { rotationsExpectingTeacher } from "@/lib/coverage";

export default async function TeacherDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const me = session.user.id;

  // Next upcoming flex day (includes today), filtered to sessions this teacher is
  // connected to.
  //
  // Coverage assignments are included here deliberately. Previously this filtered
  // on club ownership and cosponsorship only, so a teacher an admin had assigned
  // to cover someone else's club never saw that session anywhere in the app — and
  // for a club with no owner, coverage is the *only* way a teacher is attached to
  // it, which made those clubs invisible to the very people running them.
  const nextFlexDay = await prisma.flexDay.findFirst({
    where: { date: { gte: today }, isActive: true },
    orderBy: { date: "asc" },
    include: {
      clubSessions: {
        where: {
          OR: [
            { club: { ownerId: me } },
            { club: { cosponsorId: me } },
            { oneOffOwnerId: me },
            { rotationCoverage: { some: { primaryTeacherId: me } } },
            { rotationCoverage: { some: { secondaryTeacherId: me } } },
          ],
        },
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
          rotationCoverage: {
            select: {
              rotation: true,
              primaryTeacherId: true,
              secondaryTeacherId: true,
            },
          },
          teacherAbsences: { select: { teacherId: true, rotation: true } },
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

  type TeacherSession = NonNullable<typeof nextFlexDay>["clubSessions"][number];

  /**
   * Rotations of a session where this teacher is actually expected — resolved
   * coverage with their own absences already subtracted. A session they've stepped
   * back from still appears on the dashboard (so they can undo it) but no longer
   * counts toward a clash.
   */
  const expectedRotations = (cs: TeacherSession) =>
    rotationsExpectingTeacher(
      cs.club,
      cs.rotationCoverage,
      cs.rotations,
      cs.teacherAbsences,
      me
    );

  const iAmAbsentFrom = (cs: TeacherSession, slot: RotationSlot) =>
    cs.teacherAbsences.some((a) => a.teacherId === me && a.rotation === slot);

  // A teacher expected by two sessions in the same rotation cannot attend both.
  const clashes = new Map<RotationSlot, TeacherSession[]>();
  for (const slot of ALL_ROTATIONS as RotationSlot[]) {
    const expecting = (nextFlexDay?.clubSessions ?? []).filter((cs) =>
      expectedRotations(cs).includes(slot)
    );
    if (expecting.length > 1) clashes.set(slot, expecting);
  }

  const isToday = nextFlexDay
    ? nextFlexDay.date.getTime() === today.getTime()
    : false;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Teacher Dashboard
        </h1>
        <Link
          href="/teacher/clubs/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + New Club
        </Link>
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
                const sessions = nextFlexDay.clubSessions.filter((cs) =>
                  cs.rotations.includes(slot)
                );

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

                    {clashes.has(slot) && (
                      <div className="px-4 pt-3">
                        <RotationClashNotice
                          rotation={slot}
                          rotationLabel={ROTATION_LABELS[slot]}
                          options={clashes.get(slot)!.map((cs) => ({
                            sessionId: cs.id,
                            name: cs.club?.name ?? cs.title ?? "Session",
                            absent: iAmAbsentFrom(cs, slot),
                          }))}
                        />
                      </div>
                    )}

                    <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {sessions.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500 italic">
                          Not scheduled
                        </p>
                      ) : (
                        sessions.map((cs) => {
                          const absentHere = iAmAbsentFrom(cs, slot);
                          return (
                            <div
                              key={cs.id}
                              className={`px-4 py-4 ${absentHere ? "opacity-60" : ""}`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="font-medium text-gray-900 dark:text-white text-sm">
                                  {cs.club?.name ?? cs.title ?? "Session"}
                                  {absentHere && (
                                    <span className="ml-1.5 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                      Not attending
                                    </span>
                                  )}
                                </div>
                                <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                                  {cs._count.signups}/{cs.capacityOverride ?? cs.club?.maxCapacity ?? 0}
                                </span>
                              </div>

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
              const coveredRotations = new Set(
                nextFlexDay.clubSessions.flatMap((cs) => cs.rotations)
              );
              const fullyBooked = ALL_ROTATIONS.every((r) =>
                coveredRotations.has(r)
              );
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
    </div>
  );
}
