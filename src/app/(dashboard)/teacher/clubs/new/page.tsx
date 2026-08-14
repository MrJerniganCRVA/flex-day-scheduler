import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import ClubForm from "@/components/clubs/ClubForm";

export default async function NewClubPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const teachers = await prisma.user.findMany({
    where: { role: { in: ["TEACHER", "ADMIN"] }, id: { not: session.user.id } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Create a New Club</h1>
      <ClubForm teachers={teachers} />
    </div>
  );
}
