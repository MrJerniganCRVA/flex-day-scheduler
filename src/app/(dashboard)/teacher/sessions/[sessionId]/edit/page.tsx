import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import OneOffEditForm from "@/components/sessions/OneOffEditForm";

export default async function EditOneOffSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ return?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role === "STUDENT") redirect("/unauthorized");

  const { sessionId } = await params;
  const { return: returnPath } = await searchParams;

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: {
      flexDay: { select: { date: true, label: true } },
      roomOverride: { select: { id: true, name: true } },
    },
  });

  if (!clubSession || clubSession.clubId !== null) notFound();

  const isAdmin = session.user.role === "ADMIN";
  const isOwner = clubSession.oneOffOwnerId === session.user.id;
  if (!isAdmin && !isOwner) redirect("/unauthorized");

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        Edit Activity
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        {new Date(clubSession.flexDay.date).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })}
        {clubSession.flexDay.label ? ` — ${clubSession.flexDay.label}` : ""}
      </p>
      <OneOffEditForm
        sessionId={sessionId}
        initialTitle={clubSession.title ?? ""}
        initialRotations={clubSession.rotations}
        initialRoomId={clubSession.roomOverrideId}
        initialCapacity={clubSession.capacityOverride}
        returnPath={returnPath}
      />
    </div>
  );
}
