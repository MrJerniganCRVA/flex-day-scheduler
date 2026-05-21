import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import OneOffForm from "@/components/sessions/OneOffForm";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ flexDayId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "STUDENT") redirect("/student");

  const { flexDayId: preselectedFlexDayId } = await searchParams;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const flexDays = await prisma.flexDay.findMany({
    where: { isActive: true, date: { gte: today } },
    select: { id: true, date: true, label: true },
    orderBy: { date: "asc" },
  });

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        New Activity
      </h1>
      <p className="text-gray-500 dark:text-gray-400 font-medium mb-1">An activity is a "one-off" Flex Day Activity that doesn't rise to the level of club, but a teacher still wants to host. Making an Activity will not automatically populate to all Flex Days. For an Activity, that you want to happen over multiple Flex Days, consider making a Club.</p>
      <OneOffForm
        flexDays={flexDays}
        preselectedFlexDayId={preselectedFlexDayId}
      />
    </div>
  );
}
