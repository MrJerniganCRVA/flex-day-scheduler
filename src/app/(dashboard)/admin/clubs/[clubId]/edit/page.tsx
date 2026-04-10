import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import ClubForm from "@/components/clubs/ClubForm";
import Link from "next/link";

export default async function AdminEditClubPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const { clubId } = await params;

  const [club, teachers] = await Promise.all([
    prisma.club.findUnique({
      where: { id: clubId },
      select: {
        id: true,
        name: true,
        description: true,
        maxCapacity: true,
        
        ownerId: true,
      },
    }),
    prisma.user.findMany({
      where: { role: { in: ["TEACHER", "ADMIN"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!club) notFound();

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link
          href={`/admin/clubs/${clubId}`}
          className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
        >
          ← Back to club
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">Edit Club</h1>
      </div>
      <ClubForm
        clubId={clubId}
        defaultValues={{
          name: club.name,
          description: club.description ?? undefined,
          maxCapacity: club.maxCapacity,
        }}
        teachers={teachers}
        defaultOwnerId={club.ownerId}
        returnBasePath="/admin/clubs"
      />
    </div>
  );
}
