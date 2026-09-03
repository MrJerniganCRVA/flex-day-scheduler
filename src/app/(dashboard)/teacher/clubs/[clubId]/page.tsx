import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import DeleteClubButton from "@/components/clubs/DeleteClubButton";
import FlexDaySessionGroup from "@/components/sessions/FlexDaySessionGroup";
import { isClubManager } from "@/lib/auth-helpers";
import { SESSION_ABSENCE_SELECT } from "@/lib/coverage";
import { groupSessionsByFlexDay } from "@/lib/session-grouping";
import RequiredMembersPanel from "@/components/clubs/RequiredMembersPanel";

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
      cosponsor: { select: { id: true, name: true } },
      requiredMembers: {
        select: {
          id: true,
          studentId: true,
          student: { select: { id: true, name: true, email: true } },
        },
        orderBy: { student: { name: "asc" } },
      },
      defaultRoom: { select: { id: true, name: true } },
      clubSessions: {
        where: { flexDay: { date: { gte: today } } },
        include: {
          flexDay: { select: { id: true, date: true, label: true } },
          _count: { select: { signups: true } },
          teacherAbsences: { select: SESSION_ABSENCE_SELECT },
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

  const canManage = isClubManager(club, session.user.id, session.user.role);
  if (!canManage) redirect("/unauthorized");

  const sessions = club.clubSessions;

  // Loaded here rather than through an API route the browser calls: the page is
  // already a server component with database access, and an endpoint that hands
  // out the whole student roster is one more thing to authorize correctly.
  const students = await prisma.user.findMany({
    where: { role: "STUDENT" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

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
            <span>Owner: {club.owner?.name ?? "None (admin-managed)"}</span>
            {club.cosponsor && <span>Cosponsor: {club.cosponsor.name}</span>}
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

      <div className="mb-6">
        <RequiredMembersPanel
          clubId={clubId}
          initialMembers={club.requiredMembers}
          students={students}
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
          {groupSessionsByFlexDay(sessions).map((daySessions) => (
            <FlexDaySessionGroup
              key={daySessions[0].flexDay.id}
              clubId={clubId}
              sessions={daySessions.map((cs) => ({
                sessionId: cs.id,
                flexDayId: cs.flexDay.id,
                flexDayDate: cs.flexDay.date.toISOString(),
                flexDayLabel: cs.flexDay.label,
                rotations: cs.rotations,
                enrollmentCount: cs._count.signups,
                maxCapacity: club.maxCapacity,
                capacityOverride: cs.capacityOverride,
                // Whether *this* teacher has stepped back from every rotation the
                // session covers. Checking "any rotation" would mark a linked
                // session absent when they had only stepped back from one of its
                // three, which reads as far more than they actually said.
                teacherAbsent: cs.rotations.every((r) =>
                  cs.teacherAbsences.some(
                    (a) => a.teacherId === session.user.id && a.rotation === r
                  )
                ),
                roomOverrideId: cs.roomOverrideId,
                defaultRoomName: club.defaultRoom?.name ?? null,
                signups: cs.signups,
                siblingSessionOptions: sessions
                  .filter((s) => s.flexDay.id === cs.flexDay.id && s.id !== cs.id)
                  .map((s) => ({ id: s.id, rotations: s.rotations })),
              }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
