"use client";

import { useState } from "react";
import Link from "next/link";
import RoleSelect from "@/components/admin/RoleSelect";
import DeleteUserButton from "@/components/admin/DeleteUserButton";

interface Teacher {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  clubsOwned: { id: string; name: string }[];
}

interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
}

interface Props {
  users: (Teacher | AdminUser)[];
  tab: "teachers" | "admins";
  currentUserId: string;
}

export default function UserSearchTable({ users, tab, currentUserId }: Props) {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery
    ? users.filter((u) => {
        const q = searchQuery.toLowerCase();
        return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
      })
    : users;

  return (
    <>
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full max-w-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Email</th>
            {tab === "teachers" && <th className="px-4 py-3 text-left">Club(s)</th>}
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {filtered.length === 0 ? (
            <tr>
              <td
                colSpan={tab === "teachers" ? 4 : 3}
                className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500"
              >
                {searchQuery ? "No results match your search." : "No users found."}
              </td>
            </tr>
          ) : (
            filtered.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                  {user.name}
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{user.email}</td>
                {tab === "teachers" && "clubsOwned" in user && (
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {user.clubsOwned.length === 0 ? (
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                    ) : (
                      user.clubsOwned.map((club, i) => (
                        <span key={club.id}>
                          {i > 0 && (
                            <span className="text-gray-300 dark:text-gray-600">, </span>
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
                )}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <RoleSelect
                      userId={user.id}
                      currentRole={user.role as "STUDENT" | "TEACHER" | "ADMIN"}
                      isSelf={user.id === currentUserId}
                    />
                    {user.id !== currentUserId && <DeleteUserButton userId={user.id} />}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
