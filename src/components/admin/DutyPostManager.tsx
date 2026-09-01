"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RotationSlot } from "@prisma/client";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";

interface DutyPost {
  id: string;
  name: string;
  location: string | null;
  requiredRotations: RotationSlot[];
  isActive: boolean;
  _count: { assignments: number };
}

const SHORT_LABELS: Record<RotationSlot, string> = {
  FLEX_1: "F1",
  FLEX_2: "F2",
  FLEX_3: "F3",
};

export default function DutyPostManager({
  initialDutyPosts,
}: {
  initialDutyPosts: DutyPost[];
}) {
  const router = useRouter();
  const [dutyPosts, setDutyPosts] = useState(initialDutyPosts);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // New-post form
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [rotations, setRotations] = useState<RotationSlot[]>([...ALL_ROTATIONS]);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/admin/duty-posts");
      if (res.ok) {
        setDutyPosts(await res.json());
        return;
      }
    } catch {
      // fall through
    }
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rotations.length === 0) {
      setError("Pick at least one rotation this post needs staffing for.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/duty-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          location: location.trim() || undefined,
          requiredRotations: rotations,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not create that duty post.");
        return;
      }
      setName("");
      setLocation("");
      setRotations([...ALL_ROTATIONS]);
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/duty-posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save that change.");
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(post: DutyPost) {
    // Deleting destroys the record of who covered this post on past Flex Days.
    // Deactivating is the normal retirement path, so say what is actually at
    // stake rather than asking a generic "are you sure".
    const warning =
      post._count.assignments > 0
        ? `Delete "${post.name}"? This also deletes ${post._count.assignments} staffing record${
            post._count.assignments === 1 ? "" : "s"
          }, including past Flex Days. Deactivating keeps that history instead.`
        : `Delete "${post.name}"?`;
    if (!confirm(warning)) return;

    setError(null);
    setBusyId(post.id);
    try {
      const res = await fetch(`/api/admin/duty-posts/${post.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not delete that duty post.");
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  function toggleRotation(r: RotationSlot) {
    setRotations((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  const visible = dutyPosts.filter((p) => showInactive || p.isActive);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── New duty post ─────────────────────────────────────────────── */}
      <form
        onSubmit={create}
        className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          Add a duty post
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[10rem]">
            <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="Cafeteria"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </label>
          <label className="flex-1 min-w-[10rem]">
            <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Location <span className="text-gray-400">(optional)</span>
            </span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={100}
              placeholder="2nd floor hallway"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </label>
          <fieldset>
            <legend className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Needs staffing in
            </legend>
            <div className="flex gap-1">
              {ALL_ROTATIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRotation(r)}
                  aria-pressed={rotations.includes(r)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    rotations.includes(r)
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
                      : "border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {SHORT_LABELS[r]}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {creating ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      {/* ── Existing posts ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Duty posts
          </h2>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-sm text-gray-400 dark:text-gray-500">
            No duty posts yet. Add the spots that need eyes on them — hallways,
            the cafeteria, the front doors.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <table className="w-full text-sm min-w-[38rem]">
              <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Post</th>
                  <th className="px-4 py-3 text-left">Needs staffing in</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {visible.map((post) => (
                  <tr key={post.id} className={post.isActive ? "" : "opacity-60"}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {post.name}
                      </div>
                      {post.location && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {post.location}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {ALL_ROTATIONS.map((r) => {
                          const required = post.requiredRotations.includes(r);
                          return (
                            <button
                              key={r}
                              disabled={busyId === post.id}
                              title={
                                required
                                  ? `Stop staffing ${post.name} in ${ROTATION_LABELS[r]}`
                                  : `Also staff ${post.name} in ${ROTATION_LABELS[r]}`
                              }
                              onClick={() => {
                                const next = required
                                  ? post.requiredRotations.filter((x) => x !== r)
                                  : [...post.requiredRotations, r];
                                if (next.length === 0) {
                                  setError(
                                    "A duty post has to need staffing in at least one rotation. Deactivate it instead."
                                  );
                                  return;
                                }
                                patch(post.id, { requiredRotations: next });
                              }}
                              className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                required
                                  ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
                                  : "border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600"
                              }`}
                            >
                              {SHORT_LABELS[r]}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          post.isActive
                            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {post.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        disabled={busyId === post.id}
                        onClick={() =>
                          patch(post.id, { isActive: !post.isActive })
                        }
                        className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                      >
                        {post.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                      <button
                        disabled={busyId === post.id}
                        onClick={() => remove(post)}
                        className="ml-3 text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
