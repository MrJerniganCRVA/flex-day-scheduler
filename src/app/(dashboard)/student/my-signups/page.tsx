import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import Link from "next/link";
import CancelButton from "@/components/signups/CancelButton";

export default async function MySignupsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const signups = await prisma.signup.findMany({
    where: { studentId: session.user.id },
    include: {
      clubSession: {
        include: {
          club: { select: { id: true, name: true } },
          flexDay: { select: { id: true, date: true, label: true } },
        },
      },
    },
    orderBy: { clubSession: { flexDay: { date: "asc" } } },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">My Signups</h1>

      {signups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-12 text-center text-gray-400 dark:text-gray-500">
          You haven&apos;t signed up for any clubs yet.{" "}
          <Link href="/student" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Browse upcoming Flex Days
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Club</th>
                <th className="px-4 py-3 text-left">Rotations</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {signups.map((signup) => (
                <tr key={signup.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                    {new Date(signup.clubSession.flexDay.date).toLocaleDateString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      }
                    )}
                    {signup.clubSession.flexDay.label && (
                      <div className="text-xs text-gray-400 dark:text-gray-500">
                        {signup.clubSession.flexDay.label}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {signup.clubSession.club.name}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {signup.clubSession.rotations
                      .map((r: RotationSlot) => ROTATION_LABELS[r])
                      .join(", ")}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    —
                  </td>
                  <td className="px-4 py-3 text-right">
                    <CancelButton signupId={signup.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
