import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import DeleteFlexDayButton from "@/components/flex-days/DeleteFlexDayButton";

export default async function AdminFlexDaysPage({
  searchParams,
}: {
  searchParams: Promise<{ showPast?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const { showPast } = await searchParams;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const flexDays = await prisma.flexDay.findMany({
    where: showPast ? undefined : { date: { gte: today } },
    include: {
      _count: { select: { clubSessions: true } },
      clubSessions: {
        include: {
          club: { select: { maxCapacity: true } },
          _count: { select: { signups: true } },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  const flexDaysWithStats = flexDays.map((fd) => {
    const totalCapacity = fd.clubSessions.reduce(
      (sum, cs) => sum + (cs.club?.maxCapacity ?? cs.capacityOverride ?? 0),
      0
    );
    const totalSignups = fd.clubSessions.reduce(
      (sum, cs) => sum + cs._count.signups,
      0
    );
    const pct =
      totalCapacity > 0 ? Math.round((totalSignups / totalCapacity) * 100) : 0;
    return { ...fd, totalCapacity, totalSignups, pct };
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Flex Days</h1>
        <div className="flex items-center gap-3">
          <Link
            href={showPast ? "/admin/flex-days" : "/admin/flex-days?showPast=1"}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 dark:border-gray-600 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {showPast ? "Hide past" : "Show past"}
          </Link>
          <Link
            href="/admin/flex-days/new"
            className="rounded-lg border border-indigo-300 dark:border-indigo-700 px-3 py-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
          >
            + New Flex Day
          </Link>
        </div>
      </div>

      {flexDaysWithStats.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 font-medium mb-1">
            {showPast ? "No past Flex Days" : "No upcoming Flex Days"}
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
            {showPast
              ? "Past flex days will appear here once they've occurred."
              : "Creating a Flex Day will auto-schedule all clubs with their default rotations."}
          </p>
          {!showPast && (
            <Link
              href="/admin/flex-days/new"
              className="inline-flex rounded-lg border border-indigo-300 dark:border-indigo-700 px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
            >
              Create the first Flex Day
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Clubs</th>
                <th className="px-4 py-3 text-left">Signups</th>
                <th className="px-4 py-3 text-left">Filled</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {flexDaysWithStats.map((fd) => (
                <tr key={fd.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200 font-medium">
                    {new Date(fd.date).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{fd._count.clubSessions}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {fd.totalSignups}/{fd.totalCapacity}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            fd.pct >= 80
                              ? "bg-green-500"
                              : fd.pct >= 40
                                ? "bg-yellow-400"
                                : "bg-gray-300 dark:bg-gray-600"
                          }`}
                          style={{ width: `${fd.pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{fd.pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          fd.isActive
                            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {fd.isActive ? "Active" : "Inactive"}
                      </span>
                      {fd.isFinalized && (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                          Finalized
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/flex-days/${fd.id}`}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs font-medium"
                      >
                        View
                      </Link>
                      <DeleteFlexDayButton flexDayId={fd.id} />
                    </div>
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
