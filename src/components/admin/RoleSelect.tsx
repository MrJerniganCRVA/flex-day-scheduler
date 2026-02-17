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

  async function handleChange(newRole: Role) {
    if (newRole === role) return;
    setRole(newRole);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    startTransition(() => router.refresh());
  }

  if (isSelf) {
    return (
      <span className="text-xs text-gray-400 italic">You</span>
    );
  }

  return (
    <select
      value={role}
      onChange={(e) => handleChange(e.target.value as Role)}
      disabled={isPending}
      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
    >
      {roles.map((r) => (
        <option key={r} value={r}>
          {r.charAt(0) + r.slice(1).toLowerCase()}
        </option>
      ))}
    </select>
  );
}
