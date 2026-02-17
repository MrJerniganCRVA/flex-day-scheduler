import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminClubsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const clubs = await prisma.club.findMany({
    include: {
      owner: { select: { name: true, email: true } },
      _count: { select: { clubSessions: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">All Clubs</h1>
      <p className="text-sm text-gray-500 mb-4">{clubs.length} clubs total</p>

      {clubs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          No clubs have been created yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Club</th>
                <th className="px-4 py-3 text-left">Owner</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Capacity</th>
                <th className="px-4 py-3 text-left">Sessions</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clubs.map((club) => (
                <tr key={club.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{club.name}</div>
                    {club.description && (
                      <div className="text-xs text-gray-400 line-clamp-1">
                        {club.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {club.owner.name}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {club.location ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{club.maxCapacity}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {club._count.clubSessions}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/teacher/clubs/${club.id}`}
                      className="text-indigo-600 hover:underline text-xs font-medium"
                    >
                      Manage
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
