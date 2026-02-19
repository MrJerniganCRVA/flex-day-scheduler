import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function TeacherDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const clubs = await prisma.club.findMany({
    where: { ownerId: session.user.id },
    include: {
      _count: { select: { clubSessions: true } },
      clubSessions: {
        include: {
          flexDay: { select: { date: true } },
          _count: { select: { signups: true } },
        },
        orderBy: { flexDay: { date: "asc" } },
        take: 3,
      },
    },
    orderBy: { name: "asc" },
  });

  const totalSignups = clubs.reduce(
    (acc, club) =>
      acc + club.clubSessions.reduce((a, s) => a + s._count.signups, 0),
    0
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Teacher Dashboard</h1>
        <Link
          href="/teacher/clubs/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + New Club
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "My Clubs", value: clubs.length },
          {
            label: "Total Sessions",
            value: clubs.reduce((a, c) => a + c._count.clubSessions, 0),
          },
          { label: "Total Signups", value: totalSignups },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4"
          >
            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stat.value}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">My Clubs</h2>
      {clubs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
          No clubs yet.{" "}
          <Link href="/teacher/clubs/new" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Create your first club
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <Link
              key={club.id}
              href={`/teacher/clubs/${club.id}`}
              className="block rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all"
            >
              <div className="font-semibold text-gray-900 dark:text-white mb-1">{club.name}</div>
              {club.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
                  {club.description}
                </p>
              )}
              <div className="text-xs text-gray-400 dark:text-gray-500">
                Capacity: {club.maxCapacity} · {club._count.clubSessions} session
                {club._count.clubSessions !== 1 ? "s" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
