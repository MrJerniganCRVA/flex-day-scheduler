import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ClubForm from "@/components/clubs/ClubForm";

export default async function NewClubPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Create a New Club</h1>
      <ClubForm />
    </div>
  );
}
