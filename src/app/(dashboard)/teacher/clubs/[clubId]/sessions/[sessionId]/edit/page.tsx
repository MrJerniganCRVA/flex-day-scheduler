import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import SessionEditForm from "@/components/sessions/SessionEditForm";

export default async function EditSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string; sessionId: string }>;
  searchParams: Promise<{ return?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { clubId, sessionId } = await params;
  const { return: returnPath } = await searchParams;

  // Verify access
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) notFound();
  if (session.user.role !== "ADMIN" && club.ownerId !== session.user.id) {
    redirect("/unauthorized");
  }

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: {
      flexDay: { select: { date: true, label: true } },
      club: { select: { name: true } },
    },
  });

  if (!clubSession || clubSession.clubId !== clubId) notFound();

  // Fetch other sessions of the same club on the same flex day for the link UI
  const siblingSessionOptions = await prisma.clubSession.findMany({
    where: {
      clubId,
      flexDayId: clubSession.flexDayId,
      id: { not: sessionId },
    },
    select: { id: true, rotations: true },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        Edit Session
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
        {clubSession.club.name} —{" "}
        {new Date(clubSession.flexDay.date).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })}
      </p>

      <SessionEditForm
        clubId={clubId}
        sessionId={sessionId}
        initialRotations={clubSession.rotations}
        returnPath={returnPath}
        siblingSessionOptions={siblingSessionOptions}
      />
    </div>
  );
}
