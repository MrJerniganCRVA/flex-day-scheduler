import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";

export default async function TeacherDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Next upcoming flex day, filtered to only this teacher's sessions
  const nextFlexDay = await prisma.flexDay.findFirst({
    where: { date: { gte: today }, isActive: true },
    orderBy: { date: "asc" },
    include: {
      clubSessions: {
        where: { club: { ownerId: session.user.id } },
        include: {
          club: {
            select: { id: true, name: true, maxCapacity: true, location: true },
          },
          signups: {
            include: { student: { select: { id: true, name: true } } },
          },
          _count: { select: { signups: true } },
        },
      },
    },
  });

  // My clubs for the section below
  const clubs = await prisma.club.findMany({
    where: { ownerId: session.user.id },
    select: {
      id: true,
      name: true,
      description: true,
      maxCapacity: true,
      _count: { select: { clubSessions: true } },
    },
    orderBy: { name: "asc" },
  });

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

      {/* ── Next Flex Day ─────────────────────────────────────────── */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-2">
          Next Flex Day
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

                    <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {sessions.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500 italic">
                          Not scheduled
                        </p>
                      ) : (
                        sessions.map((cs) => {
                          const room =
                            ("locationOverride" in cs &&
                              (cs as { locationOverride?: string | null })
                                .locationOverride) ||
                            cs.club.location ||
                            null;

                          return (
                            <div key={cs.id} className="px-4 py-4">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="font-medium text-gray-900 dark:text-white text-sm">
                                  {cs.club.name}
                                </div>
                                <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                                  {cs._count.signups}/{cs.club.maxCapacity}
                                </span>
                              </div>

                              {room && (
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                  {room}
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
                                          cs.club.maxCapacity) *
                                          100
                                      )
                                    )}%`,
                                  }}
                                />
                              </div>

                              {cs.signups.length > 0 ? (
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

            <div className="mt-4 pt-3 border-t border-indigo-200 dark:border-indigo-800">
              <Link
                href={`/teacher/sessions/new`}
                className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                + Schedule a session for this day →
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
            No upcoming Flex Days scheduled yet.
          </div>
        )}
      </section>

      {/* ── My Clubs ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-700 dark:text-gray-200">
            My Clubs
          </h2>
          <Link
            href="/teacher/clubs"
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            View all →
          </Link>
        </div>

        {clubs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-gray-400 dark:text-gray-500 text-sm">
            No clubs yet.{" "}
            <Link
              href="/teacher/clubs/new"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Create your first club
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clubs.map((club) => (
              <Link
                key={club.id}
                href={`/teacher/clubs/${club.id}`}
                className="block rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all"
              >
                <div className="font-semibold text-gray-900 dark:text-white mb-1 text-sm">
                  {club.name}
                </div>
                {club.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-1">
                    {club.description}
                  </p>
                )}
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  Cap {club.maxCapacity} · {club._count.clubSessions} session
                  {club._count.clubSessions !== 1 ? "s" : ""}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
