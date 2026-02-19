import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import DeleteFlexDayButton from "@/components/flex-days/DeleteFlexDayButton";

export default async function AdminFlexDaysPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const flexDays = await prisma.flexDay.findMany({
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

  // Compute aggregate stats per flex day
  const flexDaysWithStats = flexDays.map((fd) => {
    const totalCapacity = fd.clubSessions.reduce(
      (sum, cs) => sum + cs.club.maxCapacity,
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
        <h1 className="text-2xl font-bold text-gray-900">Flex Days</h1>
        <Link
          href="/admin/flex-days/new"
          className="rounded-lg border border-indigo-300 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
        >
          + New Flex Day
        </Link>
      </div>

      {flexDaysWithStats.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          No Flex Days yet.{" "}
          <Link href="/admin/flex-days/new" className="text-indigo-600 hover:underline">
            Create the first one
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Label</th>
                <th className="px-4 py-3 text-left">Sessions</th>
                <th className="px-4 py-3 text-left">Signups</th>
                <th className="px-4 py-3 text-left">Filled</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {flexDaysWithStats.map((fd) => (
                <tr key={fd.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700 font-medium">
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
                  <td className="px-4 py-3 text-gray-600">
                    {fd.totalSignups}/{fd.totalCapacity}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            fd.pct >= 80
                              ? "bg-green-500"
                              : fd.pct >= 40
                                ? "bg-yellow-400"
                                : "bg-gray-300"
                          }`}
                          style={{ width: `${fd.pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{fd.pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        fd.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {fd.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/flex-days/${fd.id}`}
                        className="text-indigo-600 hover:underline text-xs font-medium"
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
