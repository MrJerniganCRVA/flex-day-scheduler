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

  // Next upcoming flex day with full session + signup data
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

  // Per-rotation breakdown for the next flex day
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

  // Quick summary stats
  const [studentCount, clubCount] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.club.count(),
  ]);

  // Remaining upcoming flex days (after next)
  const upcomingFlexDays = await prisma.flexDay.findMany({
    where: {
      isActive: true,
      date: { gte: today },
      ...(nextFlexDay ? { id: { not: nextFlexDay.id } } : {}),
    },
    orderBy: { date: "asc" },
    take: 6,
    include: { _count: { select: { clubSessions: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>

      {/* ── Next Flex Day spotlight ─────────────────────────────── */}
      {nextFlexDay ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500 mb-1">
                Next Flex Day
              </p>
              <h2 className="text-xl font-bold text-gray-900">
                {new Date(nextFlexDay.date).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </h2>
              {nextFlexDay.label && (
                <p className="text-sm text-gray-500 mt-0.5">{nextFlexDay.label}</p>
              )}
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-indigo-600">
                {overallSignups}/{overallCapacity}
              </div>
              <div className="text-xs text-gray-500">{overallPct}% filled overall</div>
            </div>
          </div>

          <div className="space-y-3">
            {rotationStats.map(({ slot, clubCount: clubs, totalCapacity, totalSignups, pct }) => (
              <div key={slot}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">
                    {ROTATION_LABELS[slot as RotationSlot]}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {clubs} club{clubs !== 1 ? "s" : ""}
                    </span>
                  </span>
                  <span className="text-sm text-gray-600">
                    {totalSignups}/{totalCapacity}
                    <span className="ml-1.5 text-xs text-gray-400">{pct}%</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-indigo-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-indigo-200">
            <Link
              href={`/admin/flex-days/${nextFlexDay.id}`}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              View full details →
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400">
          No upcoming Flex Days scheduled.{" "}
          <Link href="/admin/flex-days/new" className="text-indigo-600 hover:underline">
            Add one
          </Link>
        </div>
      )}

      {/* ── Quick stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Students", value: studentCount, href: "/admin/users" },
          { label: "Clubs", value: clubCount, href: "/admin/clubs" },
          { label: "Flex Days", value: upcomingFlexDays.length + (nextFlexDay ? 1 : 0), href: "/admin/flex-days" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <div className="text-2xl font-bold text-gray-800">{stat.value}</div>
            <div className="text-sm text-gray-500 mt-0.5">
              <Link href={stat.href} className="hover:text-indigo-600 hover:underline">
                {stat.label}
              </Link>
            </div>
          </div>
        ))}
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-center">
          <Link
            href="/admin/flex-days/new"
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            + New Flex Day
          </Link>
        </div>
      </div>

      {/* ── Remaining upcoming flex days ────────────────────────── */}
      {upcomingFlexDays.length > 0 && (
        <>
          <h2 className="text-base font-semibold text-gray-700">Also Coming Up</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Label</th>
                  <th className="px-4 py-3 text-left">Club Sessions</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {upcomingFlexDays.map((fd) => (
                  <tr key={fd.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">
                      {new Date(fd.date).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fd.label ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{fd._count.clubSessions}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/flex-days/${fd.id}`}
                        className="text-indigo-600 hover:underline text-xs font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
