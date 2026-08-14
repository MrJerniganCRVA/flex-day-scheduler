import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import ClubForm from "@/components/clubs/ClubForm";

export default async function EditClubPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { clubId } = await params;

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      id: true,
      name: true,
      description: true,
      maxCapacity: true,
      defaultRoomId: true,
      defaultRotations: true,
      ownerId: true,
      allowRandomAssignment: true,
      linkedRotations: true,
    },
  });

  if (!club) notFound();
  if (session.user.role !== "ADMIN" && club.ownerId !== session.user.id) {
    redirect("/unauthorized");
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Edit Club</h1>
      <ClubForm
        clubId={clubId}
        defaultValues={{
          name: club.name,
          description: club.description ?? undefined,
          maxCapacity: club.maxCapacity,
          defaultRoomId: club.defaultRoomId,
          defaultRotations: club.defaultRotations,
          allowRandomAssignment: club.allowRandomAssignment,
          linkedRotations: club.linkedRotations,
        }}
      />
    </div>
  );
}
