import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function StudentDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const flexDays = await prisma.flexDay.findMany({
    where: { isActive: true, date: { gte: today } },
    include: {
      clubSessions: {
        include: {
          _count: { select: { signups: true } },
          signups: {
            where: { studentId: session.user.id },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Welcome, {session.user.name?.split(" ")[0]}!
      </h1>
      <p className="text-gray-500 mb-6 text-sm">
        Upcoming Flex Days — click a date to sign up for clubs.
      </p>

      {flexDays.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          No upcoming Flex Days scheduled. Check back later!
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {flexDays.map((fd) => {
            const totalSessions = fd.clubSessions.length;
            const signedUp = fd.clubSessions.filter(
              (s) => s.signups.length > 0
            ).length;

            return (
              <Link
                key={fd.id}
                href={`/student/flex-days/${fd.id}`}
                className="block rounded-xl bg-white border border-gray-200 p-5 hover:shadow-md hover:border-indigo-300 transition-all"
              >
                <div className="text-sm font-medium text-indigo-600 mb-1">
                  {new Date(fd.date).toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </div>
                {fd.label && (
                  <div className="font-semibold text-gray-900 mb-3">
                    {fd.label}
                  </div>
                )}
                <div className="text-xs text-gray-500">
                  {totalSessions} club session{totalSessions !== 1 ? "s" : ""}{" "}
                  available
                </div>
                {signedUp > 0 && (
                  <div className="mt-2 text-xs font-medium text-green-600">
                    Signed up for {signedUp} rotation
                    {signedUp !== 1 ? "s" : ""}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
