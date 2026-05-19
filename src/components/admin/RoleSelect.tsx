"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";

const roles: Role[] = ["STUDENT", "TEACHER", "ADMIN"];

export default function RoleSelect({
  userId,
  currentRole,
  isSelf,
}: {
  userId: string;
  currentRole: Role;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<Role>(currentRole);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(newRole: Role) {
    if (newRole === role) return;
    setLoading(true);
    setError(null);
    setRole(newRole);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        setRole(currentRole);
        setError("Failed to update role.");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  if (isSelf) {
    return (
      <span className="text-xs text-gray-400 dark:text-gray-500 italic">You</span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={role}
        onChange={(e) => handleChange(e.target.value as Role)}
        disabled={loading || isPending}
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r.charAt(0) + r.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
