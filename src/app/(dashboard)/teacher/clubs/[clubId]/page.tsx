import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import DeleteClubButton from "@/components/clubs/DeleteClubButton";
import DeleteSessionButton from "@/components/sessions/DeleteSessionButton";

export default async function ClubDetailPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { clubId } = await params;

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    include: {
      owner: { select: { id: true, name: true } },
      clubSessions: {
        include: {
          flexDay: { select: { id: true, date: true, label: true } },
          _count: { select: { signups: true } },
          signups: {
            include: {
              student: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { flexDay: { date: "asc" } },
      },
    },
  });

  if (!club) notFound();

  const canManage =
    session.user.role === "ADMIN" || club.owner.id === session.user.id;
  if (!canManage) redirect("/unauthorized");

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{club.name}</h1>
          {club.description && (
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{club.description}</p>
          )}
          <div className="flex gap-4 mt-2 text-xs text-gray-400 dark:text-gray-500">
            <span>Capacity: {club.maxCapacity}</span>
            {club.location && <span>Location: {club.location}</span>}
            <span>Owner: {club.owner.name}</span>
            {club.googleCalendarId ? (
              <span className="text-green-600 dark:text-green-400">Google Calendar: Connected</span>
            ) : (
              <span className="text-yellow-600 dark:text-yellow-400">Google Calendar: Pending</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/teacher/clubs/${clubId}/edit`}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Edit
          </Link>
          <DeleteClubButton clubId={clubId} />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">
        Scheduled Sessions
      </h2>

      {club.clubSessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
          No sessions scheduled yet. Sessions will be automatically created when new flex days are added.
        </div>
      ) : (
        <div className="space-y-4">
          {club.clubSessions.map((cs) => (
            <div
              key={cs.id}
              className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {new Date(cs.flexDay.date).toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </div>
                  {cs.flexDay.label && (
                    <div className="text-xs text-gray-400 dark:text-gray-500">{cs.flexDay.label}</div>
                  )}
                  <div className="mt-1 flex gap-1">
                    {cs.rotations.map((r: RotationSlot) => (
                      <span
                        key={r}
                        className="inline-block rounded-full bg-indigo-100 dark:bg-indigo-950/50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                      >
                        {ROTATION_LABELS[r]}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {cs._count.signups}/{club.maxCapacity} enrolled
                  </span>
                  <Link
                    href={`/teacher/clubs/${clubId}/sessions/${cs.id}/edit`}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Edit
                  </Link>
                  <DeleteSessionButton
                    clubId={clubId}
                    sessionId={cs.id}
                  />
                </div>
              </div>

              {cs.signups.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                    View roster ({cs.signups.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {cs.signups.map((signup) => (
                      <li
                        key={signup.id}
                        className="text-xs text-gray-600 dark:text-gray-300 flex gap-2"
                      >
                        <span>{signup.student.name}</span>
                        <span className="text-gray-400 dark:text-gray-500">{signup.student.email}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
