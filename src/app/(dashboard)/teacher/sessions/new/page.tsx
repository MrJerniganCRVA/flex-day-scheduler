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
      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 px-4 py-3 mb-4 text-sm text-amber-800 dark:text-amber-300">
        Use this for a one-time event on a single Flex Day — like a study session, tournament, or guest speaker.{" "}
        <span className="font-medium">If you run this activity every Flex Day, create a Club instead.</span>
      </div>
      <OneOffForm
        flexDays={flexDays}
        preselectedFlexDayId={preselectedFlexDayId}
      />
    </div>
  );
}
