import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import DeleteClubButton from "@/components/clubs/DeleteClubButton";

export default async function AdminClubsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const clubs = await prisma.club.findMany({
    include: {
      owner: { select: { name: true, email: true } },
      defaultRoom: { select: { name: true } },
      _count: { select: { clubSessions: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Clubs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{clubs.length} total</p>
        </div>
        <Link
          href="/admin/clubs/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + New Club
        </Link>
      </div>

      {clubs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-12 text-center text-gray-400 dark:text-gray-500">
          No clubs yet.{" "}
          <Link href="/admin/clubs/new" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Create the first one
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Club</th>
                <th className="px-4 py-3 text-left">Teacher</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Capacity</th>
                <th className="px-4 py-3 text-left">Sessions</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {clubs.map((club) => (
                <tr key={club.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{club.name}</div>
                    {club.description && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 line-clamp-1">
                        {club.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{club.owner.name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {club.defaultRoom?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{club.maxCapacity}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{club._count.clubSessions}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/clubs/${club.id}`}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs font-medium"
                      >
                        Manage
                      </Link>
                      <Link
                        href={`/admin/clubs/${club.id}/edit`}
                        className="text-gray-500 dark:text-gray-400 hover:underline text-xs font-medium"
                      >
                        Edit
                      </Link>
                      <DeleteClubButton
                        clubId={club.id}
                        redirectTo="/admin/clubs"
                      />
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
