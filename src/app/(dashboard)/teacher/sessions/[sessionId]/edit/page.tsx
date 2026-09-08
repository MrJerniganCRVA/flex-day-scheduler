import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import OneOffEditForm from "@/components/sessions/OneOffEditForm";

/**
 * Edit a one-off session — one with no club, created through
 * /teacher/sessions/new.
 *
 * Deliberately session-scoped rather than club-scoped: the existing edit page
 * at /teacher/clubs/[clubId]/sessions/[sessionId]/edit looks its club up by the
 * `clubId` in the URL and 404s when `clubSession.clubId` doesn't match, so a
 * session whose `clubId` is null has no URL there at all. That left one-offs
 * creatable but never editable.
 *
 * No split/link controls here: those merge and divide a club's sessions and
 * have no meaning for a session that belongs to no club.
 */
export default async function EditOneOffSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ return?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "STUDENT") redirect("/unauthorized");

  const { sessionId } = await params;
  const { return: returnPath } = await searchParams;

  const clubSession = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: {
      flexDay: { select: { date: true, label: true } },
      oneOffOwner: { select: { id: true, name: true } },
      // Passed to the form so the room the session already holds stays visible
      // even when it drops out of the availability list (deactivated, or taken
      // by another session). Otherwise the select would render blank while the
      // form still held the old id, and submit it.
      roomOverride: { select: { id: true, name: true, capacity: true } },
    },
  });

  if (!clubSession) notFound();

  // Club sessions keep their own edit page, which offers split and link on top
  // of what this form does. Sending one here would silently drop those.
  if (clubSession.clubId !== null) {
    redirect(
      `/teacher/clubs/${clubSession.clubId}/sessions/${sessionId}/edit${
        returnPath ? `?return=${encodeURIComponent(returnPath)}` : ""
      }`
    );
  }

  // Same rule the API enforces (see resolveOwnerAndSession in
  // src/app/api/club-sessions/[sessionId]/route.ts): a one-off has no club to
  // ask isClubManager about, so it is the creating teacher or an admin.
  const canManage =
    session.user.role === "ADMIN" ||
    clubSession.oneOffOwnerId === session.user.id;
  if (!canManage) redirect("/unauthorized");

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        Edit Session
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
        {clubSession.title ?? "Session"} —{" "}
        {new Date(clubSession.flexDay.date).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })}
        {clubSession.oneOffOwner && ` · ${clubSession.oneOffOwner.name}`}
      </p>

      <OneOffEditForm
        sessionId={sessionId}
        flexDayId={clubSession.flexDayId}
        initialRotations={clubSession.rotations}
        currentRoom={clubSession.roomOverride}
        initialCapacity={clubSession.capacityOverride}
        returnPath={returnPath}
      />
    </div>
  );
}
