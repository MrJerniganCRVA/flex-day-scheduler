import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import SessionForm from "@/components/sessions/SessionForm";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ clubId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { clubId: preselectedClubId } = await searchParams;

  const where =
    session.user.role === "ADMIN"
      ? undefined
      : { ownerId: session.user.id };

  const [clubs, flexDays] = await Promise.all([
    prisma.club.findMany({
      where,
      select: {
        id: true,
        name: true,
        defaultRoom: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.flexDay.findMany({
      where: { isActive: true },
      select: { id: true, date: true, label: true },
      orderBy: { date: "asc" },
    }),
  ]);

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Schedule a Club Session
      </h1>
      <SessionForm
        clubs={clubs}
        flexDays={flexDays}
        preselectedClubId={preselectedClubId}
      />
    </div>
  );
}
