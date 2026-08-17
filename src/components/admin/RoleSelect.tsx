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
  // pendingRole holds a role change waiting for admin confirmation (ADMIN escalation only)
  const [pendingRole, setPendingRole] = useState<Role | null>(null);

  function handleChange(newRole: Role) {
    if (newRole === role) return;
    setError(null);
    if (newRole === "ADMIN") {
      // Require explicit confirmation before granting admin access
      setPendingRole("ADMIN");
      return;
    }
    void commitRole(newRole);
  }

  async function commitRole(newRole: Role) {
    setLoading(true);
    setError(null);
    setPendingRole(null);
    setRole(newRole);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        setRole(currentRole);
        // Surface the server's reason — the last-admin and self-demotion guards
        // return an explanation that's useless if replaced with "Failed".
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update role.");
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
        disabled={loading || isPending || pendingRole !== null}
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r.charAt(0) + r.slice(1).toLowerCase()}
          </option>
        ))}
      </select>

      {pendingRole === "ADMIN" && (
        <div className="flex items-center gap-2 text-xs rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2 py-1">
          <span className="text-amber-700 dark:text-amber-300">Grant full admin access?</span>
          <button
            onClick={() => commitRole("ADMIN")}
            className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Yes
          </button>
          <button
            onClick={() => setPendingRole(null)}
            className="text-gray-500 dark:text-gray-400 hover:underline"
          >
            No
          </button>
        </div>
      )}

      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
