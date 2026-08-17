import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import DeleteClubButton from "@/components/clubs/DeleteClubButton";
import RetryCalendarButton from "@/components/clubs/RetryCalendarButton";

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

  // Clubs with no calendar can't send invites. They're indistinguishable from
  // healthy clubs everywhere else, so surface it here where it can be fixed.
  const missingCalendar = clubs.filter((c) => c.googleCalendarId === null);

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

      {missingCalendar.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {missingCalendar.length} club
            {missingCalendar.length === 1 ? " has" : "s have"} no Google Calendar
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            Sessions for {missingCalendar.length === 1 ? "this club" : "these clubs"}{" "}
            cannot send calendar invites — finalizing a Flex Day will skip{" "}
            {missingCalendar.length === 1 ? "it" : "them"}. Use “Retry calendar
            setup” below, then re-send invites for any affected Flex Day.
          </p>
        </div>
      )}

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
                    <Link
                      href={`/admin/clubs/${club.id}`}
                      className="font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {club.name}
                    </Link>
                    {club.description && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 line-clamp-1">
                        {club.description}
                      </div>
                    )}
                    {club.googleCalendarId === null && (
                      <div className="mt-1">
                        <RetryCalendarButton clubId={club.id} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{club.owner?.name ?? (
                      <span className="text-gray-400 dark:text-gray-500 italic">
                        No teacher
                      </span>
                    )}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {club.defaultRoom?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{club.maxCapacity}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{club._count.clubSessions}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
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
