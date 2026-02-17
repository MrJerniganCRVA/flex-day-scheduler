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

  // Only owner or admin can manage
  const canManage =
    session.user.role === "ADMIN" || club.owner.id === session.user.id;
  if (!canManage) redirect("/unauthorized");

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{club.name}</h1>
          {club.description && (
            <p className="text-gray-500 text-sm mt-1">{club.description}</p>
          )}
          <div className="flex gap-4 mt-2 text-xs text-gray-400">
            <span>Capacity: {club.maxCapacity}</span>
            {club.location && <span>Location: {club.location}</span>}
            <span>Owner: {club.owner.name}</span>
            {club.googleCalendarId ? (
              <span className="text-green-600">Google Calendar: Connected</span>
            ) : (
              <span className="text-yellow-600">Google Calendar: Pending</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/teacher/clubs/${clubId}/edit`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Edit
          </Link>
          <Link
            href={`/teacher/sessions/new?clubId=${clubId}`}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            + Schedule Session
          </Link>
          <DeleteClubButton clubId={clubId} />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-800 mb-3">
        Scheduled Sessions
      </h2>

      {club.clubSessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400">
          No sessions scheduled yet.{" "}
          <Link
            href={`/teacher/sessions/new?clubId=${clubId}`}
            className="text-indigo-600 hover:underline"
          >
            Schedule a session
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {club.clubSessions.map((cs) => (
            <div
              key={cs.id}
              className="rounded-xl bg-white border border-gray-200 p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold text-gray-900">
                    {new Date(cs.flexDay.date).toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </div>
                  {cs.flexDay.label && (
                    <div className="text-xs text-gray-400">{cs.flexDay.label}</div>
                  )}
                  <div className="mt-1 flex gap-1">
                    {cs.rotations.map((r: RotationSlot) => (
                      <span
                        key={r}
                        className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
                      >
                        {ROTATION_LABELS[r]}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">
                    {cs._count.signups}/{club.maxCapacity} enrolled
                  </span>
                  <DeleteSessionButton
                    clubId={clubId}
                    sessionId={cs.id}
                  />
                </div>
              </div>

              {cs.signups.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                    View roster ({cs.signups.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {cs.signups.map((signup) => (
                      <li
                        key={signup.id}
                        className="text-xs text-gray-600 flex gap-2"
                      >
                        <span>{signup.student.name}</span>
                        <span className="text-gray-400">{signup.student.email}</span>
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
