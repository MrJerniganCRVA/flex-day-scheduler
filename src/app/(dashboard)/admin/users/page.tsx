import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import RoleSelect from "@/components/admin/RoleSelect";
import DeleteUserButton from "@/components/admin/DeleteUserButton";
import type { Role } from "@prisma/client";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      createdAt: true,
      _count: { select: { signups: true, clubsOwned: true } },
    },
    orderBy: { name: "asc" },
  });

  const roleBadgeClass: Record<Role, string> = {
    STUDENT: "bg-blue-100 text-blue-700",
    TEACHER: "bg-purple-100 text-purple-700",
    ADMIN: "bg-orange-100 text-orange-700",
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">User Management</h1>
      <p className="text-sm text-gray-500 mb-4">
        {users.length} users registered
      </p>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Role</th>
              <th className="px-4 py-3 text-left">Signups</th>
              <th className="px-4 py-3 text-left">Clubs Owned</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {user.name}
                </td>
                <td className="px-4 py-3 text-gray-500">{user.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass[user.role]}`}
                  >
                    {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {user._count.signups}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {user._count.clubsOwned}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <RoleSelect
                      userId={user.id}
                      currentRole={user.role}
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
