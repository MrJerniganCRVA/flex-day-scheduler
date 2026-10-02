import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import OneOffForm from "@/components/sessions/OneOffForm";
import { startOfTodayUtc } from "@/lib/flex-day-date";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ flexDayId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "STUDENT") redirect("/student");

  const { flexDayId: preselectedFlexDayId } = await searchParams;

  const today = startOfTodayUtc();

  const flexDays = await prisma.flexDay.findMany({
    where: { isActive: true, date: { gte: today } },
    select: { id: true, date: true, label: true },
    orderBy: { date: "asc" },
  });

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        New Session
      </h1>
      <OneOffForm
        flexDays={flexDays}
        preselectedFlexDayId={preselectedFlexDayId}
      />
    </div>
  );
}
