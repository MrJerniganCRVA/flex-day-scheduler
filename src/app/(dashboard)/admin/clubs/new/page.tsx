import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import ClubForm from "@/components/clubs/ClubForm";

export default async function AdminNewClubPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const teachers = await prisma.user.findMany({
    where: { role: { in: ["TEACHER", "ADMIN"] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Create a New Club</h1>
      <ClubForm
        teachers={teachers}
        returnBasePath="/admin/clubs"
      />
    </div>
  );
}
