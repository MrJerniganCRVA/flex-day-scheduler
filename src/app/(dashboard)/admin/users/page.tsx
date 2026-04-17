import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import RoleSelect from "@/components/admin/RoleSelect";
import DeleteUserButton from "@/components/admin/DeleteUserButton";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const { tab: rawTab } = await searchParams;
  const tab =
    rawTab === "teachers" || rawTab === "admins" ? rawTab : "students";

  // ── Data fetching per tab ─────────────────────────────────────────────────

  let students: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
    signups?: { id: string }[];
  }[] = [];
  let teachers: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
    clubsOwned: { id: string; name: string }[];
  }[] = [];
  let admins: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  }[] = [];
  let nextFlexDay: { id: string; date: Date } | null = null;

  if (tab === "students") {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    nextFlexDay = await prisma.flexDay.findFirst({
      where: { date: { gte: today }, isActive: true },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    });

    const raw = await prisma.user.findMany({
      where: { role: "STUDENT" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        ...(nextFlexDay
          ? {
              signups: {
                where: { clubSession: { flexDayId: nextFlexDay.id } },
                select: { id: true },
                take: 1,
              },
            }
          : {}),
      },
      orderBy: { name: "asc" },
    });

    students = [
      ...raw.filter((s) => !s.signups?.length),
      ...raw.filter((s) => s.signups?.length),
    ];
  } else if (tab === "teachers") {
    teachers = await prisma.user.findMany({
      where: { role: "TEACHER" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clubsOwned: {
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });
  } else {
    admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    });
  }

  // ── Tab navigation ────────────────────────────────────────────────────────

  const tabs = ["students", "teachers", "admins"] as const;

  const flexDayLabel = nextFlexDay
    ? new Date(nextFlexDay.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        User Management
      </h1>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`?tab=${t}`}
            className={
              tab === t
                ? "px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 -mb-px"
                : "px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              {tab === "students" && nextFlexDay && (
                <th className="px-4 py-3 text-left">{flexDayLabel}</th>
              )}
              {tab === "teachers" && (
                <th className="px-4 py-3 text-left">Club(s)</th>
              )}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {tab === "students" &&
              students.map((user) => (
                <tr
                  key={user.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {user.name}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {user.email}
                  </td>
                  {nextFlexDay && (
                    <td className="px-4 py-3">
                      {user.signups?.length ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                          Signed up
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                          Not signed up
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <RoleSelect
                        userId={user.id}
                        currentRole={user.role as "STUDENT" | "TEACHER" | "ADMIN"}
                        isSelf={user.id === session.user.id}
                      />
                      {user.id !== session.user.id && (
                        <DeleteUserButton userId={user.id} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}

            {tab === "teachers" &&
              teachers.map((user) => (
                <tr
                  key={user.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {user.name}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {user.clubsOwned.length === 0 ? (
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                    ) : (
                      user.clubsOwned.map((club, i) => (
                        <span key={club.id}>
                          {i > 0 && (
                            <span className="text-gray-300 dark:text-gray-600">
                              ,{" "}
                            </span>
                          )}
                          <Link
                            href={`/admin/clubs/${club.id}`}
                            className="hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline"
                          >
                            {club.name}
                          </Link>
                        </span>
                      ))
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <RoleSelect
                        userId={user.id}
                        currentRole={user.role as "STUDENT" | "TEACHER" | "ADMIN"}
                        isSelf={user.id === session.user.id}
                      />
                      {user.id !== session.user.id && (
                        <DeleteUserButton userId={user.id} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}

            {tab === "admins" &&
              admins.map((user) => (
                <tr
                  key={user.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {user.name}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <RoleSelect
                        userId={user.id}
                        currentRole={user.role as "STUDENT" | "TEACHER" | "ADMIN"}
                        isSelf={user.id === session.user.id}
                      />
                      {user.id !== session.user.id && (
                        <DeleteUserButton userId={user.id} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
