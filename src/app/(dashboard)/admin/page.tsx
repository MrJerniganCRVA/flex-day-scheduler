import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminDashboard() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const [userCount, clubCount, flexDayCount, signupCount] = await Promise.all([
    prisma.user.count(),
    prisma.club.count(),
    prisma.flexDay.count(),
    prisma.signup.count(),
  ]);

  const recentFlexDays = await prisma.flexDay.findMany({
    orderBy: { date: "asc" },
    where: { date: { gte: new Date() } },
    take: 5,
    include: {
      _count: { select: { clubSessions: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Admin Dashboard
      </h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
        {[
          { label: "Users", value: userCount, href: "/admin/users" },
          { label: "Clubs", value: clubCount, href: "/admin/clubs" },
          { label: "Flex Days", value: flexDayCount, href: "/admin/flex-days" },
          { label: "Total Signups", value: signupCount, href: null },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-gray-200 px-5 py-4"
          >
            <div className="text-2xl font-bold text-indigo-600">{stat.value}</div>
            <div className="text-sm text-gray-500 mt-0.5">
              {stat.href ? (
                <Link href={stat.href} className="hover:text-indigo-600 hover:underline">
                  {stat.label}
                </Link>
              ) : (
                stat.label
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">Upcoming Flex Days</h2>
        <Link
          href="/admin/flex-days/new"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + New Flex Day
        </Link>
      </div>

      {recentFlexDays.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400">
          No upcoming Flex Days.{" "}
          <Link href="/admin/flex-days/new" className="text-indigo-600 hover:underline">
            Schedule one now
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
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentFlexDays.map((fd) => (
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
                  <td className="px-4 py-3 text-gray-600">{fd.label ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {fd._count.clubSessions}
                  </td>
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
      )}
    </div>
  );
}
