import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";

export default async function AdminDashboard() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const nextFlexDay = await prisma.flexDay.findFirst({
    where: { date: { gte: today }, isActive: true },
    orderBy: { date: "asc" },
    include: {
      clubSessions: {
        include: {
          club: { select: { name: true, maxCapacity: true } },
          _count: { select: { signups: true } },
        },
      },
    },
  });

  const rotationStats = ALL_ROTATIONS.map((slot) => {
    const sessions = (nextFlexDay?.clubSessions ?? []).filter((cs) =>
      cs.rotations.includes(slot as RotationSlot)
    );
    const totalCapacity = sessions.reduce((s, cs) => s + cs.club.maxCapacity, 0);
    const totalSignups = sessions.reduce((s, cs) => s + cs._count.signups, 0);
    const pct = totalCapacity > 0 ? Math.round((totalSignups / totalCapacity) * 100) : 0;
    return { slot, clubCount: sessions.length, totalCapacity, totalSignups, pct };
  });

  const overallCapacity = rotationStats.reduce((s, r) => s + r.totalCapacity, 0);
  const overallSignups = rotationStats.reduce((s, r) => s + r.totalSignups, 0);
  const overallPct =
    overallCapacity > 0 ? Math.round((overallSignups / overallCapacity) * 100) : 0;

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
                {overallSignups}/{overallCapacity}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{overallPct}% filled overall</div>
            </div>
          </div>

          <div className="space-y-3">
            {rotationStats.map(({ slot, clubCount: clubs, totalCapacity, totalSignups, pct }) => (
              <div key={slot}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {ROTATION_LABELS[slot as RotationSlot]}
                    <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                      {clubs} club{clubs !== 1 ? "s" : ""}
                    </span>
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    {totalSignups}/{totalCapacity}
                    <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">{pct}%</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-indigo-100 dark:bg-indigo-900/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ))}
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
