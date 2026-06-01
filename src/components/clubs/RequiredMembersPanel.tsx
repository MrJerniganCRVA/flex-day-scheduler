"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Student {
  id: string;
  name: string;
  email: string;
}

interface Member {
  id: string;
  studentId: string;
  student: Student;
}

interface Props {
  clubId: string;
  initialMembers: Member[];
}

export default function RequiredMembersPanel({ clubId, initialMembers }: Props) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/students")
      .then((r) => r.json())
      .then((data: Student[]) => setAllStudents(data))
      .catch(() => {});
  }, []);

  const memberIds = new Set(members.map((m) => m.studentId));
  const availableStudents = allStudents.filter((s) => !memberIds.has(s.id));

  async function handleAdd() {
    if (!selectedStudentId) return;
    setAdding(true);
    setError(null);
    setSuccessMsg(null);

    const res = await fetch(`/api/clubs/${clubId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: selectedStudentId }),
    });

    setAdding(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to add member.");
      return;
    }

    const { member, signupsCreated } = await res.json();
    setMembers((prev) => [...prev, member].sort((a, b) => a.student.name.localeCompare(b.student.name)));
    setSelectedStudentId("");
    setSuccessMsg(
      signupsCreated > 0
        ? `Added ${member.student.name} and enrolled them in ${signupsCreated} upcoming session${signupsCreated === 1 ? "" : "s"}.`
        : `Added ${member.student.name} to the required roster.`
    );
    router.refresh();
  }

  async function handleRemove(studentId: string) {
    setRemoving(studentId);
    setError(null);
    setSuccessMsg(null);

    const res = await fetch(`/api/clubs/${clubId}/members/${studentId}`, {
      method: "DELETE",
    });

    setRemoving(null);

    if (!res.ok) {
      setError("Failed to remove member.");
      return;
    }

    setMembers((prev) => prev.filter((m) => m.studentId !== studentId));
    setSuccessMsg("Student removed from required roster. Existing signups are kept.");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-4">
        Required Members
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Students listed here are automatically enrolled in every session. They cannot cancel their own signup.
      </p>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mb-3 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2 text-xs text-green-700 dark:text-green-400">
          {successMsg}
        </div>
      )}

      {members.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic mb-4">No required members yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/50 mb-4">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{m.student.name}</span>
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{m.student.email}</span>
              </div>
              <button
                onClick={() => handleRemove(m.studentId)}
                disabled={removing === m.studentId}
                className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                {removing === m.studentId ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <select
          value={selectedStudentId}
          onChange={(e) => setSelectedStudentId(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:[color-scheme:dark]"
        >
          <option value="">Select a student…</option>
          {availableStudents.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.email})
            </option>
          ))}
        </select>
        <button
          onClick={handleAdd}
          disabled={!selectedStudentId || adding}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
