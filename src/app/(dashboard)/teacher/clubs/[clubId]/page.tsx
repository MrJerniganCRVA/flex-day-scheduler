import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import DeleteClubButton from "@/components/clubs/DeleteClubButton";
import SessionCard from "@/components/sessions/SessionCard";
import RequiredMembersPanel from "@/components/clubs/RequiredMembersPanel";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@/types";

const ROTATION_ORDER: Record<RotationSlot, number> = {
  FLEX_1: 0,
  FLEX_2: 1,
  FLEX_3: 2,
};

export default async function ClubDetailPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { clubId } = await params;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    include: {
      owner: { select: { id: true, name: true } },
      defaultRoom: { select: { id: true, name: true } },
      defaultCoTeacher: { select: { id: true, name: true } },
      members: {
        include: { student: { select: { id: true, name: true, email: true } } },
        orderBy: { student: { name: "asc" } },
      },
      clubSessions: {
        where: { flexDay: { date: { gte: today } } },
        include: {
          flexDay: {
            select: {
              id: true,
              date: true,
              label: true,
              teacherAbsences: {
                where: { userId: session.user.id },
                select: { rotation: true, type: true },
              },
            },
          },
          _count: { select: { signups: true } },
          signups: {
            include: {
              student: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
  });

  if (!club) notFound();

  const canManage =
    session.user.role === "ADMIN" || club.owner.id === session.user.id;
  if (!canManage) redirect("/unauthorized");

  const sessions = [...club.clubSessions].sort((a, b) => {
    const dateDiff = a.flexDay.date.getTime() - b.flexDay.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    const aMin = Math.min(...a.rotations.map((r) => ROTATION_ORDER[r as RotationSlot] ?? 99));
    const bMin = Math.min(...b.rotations.map((r) => ROTATION_ORDER[r as RotationSlot] ?? 99));
    return aMin - bMin;
  });

  return (
    <div className="space-y-6">
      {/* ── Club Info Card ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">
              {club.name}
            </h1>
            {session.user.role === "ADMIN" && club.owner.id !== session.user.id && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Owner: {club.owner.name}
              </p>
            )}
          </div>
          <div className="shrink-0">
            <DeleteClubButton
              clubId={clubId}
              editHref={`/teacher/clubs/${clubId}/edit`}
            />
          </div>
        </div>

        {/* Description */}
        <div className="mb-5">
          {club.description ? (
            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
              {club.description}
            </p>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic">
              No description — add one in Edit Club Details.
            </p>
          )}
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
              Max Students
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {club.maxCapacity}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
              Default Room
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {club.defaultRoom?.name ?? (
                <span className="text-gray-400 dark:text-gray-500 italic font-normal">None set</span>
              )}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
              Co-teacher
            </p>
            {club.defaultCoTeacher ? (
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {club.defaultCoTeacher.name}
              </p>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic font-normal">
                None — add in Edit Club Details
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
              Session Rotations
            </p>
            {club.defaultRotations.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {ALL_ROTATIONS.filter((r) => club.defaultRotations.includes(r)).map((r) => (
                  <span
                    key={r}
                    className="inline-block rounded-full bg-indigo-100 dark:bg-indigo-950/50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                  >
                    {ROTATION_LABELS[r]}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic font-normal">None</p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
              Session Format
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {club.defaultLinked ? "Linked (one block)" : "Separate per rotation"}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
              Random Assignment
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {club.allowRandomAssignment ? "Allowed" : "Off"}
            </p>
          </div>
        </div>

        {/* Google Calendar status */}
        <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
          {club.googleCalendarId ? (
            <span className="text-xs font-medium text-green-600 dark:text-green-400">
              Google Calendar: Connected
            </span>
          ) : (
            <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">
              Google Calendar: Pending connection
            </span>
          )}
        </div>
      </div>

      {/* ── Required Members ───────────────────────────────────────── */}
      <RequiredMembersPanel
        clubId={clubId}
        initialMembers={club.members}
      />

      {/* ── Upcoming Flex Days ──────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
          Upcoming Flex Days
        </h2>

        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
            No upcoming flex days scheduled. Sessions are automatically created when new flex days are added.
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((cs) => (
              <SessionCard
                key={cs.id}
                clubId={clubId}
                sessionId={cs.id}
                flexDayDate={cs.flexDay.date.toISOString()}
                flexDayLabel={cs.flexDay.label}
                rotations={cs.rotations}
                enrollmentCount={cs._count.signups}
                maxCapacity={club.maxCapacity}
                capacityOverride={cs.capacityOverride}
                teacherAbsences={cs.flexDay.teacherAbsences}
                roomOverrideId={cs.roomOverrideId}
                defaultRoomName={club.defaultRoom?.name ?? null}
                signups={cs.signups}
                siblingSessionOptions={sessions
                  .filter((s) => s.flexDay.id === cs.flexDay.id && s.id !== cs.id)
                  .map((s) => ({ id: s.id, rotations: s.rotations }))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
