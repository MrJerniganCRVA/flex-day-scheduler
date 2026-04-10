import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";

export default async function AdminFlexDayDetailPage({
  params,
}: {
  params: Promise<{ flexDayId: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    include: {
      clubSessions: {
        include: {
          club: {
            select: { id: true, name: true, maxCapacity: true },
          },
          signups: {
            include: {
              student: { select: { id: true, name: true, email: true } },
            },
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

  return (
    <div>
      <div className="mb-6">
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
                  sessions.map((cs) => (
                    <div key={cs.id} className="px-5 py-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-gray-900 dark:text-white text-sm">
                          {cs.club.name}
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {cs._count.signups}/{cs.club.maxCapacity}
                        </span>
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
                                className="text-xs text-gray-600 dark:text-gray-300"
                              >
                                {s.student.name}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
