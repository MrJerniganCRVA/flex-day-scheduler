import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function TeacherClubsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const where =
    session.user.role === "ADMIN"
      ? undefined
      : {
          OR: [
            { ownerId: session.user.id },
            { cosponsorId: session.user.id },
          ],
        };

  const clubs = await prisma.club.findMany({
    where,
    include: {
      owner: { select: { name: true } },
      defaultRoom: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Clubs</h1>
        <Link
          href="/teacher/clubs/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + New Club
        </Link>
      </div>

      {clubs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 font-medium mb-1">No clubs yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
            Create a club and it will be automatically scheduled on all upcoming Flex Days.
          </p>
          <Link
            href="/teacher/clubs/new"
            className="inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Create your first club
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Club</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Capacity</th>
                <th className="px-4 py-3 text-left">Rotations</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {clubs.map((club) => (
                <tr key={club.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{club.name}</div>
                    {club.description && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1">
                        {club.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {club.defaultRoom?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{club.maxCapacity}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {club.defaultRotations.length === 0 ? (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                      ) : (
                        club.defaultRotations.map((r) => (
                          <span
                            key={r}
                            className="inline-block rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 text-xs font-medium"
                          >
                            {r === "FLEX_1" ? "Flex 1" : r === "FLEX_2" ? "Flex 2" : "Flex 3"}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/teacher/clubs/${club.id}`}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs font-medium"
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
