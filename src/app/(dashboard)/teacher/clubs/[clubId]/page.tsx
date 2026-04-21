import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import DeleteClubButton from "@/components/clubs/DeleteClubButton";
import SessionCard from "@/components/sessions/SessionCard";

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
      clubSessions: {
        where: { flexDay: { date: { gte: today } } },
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

  const sessions = club.clubSessions;

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
            <span>Owner: {club.owner.name}</span>
            {club.googleCalendarId ? (
              <span className="text-green-600 dark:text-green-400">Google Calendar: Connected</span>
            ) : (
              <span className="text-yellow-600 dark:text-yellow-400">Google Calendar: Pending</span>
            )}
          </div>
        </div>
        <DeleteClubButton
          clubId={clubId}
          editHref={`/teacher/clubs/${clubId}/edit`}
        />
      </div>

      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">
        Flex Days
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
              teacherAbsent={cs.teacherAbsent}
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
  );
}
